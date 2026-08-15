"""Phase 11 (real sync) — bare-repo path safety + the dulwich `Backend` that
resolves a URL path segment to one of those repos on disk.

**Path safety contract** (roadmap §1's "path traversal is structurally
impossible" principle, applied here to git repo names instead of share
slugs): a repo name is user input (it comes straight off the URL path any
git client sends), so it is validated against `REPO_NAME_RE` — the exact
`^[A-Za-z0-9_-]{1,64}$` shape the phase brief specifies — BEFORE it is ever
joined onto a filesystem path. That regex alone already makes `..` and `/`
structurally unrepresentable in a valid name (neither character is in the
allowed set), but `resolve_repo_path` also re-checks the final resolved path
is inside `git_root` as defense in depth, the same "validate twice" posture
`server/app/policy.py` uses for share slugs. See `tests/test_git_sync.py::
test_repo_name_validation_rejects_traversal` for the property this defends.

Deliberately NOT `dulwich.server.FileSystemBackend`: that class's
`open_repository` does `os.path.join(self.root, path)` where `path` is
dulwich's own `url_prefix()` output, which ALWAYS starts with a leading
`/` (confirmed by reading `dulwich.web.url_prefix`) — and `os.path.join`
throws away the first argument entirely whenever the second is
itself absolute (`os.path.join("/a/b/", "/c") == "/c"`, a stdlib quirk, not
a dulwich bug). That silently ignores `root` and would resolve repos
relative to the real filesystem root instead of `SLATE_GIT_ROOT`. Verified
by hand against dulwich 1.2.12 before writing `BareRepoBackend` below, which
does its own name extraction + validation instead of trusting that class.
"""

from __future__ import annotations

import re
from pathlib import Path

from dulwich.errors import NotGitRepository
from dulwich.repo import Repo
from dulwich.server import Backend as DulwichBackend
from dulwich.server import BackendRepo

# The phase brief's exact shape. Validated against the repo name ONLY (the
# ".git" suffix every URL carries is stripped first, see resolve_repo_path).
REPO_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Mirrors `src/git/client.ts::DEFAULT_BRANCH` — see `ensure_bare_repo`'s
# docstring for why a freshly-created bare repo's HEAD points here.
DEFAULT_CLIENT_BRANCH = "feat/incremental-index"


class InvalidRepoName(ValueError):
    """Raised for any repo-name that fails validation or would resolve
    outside `git_root` — callers turn this into a 400/404, never a stack
    trace leaking a filesystem path."""


def resolve_repo_path(git_root: Path, url_path_prefix: str) -> Path:
    """`url_path_prefix` is the request path with the trailing git-protocol
    suffix (`/info/refs`, `/git-upload-pack`, ...) already stripped —
    dulwich's own `url_prefix()` shape, e.g. `/myvault.git`, and also what
    the ASGI auth layer (`routers/git_http.py`) passes in directly for the
    pre-push bare-init check. Always returns a path inside `git_root` or
    raises `InvalidRepoName` — never a bare `..`-escaping path.
    """
    name = url_path_prefix.strip("/")
    if not name.endswith(".git"):
        raise InvalidRepoName(f"expected a '.git'-suffixed path, got {url_path_prefix!r}")
    repo_name = name[: -len(".git")]
    if not REPO_NAME_RE.match(repo_name):
        raise InvalidRepoName(f"invalid repo name: {repo_name!r}")

    root_resolved = git_root.resolve()
    candidate = (root_resolved / f"{repo_name}.git").resolve()
    # Belt-and-suspenders (see module docstring) — REPO_NAME_RE already
    # forbids '/' and '..' outright, so this can only ever fail if git_root
    # itself is misconfigured to something surprising.
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise InvalidRepoName("resolved path escapes SLATE_GIT_ROOT")
    return candidate


def ensure_bare_repo(path: Path) -> None:
    """Creates a bare repo at `path` if one doesn't exist yet ("created on
    demand as bare repos" — phase brief). A completely ordinary bare repo —
    no encryption, no special format (roadmap §4: the vault and its remote
    stay plaintext, always) — a plain `git clone` reads it like any other.

    HEAD is pointed at `DEFAULT_CLIENT_BRANCH` (matching the client's own
    `src/git/client.ts::DEFAULT_BRANCH`) rather than dulwich's own default
    of `refs/heads/master`: a bare repo created empty has no refs at all
    yet, so *some* HEAD target has to be picked, and picking the one branch
    name this app's own client ever pushes means a plain `git clone` of a
    freshly-created repo checks out cleanly instead of warning "remote HEAD
    refers to nonexistent ref" the first time (harmless — `git log
    origin/<branch>` still shows every commit either way — but avoidable).
    If a repo is ever pushed to under a different branch name, HEAD simply
    keeps pointing at this default; that only affects which branch a bare
    `git clone` checks out by default, never which refs/objects exist."""
    if path.exists():
        return
    path.mkdir(parents=True, exist_ok=True)
    repo = Repo.init_bare(str(path))
    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/" + DEFAULT_CLIENT_BRANCH.encode("utf-8"))


class BareRepoBackend(DulwichBackend):
    """dulwich `Backend` — the one dulwich.web's `HTTPGitApplication` calls
    into for every request, AFTER `routers/git_http.py`'s `GitAuthMiddleware`
    has already authenticated the caller and (for a write request) already
    called `ensure_bare_repo`. This class therefore only ever needs to
    OPEN an existing repo, never create one — `open_repository` raising
    `NotGitRepository` for a missing repo is exactly the "repo doesn't exist
    yet" 404 a read-only client should see.
    """

    def __init__(self, git_root: Path) -> None:
        self.git_root = git_root

    def open_repository(self, path: "str | bytes") -> BackendRepo:
        # dulwich passes `str` for GET routes (`get_repo`, via `url_prefix`)
        # but `bytes` for the POST service routes (`handle_service_request`
        # explicitly does `url_prefix(mat).encode("utf-8")` before handing
        # it to the handler, which forwards it straight through as the repo
        # name arg) — confirmed by reading both call sites in dulwich.web
        # 1.2.12. Normalize once here so `resolve_repo_path` only ever deals
        # with `str`.
        if isinstance(path, bytes):
            path = path.decode("utf-8")
        try:
            resolved = resolve_repo_path(self.git_root, path)
        except InvalidRepoName as exc:
            raise NotGitRepository(str(exc)) from exc
        if not resolved.exists():
            raise NotGitRepository(f"No repository at {path!r}")
        return Repo(str(resolved))

"""Phase 17 Milestone A — the single source of truth for vault identity and
working-tree semantics. Before this module, `vaultcommit.py`'s
`_pick_repo_path` guessed which bare repo under `VSNOTE_GIT_ROOT` was "the
vault" (a `vault.git` dir, or the sole `.git`-suffixed dir if exactly one
existed). Every module that needs to know "where is the vault" now calls
`vault_repo_path()` instead — no more guessing, anywhere.

## Two shapes

- **LEGACY** (`settings.vault_path` unset, the default): the vault is an
  ordinary BARE repo at `{git_root}/{vault_repo_name}.git`, created on
  demand exactly like every other synced repo `gitrepo.py` manages. No
  working tree exists, so the working-tree semantics below are no-ops for
  this shape.
- **MOUNTED** (`settings.vault_path` set to a docker volume or host path):
  the vault is a real, NON-bare repo living directly at that path — its
  `.git` metadata dir sits inside it, and the rest of the directory IS the
  plaintext working tree, readable/editable by anything with filesystem
  access to the mount (a text editor over SSH, `git clone` from the host,
  ...). This is the point of Phase 17: the server's own copy becomes the
  browsable, authoritative vault, not just a git object store other clients
  push bytes into. The vault stays PLAINTEXT always — never encrypted at
  rest (roadmap §4) — so a plain `git clone`/`cat` of the mount keeps
  working without the app, by design.

Respecting an existing `.git` is binding, in both shapes: nothing in this
module (or anything that calls it) ever auto-creates or overwrites a repo
that's already there. Only the explicit `init_vault()` — called from
exactly one place, `POST /api/vault/init` — ever creates one, and it
refuses outright if one already exists.

## Working-tree semantics (MOUNTED shape only — the crux of this module)

A mounted vault's working tree can be written from two directions at once:
the owner (or any other process with filesystem access) editing files
directly on disk, and a git client pushing over `/git/<vault>.git`. Two
hooks, wired into `routers/git_http.py`'s request handling, keep those from
clobbering each other:

- **`commit_worktree_changes()`** runs BEFORE every git-http request this
  server serves for the vault repo (both reads and writes — a fetch should
  see the freshest disk state too, and a push's fast-forward/divergence
  decision must already account for any disk edit that happened first).
  It stages whatever changed since the last commit — new/modified files via
  `git add`-equivalent, files that disappeared from disk via `git rm
  --cached`-equivalent — and commits them with a fixed, clearly
  attributable author (`VSNote server <vault@vsnote>`) and a one-line
  message. This guarantees a disk edit is never silently lost to an
  incoming push: by the time the push is evaluated, the disk edit is
  already real git history the push has to reconcile with (fast-forward if
  it's a strict ancestor, or a normal non-fast-forward rejection otherwise
  — this module invents no new merge policy, it just makes sure disk edits
  are IN history before that decision is made).
- **`checkout_head_into_worktree()`** runs AFTER a `git-receive-pack`
  (push) request succeeds. It updates the working tree to match the branch
  tip the push just landed — writing changed/added files, removing files no
  longer in the tree — WITHOUT moving `HEAD`/the branch ref itself (those
  were already correctly updated by the push; this only reconciles the
  index + files on disk with them). This is what keeps the mounted
  directory a trustworthy, live view of the vault for anything reading it
  directly, not just for other git clients talking the smart-HTTP
  protocol.

Both hooks are complete no-ops for the LEGACY bare shape (no working tree to
touch) and for a vault with no commits yet (nothing to check out).
`init_vault()` is the ONLY function that creates a repo; both working-tree
hooks silently do nothing (return `False`) against a path that isn't an
initialized repo yet — see `routers/git_http.py`'s own separate "mounted but
uninitialized" check for the request-level 409, which is a distinct
concern from these two idempotent-no-op hooks.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dulwich import porcelain
from dulwich.diff_tree import tree_changes
from dulwich.errors import NotGitRepository
from dulwich.index import update_working_tree
from dulwich.repo import Repo

from . import gitrepo
from .config import Settings

# Fixed, clearly attributable identity for commits this server makes on its
# own initiative (never a real human/principal — see commit_worktree_changes
# below). One line, no em dashes (this is the exact string that lands in
# `git log`, so it must read cleanly there too).
VAULT_COMMIT_AUTHOR = b"VSNote server <vault@vsnote>"
WORKTREE_COMMIT_MESSAGE = b"Commit disk edits before serving a git request\n"


class VaultError(RuntimeError):
    """Base class for vault-identity errors this module raises."""


class VaultAlreadyInitialized(VaultError):
    """`init_vault()` refused: a git repository already exists at the vault
    path. Respecting an existing `.git` is binding — see module docstring."""


class VaultPathNotWritable(VaultError):
    """`init_vault()` refused: the server process cannot write to the vault
    path (DESIGN-SPEC Amendments round 7 item 50). The field-observed cause
    is a Docker named volume created root-owned while the container runs as
    the non-root `vsnote` uid — `Dockerfile`'s entrypoint chowns the vault
    directory at container start specifically to avoid this, but a bind
    mount to a host directory the operator forgot to `chown`, or a
    genuinely read-only mount, hit the same `OSError` here. Carries the
    path and the underlying `OSError` so `routers/vault.py` can build a
    message that names both without ever letting the raw traceback reach
    the client."""

    def __init__(self, path: Path, original: OSError) -> None:
        self.path = path
        self.original = original
        super().__init__(f"cannot write to vault path {path}: {original}")


def validate_vault_repo_name(name: str) -> None:
    """Raises `ValueError` if `name` doesn't match the exact same
    `gitrepo.REPO_NAME_RE` shape every other repo name is validated
    against. Called once at `create_app()` time so a misconfigured
    `VSNOTE_VAULT_REPO_NAME` fails loudly at startup instead of silently
    404ing every `/git/<name>.git` request for the rest of the process's
    life."""
    if not gitrepo.REPO_NAME_RE.match(name):
        raise ValueError(
            f"invalid VSNOTE_VAULT_REPO_NAME {name!r}: must match {gitrepo.REPO_NAME_RE.pattern}"
        )


def is_mounted(settings: Settings) -> bool:
    return bool(settings.vault_path)


def vault_repo_path(settings: Settings) -> Path:
    """THE single place every other module asks "where is the vault" —
    nothing else in this codebase should compute this path independently.
    Mounted shape: exactly `settings.vault_path`, unresolved-as-given (an
    operator's mount path, not something to second-guess). Legacy shape:
    the same `{git_root}/{repo}.git` formula `gitrepo.py` has always used,
    so a deployment that has never set `VSNOTE_VAULT_PATH` sees zero
    behavior change from every earlier phase."""
    if settings.vault_path:
        return Path(settings.vault_path)
    return Path(settings.git_root) / f"{settings.vault_repo_name}.git"


def resolve_git_repo_path(settings: Settings, url_path_prefix: str) -> Path:
    """The routing decision `routers/git_http.py` needs for EVERY
    `/git/<name>.git/...` request: does `<name>` name the vault (route to
    `vault_repo_path()`) or some other repo (keep the legacy
    `gitrepo.resolve_repo_path` behavior, completely unchanged)? One
    routing decision, used by both the dulwich `Backend` (reads) and the
    auth middleware (the pre-push init/auto-create check) — see
    `routers/git_http.py`'s module docstring. Raises
    `gitrepo.InvalidRepoName` for a malformed name, exactly like
    `gitrepo.resolve_repo_path` always has, no matter which shape it
    resolves to."""
    name = url_path_prefix.strip("/")
    if not name.endswith(".git"):
        raise gitrepo.InvalidRepoName(f"expected a '.git'-suffixed path, got {url_path_prefix!r}")
    repo_name = name[: -len(".git")]
    if not gitrepo.REPO_NAME_RE.match(repo_name):
        raise gitrepo.InvalidRepoName(f"invalid repo name: {repo_name!r}")
    if repo_name == settings.vault_repo_name:
        return vault_repo_path(settings)
    return gitrepo.resolve_repo_path(Path(settings.git_root), url_path_prefix)


def _open_if_repo(path: Path) -> Optional[Repo]:
    """Returns an opened `Repo` if `path` is really an initialized git repo
    (bare or not), else `None` — NEVER raises for "not a repo yet", since
    that's an expected, common state (a freshly mounted empty volume) every
    caller here needs to handle as data, not an exception."""
    if not path.exists():
        return None
    try:
        return Repo(str(path))
    except NotGitRepository:
        return None


def vault_repo_exists(path: Path) -> bool:
    repo = _open_if_repo(path)
    if repo is None:
        return False
    repo.close()
    return True


@dataclass
class VaultDescription:
    path: str
    mounted: bool
    initialized: bool
    bare: bool
    repo_name: str
    head_branch: Optional[str]
    has_commits: bool
    worktree_dirty: bool
    last_commit_message: Optional[str]
    last_commit_time: Optional[int]


def _head_branch_and_oid(repo: Repo) -> tuple[Optional[str], Optional[bytes]]:
    try:
        head_ref = repo.refs.follow(b"HEAD")[0][-1]
    except KeyError:
        return None, None
    head_branch = None
    if head_ref and head_ref.startswith(b"refs/heads/"):
        head_branch = head_ref[len(b"refs/heads/") :].decode("utf-8", "replace")
    try:
        head_oid = repo.refs[head_ref]
    except KeyError:
        head_oid = None
    return head_branch, head_oid


def _worktree_is_dirty(repo: Repo) -> bool:
    status = porcelain.status(repo)
    staged = status.staged
    return bool(
        staged.get("add") or staged.get("delete") or staged.get("modify") or status.unstaged or status.untracked
    )


def describe_vault(settings: Settings) -> VaultDescription:
    """No secrets in here — session-authenticated only (`GET /api/vault`),
    same posture as every other owner-side `/api` response. Absolute paths
    are fine to expose to an already-authenticated owner."""
    path = vault_repo_path(settings)
    mounted = is_mounted(settings)
    repo = _open_if_repo(path)
    if repo is None:
        return VaultDescription(
            path=str(path),
            mounted=mounted,
            initialized=False,
            bare=not mounted,
            repo_name=settings.vault_repo_name,
            head_branch=None,
            has_commits=False,
            worktree_dirty=False,
            last_commit_message=None,
            last_commit_time=None,
        )
    try:
        bare = repo.bare
        head_branch, head_oid = _head_branch_and_oid(repo)
        has_commits = head_oid is not None
        last_commit_message: Optional[str] = None
        last_commit_time: Optional[int] = None
        if has_commits:
            commit = repo.object_store[head_oid]
            last_commit_message = commit.message.decode("utf-8", "replace").strip()
            last_commit_time = commit.commit_time
        worktree_dirty = _worktree_is_dirty(repo) if not bare else False
        return VaultDescription(
            path=str(path),
            mounted=mounted,
            initialized=True,
            bare=bare,
            repo_name=settings.vault_repo_name,
            head_branch=head_branch,
            has_commits=has_commits,
            worktree_dirty=worktree_dirty,
            last_commit_message=last_commit_message,
            last_commit_time=last_commit_time,
        )
    finally:
        repo.close()


def init_vault(settings: Settings, branch: Optional[str] = None) -> VaultDescription:
    """Explicit init ONLY — the sole function anywhere in this codebase
    allowed to create the vault repo, called from exactly one place
    (`POST /api/vault/init`). Refuses with `VaultAlreadyInitialized` if a
    repo already exists at the vault path (respecting an existing `.git` is
    binding — see module docstring); this function never overwrites,
    re-inits, or deletes anything. Mounted shape creates a real, non-bare
    working tree at `settings.vault_path` (any pre-existing plain files
    there are left as untracked — the next `commit_worktree_changes` call,
    right before the first git-http request, folds them into the vault's
    first commit rather than this function forcing an empty-vs-populated
    decision). Legacy shape creates an ordinary bare repo, same as
    `gitrepo.ensure_bare_repo` always has.
    """
    validate_vault_repo_name(settings.vault_repo_name)
    branch = branch or gitrepo.DEFAULT_CLIENT_BRANCH
    path = vault_repo_path(settings)
    if vault_repo_exists(path):
        raise VaultAlreadyInitialized(f"a git repository already exists at {path}")

    mounted = is_mounted(settings)
    try:
        # Both the directory creation and dulwich's repo init can hit
        # PermissionError (root-owned volume, unwritable parent) or another
        # OSError (e.g. a read-only mount, ENOSPC) — one try/except covers
        # both since either leaves the vault path in the same "server can't
        # write here" state the caller needs to report.
        path.mkdir(parents=True, exist_ok=True)
        if mounted:
            repo = porcelain.init(str(path), bare=False)
        else:
            repo = Repo.init_bare(str(path))
    except OSError as exc:
        raise VaultPathNotWritable(path, exc) from exc
    try:
        repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/" + branch.encode("utf-8"))
    finally:
        repo.close()
    return describe_vault(settings)


def commit_worktree_changes(repo_path: Path) -> bool:
    """See module docstring's "Working-tree semantics" section. No-op
    (returns `False`) for a bare repo, a path that isn't a repo yet, or a
    clean working tree. Returns `True` iff a commit was made."""
    repo = _open_if_repo(repo_path)
    if repo is None:
        return False
    try:
        if repo.bare:
            return False
        status = porcelain.status(repo)
        to_add: list[str] = []
        to_remove: list[str] = []
        for raw in list(status.unstaged) + list(status.untracked):
            rel = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            if (repo_path / rel).exists():
                to_add.append(rel)
            else:
                to_remove.append(rel)
        staged = status.staged
        already_staged = bool(staged.get("add") or staged.get("delete") or staged.get("modify"))
        if not to_add and not to_remove and not already_staged:
            return False
        if to_add:
            porcelain.add(repo, paths=to_add)
        if to_remove:
            porcelain.remove(repo, paths=to_remove, cached=True)
        porcelain.commit(
            repo,
            message=WORKTREE_COMMIT_MESSAGE,
            author=VAULT_COMMIT_AUTHOR,
            committer=VAULT_COMMIT_AUTHOR,
        )
        return True
    finally:
        repo.close()


def checkout_head_into_worktree(repo_path: Path) -> bool:
    """See module docstring's "Working-tree semantics" section. Updates the
    index + working tree to match HEAD's current target WITHOUT moving
    HEAD or the branch ref (those are already correct — a push updates them
    directly; this only reconciles files on disk). No-op (returns `False`)
    for a bare repo, a path that isn't a repo yet, or a repo with no
    commits."""
    repo = _open_if_repo(repo_path)
    if repo is None:
        return False
    try:
        if repo.bare:
            return False
        _head_branch, head_oid = _head_branch_and_oid(repo)
        if head_oid is None:
            return False
        index = repo.open_index()
        old_tree_id = index.commit(repo.object_store) if len(index) > 0 else None
        new_commit = repo.object_store[head_oid]
        changes = tree_changes(repo.object_store, old_tree_id, new_commit.tree)
        update_working_tree(
            repo,
            old_tree_id,
            new_commit.tree,
            change_iterator=changes,
            allow_overwrite_modified=True,
        )
        return True
    finally:
        repo.close()

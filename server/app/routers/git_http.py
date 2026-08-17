"""Phase 11 (real sync) — smart-HTTP git server, mounted at `/git` on the
root app (see `main.py`). Two layers, composed bottom-up:

1. **dulwich** (`dulwich.web.HTTPGitApplication`, a WSGI app) implements the
   actual git smart-HTTP protocol (`info/refs`, `git-upload-pack`,
   `git-receive-pack`) against `gitrepo.BareRepoBackend`. Bridged into ASGI
   with `a2wsgi.WSGIMiddleware` (chosen over `starlette.middleware.wsgi`,
   which the installed starlette/fastapi version accepts but flags
   `StarletteDeprecationWarning: ... will be removed ... see a2wsgi as a
   replacement` — confirmed by import at dev time; a2wsgi is the
   upstream-recommended non-deprecated replacement, not a workaround).
2. **`GitAuthMiddleware`** (this file) wraps that WSGI bridge and runs
   BEFORE it on every request: parses `Authorization` (Basic or Bearer),
   resolves it against the exact same `ApiToken` table / `security.hash_token`
   Phase 9 already built (never a second token system), enforces the
   read-vs-write scope split, and — only for an authorized WRITE request —
   creates the bare repo on demand if it doesn't exist yet. A request that
   fails any of this never reaches dulwich at all.

**Why authenticate here instead of via FastAPI `Depends`:** dulwich's WSGI
app is opaque to FastAPI's dependency injection (it's a plain
`environ, start_response` callable, not a set of `APIRouter` routes) — the
standard way to gate an arbitrary mounted ASGI/WSGI app is a wrapping ASGI
middleware that either short-circuits with its own `Response` or calls
through to the inner app, which is exactly `GitAuthMiddleware` below.

**No CORS (Phase 10.5a, roadmap §5.4)**: the single-origin refactor made the
browser's own isomorphic-git client talk to `/git/*` SAME-origin (the sync
remote is implicitly `<origin>/git/vault.git` — see `useGitStore.ts`), so
the cross-origin preflight this router used to need (Phase 11's original
CORSMiddleware, scoped to `SLATE_CORS_ORIGINS`) no longer applies and has
been removed entirely — same "CORS: none, anywhere" posture as `/api` and
`/share/*`. External git clients (system `git`, scripts) were never
same-origin browser `fetch()` calls in the first place and never needed
CORS headers to read the response.

**`WWW-Authenticate` is gated to real git clients (Phase 12, DESIGN-SPEC
Amendments round 4 item 26a)**: a browser `fetch()` that receives a 401
carrying `WWW-Authenticate: Basic` on ANY response pops the browser's own
native credential dialog — this bit the user live, roughly every 60s, from
`App.tsx`'s background `/git` poll firing while signed out. `_is_git_client`/
`_unauthenticated_response` below send that header only when the request's
`User-Agent` starts with `git/` (real git's own convention); every other
401 (browser fetch, curl with no UA override, a missing UA) is
byte-identical in status and body, just without the one header that
triggers the popup. This is intentionally the ONLY thing that's
conditional — the authorization decision itself never changes, so `git
clone`/`push`/`pull` from a real git client (which always sends a `git/…`
UA) keeps getting the challenge it depends on
(`tests/test_git_sync.py::test_live_tokenless_push_rejected`, unchanged).

**Phase 17 Milestone A — the vault repo NAME routes to the definitive path**:
every OTHER repo name still resolves via `gitrepo.resolve_repo_path`
(`{git_root}/{name}.git`, created on demand on first authorized write,
completely unchanged). The one name matching `settings.vault_repo_name`
instead resolves via `vault.resolve_git_repo_path`/`vault.vault_repo_path` —
either the legacy bare repo (identical shape+behavior to before) or, once
`VSNOTE_VAULT_PATH` is set, the real mounted working tree. See `vault.py`'s
module docstring for the full identity + working-tree contract; this file
only wires it into three places: `_VaultAwareBackend` (reads, below),
`GitAuthMiddleware`'s pre-request init check (a MOUNTED-but-uninitialized
vault is NEVER auto-created — see that class's docstring for the exact
status codes), and the pre-serve-commit / post-receive-checkout hooks
(`vault.commit_worktree_changes`/`vault.checkout_head_into_worktree`) that
keep a mounted vault's on-disk files and its git history from clobbering
each other.

**Phase 17 Milestone B — a successful push against the vault also triggers
mirroring**: `GitAuthMiddleware` buffers the response for EVERY write
request against the vault repo name now (both shapes, not just mounted —
see that class's docstring for why widening this from "mounted only" costs
nothing: the git-receive-pack response body itself is a few small status
lines, never the pushed object data), and once dulwich's own response is
fully assembled with a success status, calls
`self.mirror_runner.trigger_push_on_receive()` (a no-op if `mirror_runner`
is `None`) AFTER the buffered response has already been replayed to the
real client — see `app/mirror.py`'s module docstring for why this never
delays the push's own HTTP response.
"""

from __future__ import annotations

import base64
import re
import time
from pathlib import Path
from typing import Iterable, Optional

from a2wsgi import WSGIMiddleware
from dulwich.errors import NotGitRepository
from dulwich.repo import Repo
from dulwich.server import CAPABILITY_OFS_DELTA, CAPABILITY_SIDE_BAND_64K, UploadPackHandler
from dulwich.web import HTTPGitApplication
from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .. import vault
from ..auth import resolve_bearer_token
from ..config import Settings
from ..gitrepo import BareRepoBackend, InvalidRepoName, ensure_bare_repo, resolve_repo_path
from ..mirror import MirrorRunner

# Matches the repo-name segment of any git-protocol URL under this mount,
# e.g. `/myvault.git/info/refs` or `/myvault.git/git-receive-pack`. The name
# group reuses `gitrepo.REPO_NAME_RE`'s exact character class so a request
# that doesn't even shape-match never reaches auth/backend logic at all.
GIT_REQUEST_RE = re.compile(r"^/(?P<name>[A-Za-z0-9_-]{1,64})\.git(?:/.*)?$")

WWW_AUTHENTICATE = 'Basic realm="vsnote-git"'

# Phase 17 Milestone A — a WRITE request against a mounted vault path that
# hasn't been explicitly initialized yet (`POST /api/vault/init`) is refused
# with this, never auto-created. One row, no em dash (this is a real
# response body a git client's stderr can surface verbatim).
VAULT_NOT_INITIALIZED_MESSAGE = "Vault not initialized. Use POST /api/vault/init first.\n"


class _VaultAwareBackend(BareRepoBackend):
    """Identical to `gitrepo.BareRepoBackend`, except repo-name resolution
    goes through `vault.resolve_git_repo_path` so the ONE name matching
    `settings.vault_repo_name` opens the definitive vault path (mounted or
    legacy) instead of the plain `{git_root}/{name}.git` guess every other
    repo name still uses, completely unchanged. Defined here rather than in
    `gitrepo.py` to avoid a `gitrepo` <-> `vault` import cycle: `vault.py`
    already imports `gitrepo.py` for `REPO_NAME_RE`/`resolve_repo_path`/
    `DEFAULT_CLIENT_BRANCH`, so the routing decision has to live on the
    `vault` side, and this thin subclass is what wires it into dulwich's
    `Backend` interface (`open_repository`, dulwich's own read-path entry
    point — the mirror of `open_repository`'s override in the base class,
    see that docstring for the bytes-vs-str path-normalization note, which
    applies identically here)."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(Path(settings.git_root))
        self.settings = settings

    def open_repository(self, path: "str | bytes"):
        if isinstance(path, bytes):
            path = path.decode("utf-8")
        try:
            resolved = vault.resolve_git_repo_path(self.settings, path)
        except InvalidRepoName as exc:
            raise NotGitRepository(str(exc)) from exc
        if not resolved.exists():
            raise NotGitRepository(f"No repository at {path!r}")
        return Repo(str(resolved))


def _is_git_client(user_agent: Optional[str]) -> bool:
    """DESIGN-SPEC Amendments round 4 item 26a: the `WWW-Authenticate: Basic`
    challenge on a 401 is what makes a BROWSER pop its native credential
    dialog the instant it sees the header on any fetch response — including
    the background `/git` polling fetch this app itself makes while signed
    out (roughly every 60s, per `App.tsx`'s `GIT_BACKGROUND_FETCH_MS`; the
    user-visible bug this item fixes). Real git clients, on the other hand,
    NEED that header — it's the standard signal `git`'s own credential
    helper machinery watches for to know it should prompt/retry with
    credentials at all (see `git_receive_pack`/`git_upload_pack` calls in
    git's own `http.c`); dropping it for a real git client would silently
    break `git clone`/`push`/`pull` from the CLI (`tests/test_git_sync.py`'s
    live round-trip tests pin exactly this).

    The fix is narrow and additive: only the PRESENCE of the challenge
    header is conditional. Status code, body, and the authorization
    decision itself are identical either way — see the module docstring's
    `browser-shaped request` / `git-shaped request` comparison and
    `_unauthenticated_response` below, this function's only caller.

    Real git (`user-agent: git/2.43.0`, confirmed against the system git in
    this environment) always identifies itself with a `git/` prefix —
    that's git's own convention, not something this app invented (see
    `http.c::user_agent` upstream). A missing User-Agent is treated as NOT a
    git client (fail toward "no challenge" — the safer default when unsure,
    since the whole point is to stop handing out a header that pops a
    browser dialog; a real git client always sends SOME `git/...` UA, so a
    missing header is never a real git client in practice). Case-insensitive
    since HTTP header VALUES aren't normalized by case the way header NAMES
    are, and matching on this string specifically is a deliberate courtesy,
    not a spec requirement.
    """
    if not user_agent:
        return False
    return user_agent.strip().lower().startswith("git/")


def _unauthenticated_response(user_agent: Optional[str]) -> PlainTextResponse:
    """`401 Authentication required`, with the `WWW-Authenticate` challenge
    ONLY when the caller looks like a real git client (see `_is_git_client`
    above) — every other caller (a browser fetch, curl with no UA override,
    this app's own isomorphic-git-over-`fetch` background poll) gets the
    identical status and body, just without the header that would otherwise
    trigger a native browser login prompt."""
    headers = {"WWW-Authenticate": WWW_AUTHENTICATE} if _is_git_client(user_agent) else None
    return PlainTextResponse("Authentication required", status_code=401, headers=headers)


class BrowserCompatibleUploadPackHandler(UploadPackHandler):
    """Works around a real, confirmed dulwich/isomorphic-git interop bug —
    NOT a hypothetical concern, this was caught live while verifying Phase
    11's fetch/pull path against a real browser client.

    `dulwich.server.UploadPackHandler.required_capabilities()` hardcodes
    `thin-pack` as REQUIRED: any fetch/pull request whose capability list
    doesn't include it makes `Handler.set_client_capabilities` raise
    `GitProtocolError("Client does not support required capability
    b'thin-pack'.")`. isomorphic-git's `fetch()` never requests `thin-pack`
    at all (confirmed by logging its actual request: `multi_ack_detailed
    no-done side-band-64k ofs-delta` — no `thin-pack`), so EVERY fetch/pull
    from the browser client hit this. Worse, the failure is invisible on
    the wire: dulwich has already sent `200 OK` + real headers before this
    exception fires deep inside pack generation, so the HTTP response
    silently truncates to an EMPTY body instead of an error status —
    isomorphic-git's `fetch()` resolves "successfully" with a `fetchHead`
    (ref discovery, a separate earlier request, is unaffected) but writes
    zero pack objects, and every later `git.log`/`readObject` against that
    oid then fails with `NotFoundError`. Confirmed via a raw `curl` replay
    of the exact negotiation body: `200 OK`, `Content-Length`-less chunked
    response, 0 actual bytes.

    `thin-pack` is a pure wire-optimization (server omits base objects the
    client is assumed to already have locally, client reconstructs deltas
    against them) — it is not required for CORRECTNESS, only for pack
    size. Dropping it from the required set just means dulwich always
    sends a complete, self-contained (non-thin) pack: every object is
    still delivered, the fetch just isn't maximally compact. System `git`
    still requests `thin-pack` on its own and gets the optimized path
    unaffected — this override only widens what dulwich ACCEPTS, it never
    changes what it advertises as supported (`capabilities()`, unchanged,
    still lists `thin-pack`).
    """

    @classmethod
    def required_capabilities(cls) -> tuple[bytes, ...]:
        return (CAPABILITY_SIDE_BAND_64K, CAPABILITY_OFS_DELTA)


# Scopes (Phase 9's TokenScope) that satisfy each git operation.
READ_SCOPES = {"read", "write", "share-admin"}
WRITE_SCOPES = {"write", "share-admin"}


def _is_write_request(path: str, query: str) -> bool:
    return path.endswith("git-receive-pack") or "service=git-receive-pack" in query


def _candidate_tokens(auth_header: Optional[str]) -> Iterable[str]:
    """Every plausible token string to try resolving, in priority order.
    Git clients (both system `git` and isomorphic-git) send credentials as
    HTTP Basic (`Authorization: Basic base64(user:pass)`); this project's
    convention (per the phase brief) is "password is the token", but some
    setups put it in the username slot instead (e.g. a client configured
    with the token as username and an empty/placeholder password) — try
    both rather than assume one. `Authorization: Bearer <token>` is accepted
    too, for scripts/curl parity with the rest of `/api`.
    """
    if not auth_header:
        return []
    scheme, _, rest = auth_header.partition(" ")
    scheme = scheme.strip().lower()
    if scheme == "bearer":
        token = rest.strip()
        return [token] if token else []
    if scheme == "basic":
        try:
            decoded = base64.b64decode(rest.strip()).decode("utf-8")
        except Exception:
            return []
        username, _, password = decoded.partition(":")
        candidates = []
        if password:
            candidates.append(password)
        if username and username != password:
            candidates.append(username)
        return candidates
    return []


class GitAuthMiddleware:
    """See module docstring. Pure ASGI — no FastAPI `Depends` involved,
    since the inner app (dulwich via `WSGIMiddleware`) isn't a set of
    FastAPI routes.

    Phase 17 Milestone A adds three things around the vault repo name
    specifically (every other repo name is completely untouched):
    a MOUNTED-but-uninitialized vault's WRITE requests are refused (409,
    `VAULT_NOT_INITIALIZED_MESSAGE`) instead of auto-created —
    `ensure_bare_repo` never runs against a mounted vault path, only
    against the legacy bare shape and every non-vault repo, exactly as
    before; `vault.commit_worktree_changes` runs before EVERY request
    (read or write) against a MOUNTED vault, so a disk edit is folded into
    history before dulwich advertises refs or accepts a push;
    `vault.checkout_head_into_worktree` runs after a WRITE against a
    MOUNTED vault that dulwich actually accepted (HTTP status < 400,
    captured via a thin `send` wrapper — the only reason this class now
    needs to inspect the inner app's response at all), so the working tree
    reflects the pushed branch tip immediately.

    Phase 17 Milestone B adds one more: ANY successful write against the
    vault repo name (mounted or legacy shape) also calls
    `self.mirror_runner.trigger_push_on_receive()` — see `app/mirror.py`'s
    module docstring for the engine this fires and this file's module
    docstring for exactly where in the response lifecycle."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        session_local,
        settings: Settings,
        mirror_runner: "Optional[MirrorRunner]" = None,
    ) -> None:
        self.app = app
        self.session_local = session_local
        self.settings = settings
        self.git_root = Path(settings.git_root)
        # Phase 17 Milestone B — see this class's docstring's last
        # paragraph and `app/mirror.py`'s module docstring. `None` in any
        # test/context that doesn't care about mirroring at all.
        self.mirror_runner = mirror_runner

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # ASGI's `root_path`/`path` contract (this Starlette version follows
        # it literally, confirmed by inspection): `path` is the FULL
        # original path, `root_path` is the mount prefix already consumed
        # ("/git" here) — it is NOT pre-stripped off `path` the way an
        # older Starlette release used to. Strip it ourselves so this
        # middleware's own routing logic sees the same repo-relative shape
        # (`/{repo}.git/...`) regardless of which convention the installed
        # Starlette version follows; `a2wsgi.WSGIMiddleware` downstream
        # handles this translation correctly on its own for the WSGI
        # environ it builds; this is only for our OWN regex/name parsing.
        root_path = scope.get("root_path", "")
        path = scope["path"]
        if root_path and path.startswith(root_path):
            path = path[len(root_path):] or "/"
        query = (scope.get("query_string") or b"").decode("latin-1")

        match = GIT_REQUEST_RE.match(path)
        if not match:
            await PlainTextResponse("Not found", status_code=404)(scope, receive, send)
            return

        headers = Headers(scope=scope)
        auth_header = headers.get("authorization")

        db = self.session_local()
        try:
            token_row = None
            for candidate in _candidate_tokens(auth_header):
                token_row = resolve_bearer_token(db, candidate)
                if token_row is not None:
                    break

            if token_row is None:
                await _unauthenticated_response(headers.get("user-agent"))(scope, receive, send)
                return

            write_request = _is_write_request(path, query)
            allowed = WRITE_SCOPES if write_request else READ_SCOPES
            if token_row.scope.value not in allowed:
                await PlainTextResponse(
                    "Token scope does not permit this operation", status_code=403
                )(scope, receive, send)
                return

            token_row.last_used_at = time.time()
            db.commit()

            repo_name = match.group("name")
            repo_is_vault = repo_name == self.settings.vault_repo_name
            vault_mounted = repo_is_vault and vault.is_mounted(self.settings)

            if write_request:
                if repo_is_vault:
                    vault_path = vault.vault_repo_path(self.settings)
                    if vault.is_mounted(self.settings):
                        # Never auto-created — see module docstring and
                        # `vault.py`'s "respecting an existing .git is
                        # binding" contract. A write against an
                        # uninitialized mounted vault must go through the
                        # explicit `POST /api/vault/init` first.
                        if not vault.vault_repo_exists(vault_path):
                            await PlainTextResponse(
                                VAULT_NOT_INITIALIZED_MESSAGE, status_code=409
                            )(scope, receive, send)
                            return
                    else:
                        # Legacy shape — same on-demand bare-repo creation
                        # every other repo name has always gotten.
                        ensure_bare_repo(vault_path)
                else:
                    try:
                        resolved = resolve_repo_path(self.git_root, "/" + repo_name + ".git")
                    except InvalidRepoName:
                        await PlainTextResponse("Invalid repository name", status_code=400)(scope, receive, send)
                        return
                    ensure_bare_repo(resolved)

            if vault_mounted:
                # Before serving ANY request (read or write) — see
                # `vault.py`'s "Working-tree semantics" doc for why this
                # has to run before a push is even evaluated.
                vault.commit_worktree_changes(vault.vault_repo_path(self.settings))
        finally:
            db.close()

        if write_request and repo_is_vault:
            # BUFFER the whole response instead of streaming it straight
            # through: an HTTP response is the client's actual completion
            # signal (a real `git push` returns control the instant it has
            # read the final response byte), so if we forwarded messages as
            # dulwich produced them, a client could see "success" and move
            # on (e.g. read the file it just pushed) before this coroutine
            # ever got to run `checkout_head_into_worktree` below — a real,
            # observed race, not a hypothetical one. Buffering means the
            # working tree is guaranteed to already reflect the new HEAD by
            # the time the client's HTTP call returns at all. Applied to
            # EVERY vault write now (Phase 17 Milestone B), not just the
            # mounted shape: `git-receive-pack`'s response body is a few
            # small status lines regardless of shape or push size (the
            # actual pushed objects are the REQUEST body, already fully
            # read before dulwich ever starts writing a response), so
            # buffering it costs nothing extra for the legacy bare shape —
            # and it's what lets a mirror trigger below observe the real
            # success/failure status uniformly on both shapes.
            buffered_messages: list = []

            async def _buffering_send(message):
                buffered_messages.append(message)

            await self.app(scope, receive, _buffering_send)
            status = next(
                (m["status"] for m in buffered_messages if m["type"] == "http.response.start"),
                500,
            )
            if status < 400 and vault_mounted:
                vault.checkout_head_into_worktree(vault.vault_repo_path(self.settings))
            should_mirror = status < 400 and self.mirror_runner is not None
            if should_mirror and self.mirror_runner.sync:
                # TEST-ONLY ordering (`MirrorRunner.sync`, never True in
                # production — see that class's docstring): run the mirror
                # BEFORE the response is replayed, so a real `git push`
                # subprocess client only sees "succeeded" once the mirror
                # has actually finished. This is the "expose a way to run
                # it synchronously in tests rather than sleeping" seam —
                # deterministic without polling for a background thread.
                self.mirror_runner.trigger_push_on_receive()
            for message in buffered_messages:
                await send(message)
            if should_mirror and not self.mirror_runner.sync:
                # PRODUCTION ordering: AFTER the response has already been
                # replayed to the real client, in a background thread (see
                # `app/mirror.py`'s module docstring) — a slow/hung remote
                # must never delay the push's own HTTP response.
                self.mirror_runner.trigger_push_on_receive()
            return

        await self.app(scope, receive, send)


def build_git_app(
    settings: Settings,
    session_local,
    *,
    mirror_runner: "Optional[MirrorRunner]" = None,
) -> ASGIApp:
    """Builds the full `/git` sub-app: auth -> dulwich WSGI bridge. Mounted
    verbatim by `main.py::create_app` as `app.mount("/git", ...)` on the
    ROOT app (not `/api`) — git repo names are validated on their own terms
    (`gitrepo.REPO_NAME_RE`). No CORS (see module docstring) — nothing here
    wraps the auth middleware anymore. `mirror_runner` (Phase 17 Milestone
    B, optional — omit for any caller that doesn't care about mirroring,
    e.g. most of `tests/test_git_sync.py`) is threaded straight into
    `GitAuthMiddleware`; see that class's docstring."""
    git_root = Path(settings.git_root)
    git_root.mkdir(parents=True, exist_ok=True)
    if vault.is_mounted(settings):
        # Only ensures the MOUNT DIRECTORY exists (mirroring git_root's own
        # mkdir above) — never a repo. Respecting an existing `.git` is
        # binding; only the explicit `POST /api/vault/init` ever creates
        # one (see `vault.py`'s module docstring).
        Path(settings.vault_path).mkdir(parents=True, exist_ok=True)

    backend = _VaultAwareBackend(settings)
    dulwich_app = HTTPGitApplication(
        backend, dumb=False, handlers={b"git-upload-pack": BrowserCompatibleUploadPackHandler}
    )
    wsgi_bridge = WSGIMiddleware(dulwich_app)
    return GitAuthMiddleware(
        wsgi_bridge, session_local=session_local, settings=settings, mirror_runner=mirror_runner
    )

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

**CORS**: browser isomorphic-git needs `Access-Control-Allow-Origin` (and,
because `Authorization` is a non-simple header and the upload-pack/
receive-pack requests are non-simple POST bodies, a passing CORS
*preflight*) to read the response at all — confirmed empirically per this
phase's report by driving a real cross-origin `fetch` from the SPA's own
`vite preview` origin against a live instance of this router and observing
the browser actually receive the response instead of a CORS-blocked
`TypeError: Failed to fetch`. `CORSMiddleware` is applied HERE, wrapping
`GitAuthMiddleware`, scoped to `settings.cors_origin_list` (same
never-a-wildcard list `/api` uses) — never the `/share/*` root app, whose
zero-CORS posture (`main.py`'s docstring, `tests/test_raw_mode.py::
test_no_cors_on_raw`) this phase does not touch. `CORSMiddleware` answers
the OPTIONS preflight itself, before `GitAuthMiddleware` ever runs, so a
preflight never needs credentials.
"""

from __future__ import annotations

import base64
import re
import time
from pathlib import Path
from typing import Iterable, Optional

from a2wsgi import WSGIMiddleware
from dulwich.server import CAPABILITY_OFS_DELTA, CAPABILITY_SIDE_BAND_64K, UploadPackHandler
from dulwich.web import HTTPGitApplication
from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ..auth import resolve_bearer_token
from ..config import Settings
from ..gitrepo import BareRepoBackend, InvalidRepoName, ensure_bare_repo, resolve_repo_path

# Matches the repo-name segment of any git-protocol URL under this mount,
# e.g. `/myvault.git/info/refs` or `/myvault.git/git-receive-pack`. The name
# group reuses `gitrepo.REPO_NAME_RE`'s exact character class so a request
# that doesn't even shape-match never reaches auth/backend logic at all.
GIT_REQUEST_RE = re.compile(r"^/(?P<name>[A-Za-z0-9_-]{1,64})\.git(?:/.*)?$")

WWW_AUTHENTICATE = 'Basic realm="slate-git"'


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
    FastAPI routes."""

    def __init__(self, app: ASGIApp, *, session_local, git_root: Path) -> None:
        self.app = app
        self.session_local = session_local
        self.git_root = git_root

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
                await PlainTextResponse(
                    "Authentication required",
                    status_code=401,
                    headers={"WWW-Authenticate": WWW_AUTHENTICATE},
                )(scope, receive, send)
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

            if write_request:
                try:
                    resolved = resolve_repo_path(self.git_root, "/" + match.group("name") + ".git")
                except InvalidRepoName:
                    await PlainTextResponse("Invalid repository name", status_code=400)(scope, receive, send)
                    return
                ensure_bare_repo(resolved)
        finally:
            db.close()

        await self.app(scope, receive, send)


def build_git_app(settings: Settings, session_local) -> ASGIApp:
    """Builds the full `/git` sub-app: CORS -> auth -> dulwich WSGI bridge.
    Mounted verbatim by `main.py::create_app` as `app.mount("/git", ...)` on
    the ROOT app (not `/api`) — git repo names are validated on their own
    terms (`gitrepo.REPO_NAME_RE`), so this doesn't need to share `/api`'s
    CORS instance, and keeping it off the root app's own middleware stack
    means `/share/*`'s zero-CORS posture is untouched either way."""
    git_root = Path(settings.git_root)
    git_root.mkdir(parents=True, exist_ok=True)

    backend = BareRepoBackend(git_root)
    dulwich_app = HTTPGitApplication(
        backend, dumb=False, handlers={b"git-upload-pack": BrowserCompatibleUploadPackHandler}
    )
    wsgi_bridge = WSGIMiddleware(dulwich_app)
    authed = GitAuthMiddleware(wsgi_bridge, session_local=session_local, git_root=git_root)

    return CORSMiddleware(
        authed,
        allow_origins=settings.cors_origin_list,  # never "*" — config.py has no wildcard escape hatch
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Type"],
        max_age=600,
    )

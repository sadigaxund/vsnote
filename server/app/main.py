"""App factory. `create_app()` builds a fully self-contained FastAPI app
(own engine, own sessionmaker, own Limiter, own JWKS fetcher) so pytest can
spin up as many isolated instances as it wants (see tests/conftest.py) with
zero shared global state. `uvicorn app.main:app` (via `npm run server`)
resolves the module-level `app` attribute lazily — see the `__getattr__`
at the bottom of this file. Plain `import app.main` (or `from app.main
import create_app`, what every test does) never builds anything and never
touches disk: `app` only gets built the first time something actually reads
`app.main.app`, which is exactly the uvicorn/production case this line
exists for. This is a real, non-heuristic distinction (PEP 562 module
`__getattr__`, standard library since 3.7) — not a check for whether pytest
happens to be importable in the current process, which would misfire for
any OTHER tool that imports this module without needing the instance.

Two nested ASGI apps, deliberately:
  - `app` (root): `/share/*`, `/git/*` (mounted below), and — as of Phase
    10.5a's single-origin refactor (roadmap §5.4) — the built SPA itself
    (static assets + fallback, see "Single-origin SPA serving" below). NO
    CORSMiddleware anywhere on this app — a raw share response must carry
    zero CORS headers (roadmap §1; see tests/test_raw_mode.py::
    test_no_cors_on_raw), and neither `/git/*` nor the SPA assets need it
    once the browser talks to all of it same-origin.
  - `api_app` (mounted at `/api`): everything else, INCLUDING the public
    `GET /api/share/{id}/content` route (see routers/share_public.py's
    `build_content_router` docstring for why that one specific public route
    lives here instead of on the root app). Also NO CORSMiddleware as of
    Phase 10.5a — same-origin needs none, and the roadmap's "CORS: none,
    anywhere" is now literal, not "none except /api".

--- Phase 10.5a: single-origin SPA serving (roadmap §5.4) -------------------

FastAPI is now the ONLY server: it serves the built SPA (`../dist`, i.e.
the repo-root `dist/` produced by `npm run build`) alongside `/api`,
`/share/*`, and `/git/*`, so a Cloudflare tunnel (or anything else) only
ever has to point at one process/port. Two pieces, both registered on the
ROOT app AFTER `/share/*` and the `/git` mount so those keep matching
first (Starlette tries routes/mounts in registration order — a more
specific match registered earlier always wins over a catch-all registered
later):

1. `app.state.spa_index_html` — the built `dist/index.html`'s bytes, read
   once at `create_app()` time, or `None` if `dist/` hasn't been built yet
   (fresh checkout). `routers/share_public.py` reads this directly off
   `request.app.state` to serve the SPA shell for a real browser
   navigation (`Accept: text/html`) to an already-AUTHORIZED rendered-mode
   file share or ANY folder share — see that module's `_spa_shell_response`
   doc for why this lives in the SUCCESS path only, never the denial path
   (that split is what keeps `/share/<bogus>` returning the byte-identical
   JSON 404 instead of ever handing out the app shell — the whole point of
   this split, and the thing an independent oracle probe checks for).
2. `_spa_catch_all` (this file) — registered dead last, matches literally
   any path Starlette hasn't already claimed (`/`, `/assets/*.js`,
   `/favicon.svg`, any client-side path). Serves the matching file straight
   off `dist/` when one exists at that path (hashed JS/CSS chunks, PWA
   icons, `manifest.webmanifest`, `sw.js`, ...), else falls back to
   `index.html` (SPA client-side "routing" — this app has none beyond
   `/share/*`, which is never reached here, but a stray deep link should
   still get *something* coherent rather than a bare 404). Never reached
   for `/api/*` (claimed by the `/api` mount above) or `/git/*`/`/share/*`
   (claimed earlier) — a truly unmatched `/api/xyz` still gets FastAPI's
   own 404 from inside `api_app`, never this fallback's `index.html`.
   Missing `dist/` degrades to a plain 404 here with a one-line startup log
   explaining why, rather than crashing the process — the API (and, for an
   already-loaded/PWA-cached client, the whole app) stays fully usable with
   no build present (CLAUDE.md rule 3).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from . import models, security
from .auth import JWKSFetcher, build_auth_deps
from .config import Settings, resolve_secret_key
from .db import Base, make_engine, make_sessionmaker
from .routers import auth as auth_router
from .routers import git_http as git_http_router
from .routers import share_public as share_public_router
from .routers import shares as shares_router

logger = logging.getLogger(__name__)

# repo root's `dist/` — `server/app/main.py` -> `server/app` -> `server` ->
# repo root, so `parents[2]`. Vite's build output (`npm run build`), never
# committed, so this genuinely may not exist (fresh checkout, no build yet).
DIST_DIR = Path(__file__).resolve().parents[2] / "dist"


def bootstrap_user(session_local, settings: Settings) -> None:
    """Phase 12 (DESIGN-SPEC Amendments round 4, item 32) — "fallback-login
    onboarding". Before this, NOTHING ever created a `User` row outside
    `scripts/demo.sh`'s own ad-hoc inline bootstrap, so the app-level
    username+password login (`routers/auth.py::login`) was dead in any real
    deployment. Called once from `create_app()`, right after
    `Base.metadata.create_all` — so the `users` table definitely exists by
    the time this runs, in every code path (fresh DB or not).

    Contract (every clause independently load-bearing, tested in
    `tests/test_bootstrap.py`):
      - Both `VSNOTE_BOOTSTRAP_USER`/`VSNOTE_BOOTSTRAP_PASSWORD` unset: a
        complete, silent no-op — this feature is fully opt-in.
      - Exactly ONE set: fails LOUDLY at startup (`RuntimeError`, so the
        process never comes up half-configured) rather than silently
        creating an account with an empty username or password. The error
        message names the two env vars, never a value — nothing here ever
        has the actual password in hand to leak in the first place except
        the one `hash_password` call below, and that value never flows into
        a log/exception/repr anywhere in this function.
      - Both set AND the `users` table is completely empty: creates exactly
        one admin user (`is_admin=True`, matching `scripts/demo.sh`'s own
        bootstrap-owner shape) with that username, argon2id-hashed password
        (`security.hash_password` — the SAME hashing path
        `scripts/create_user.py` and every other password in this app use;
        never a second scheme). Only the USERNAME is logged on success,
        never the password.
      - Both set AND the `users` table already has at least one row (from
        ANY source — a previous bootstrap run, `demo.sh`, `create_user.py`,
        Cf-Access auto-provisioning): a complete no-op. This is what makes
        the function safe to call on every single startup (as `create_app`
        does) without ever overwriting an existing password — the check is
        "does ANY user exist", not "does a user with this exact username
        already exist", so a returning deployment's real password is never
        at risk of being silently reset by a stale env var still sitting in
        its `.env` file.
    """
    user = settings.bootstrap_user
    password = settings.bootstrap_password
    if not user and not password:
        return
    if not user or not password:
        raise RuntimeError(
            "VSNOTE_BOOTSTRAP_USER and VSNOTE_BOOTSTRAP_PASSWORD must both be set together "
            "(or neither) — refusing to create a half-configured bootstrap account."
        )

    db = session_local()
    try:
        if db.query(models.User).count() > 0:
            return  # never overwrite/reset anything once ANY user exists
        db.add(
            models.User(
                username=user,
                password_hash=security.hash_password(password),
                email=None,
                is_admin=True,
            )
        )
        db.commit()
        logger.info("Bootstrap: created initial user %r (users table was empty)", user)
    finally:
        db.close()


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    secret_key = resolve_secret_key(settings)

    engine = make_engine(settings.db_url)
    SessionLocal = make_sessionmaker(engine)
    Base.metadata.create_all(engine)
    bootstrap_user(SessionLocal, settings)

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit_default])
    jwks_fetcher = JWKSFetcher(settings.cf_access_team_domain)
    auth_deps = build_auth_deps(get_db, settings, secret_key, jwks_fetcher)

    # --- root app: /share/*, /git/*, the SPA — no CORS anywhere --------
    app = FastAPI(title="VSNote backend")
    app.state.settings = settings
    app.state.secret_key = secret_key
    app.state.limiter = limiter
    app.state.SessionLocal = SessionLocal
    app.state.cf_jwks_fetcher = jwks_fetcher
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.include_router(share_public_router.build_router(get_db, limiter, settings, secret_key, auth_deps))

    # Phase 11 (real sync) — bare git repos over smart-HTTP, `/git/{repo}.git/...`.
    # Mounted on the ROOT app (alongside `/share/*`). No CORS (Phase 10.5a,
    # roadmap §5.4) — the browser now talks to this same-origin, and
    # external git clients never needed CORS headers in the first place
    # (see `git_http.py`'s module docstring).
    app.mount("/git", git_http_router.build_git_app(settings, SessionLocal))

    # --- /api sub-app: no CORS (Phase 10.5a, roadmap §5.4) --------------
    api_app = FastAPI(title="VSNote API")
    api_app.state.settings = settings
    api_app.state.secret_key = secret_key
    api_app.state.limiter = limiter
    api_app.state.SessionLocal = SessionLocal
    api_app.state.cf_jwks_fetcher = jwks_fetcher
    api_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    api_app.add_middleware(SlowAPIMiddleware)
    api_app.include_router(auth_router.build_router(get_db, limiter, settings, secret_key, auth_deps))
    api_app.include_router(shares_router.build_router(get_db, limiter, settings, secret_key, auth_deps))
    api_app.include_router(share_public_router.build_content_router(get_db, limiter, settings, secret_key, auth_deps))

    app.mount("/api", api_app)

    # --- Single-origin SPA serving (Phase 10.5a, roadmap §5.4) ----------
    # Registered LAST and deliberately as a plain catch-all route (not a
    # `StaticFiles` mount at "/") so it can never shadow `/share/*`/`/git/*`
    # (registered above — Starlette matches routes/mounts in registration
    # order, so those already-registered, more specific matches always win)
    # or `/api/*` (a separate mounted sub-app — an unmatched path under it
    # never reaches anything outside that mount, so it keeps returning
    # api_app's own 404 untouched, never this fallback's index.html).
    index_html = DIST_DIR / "index.html"
    if index_html.is_file():
        app.state.spa_index_html = index_html.read_bytes()
        logger.info("Serving built SPA from %s", DIST_DIR)
    else:
        app.state.spa_index_html = None
        logger.warning(
            "No built SPA found at %s (run `npm run build` from the repo root) — "
            "the API/share/git surfaces still work; only static serving is unavailable.",
            DIST_DIR,
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_catch_all(full_path: str) -> Response:
        if app.state.spa_index_html is None:
            return Response(status_code=404, content="Not found")
        # Real file at that path under dist/ (hashed JS/CSS chunks, PWA
        # icons, manifest.webmanifest, sw.js, favicon, ...) — resolved and
        # re-checked against DIST_DIR so a `full_path` containing `..`
        # can't escape it (belt-and-suspenders; Starlette's own `path`
        # converter already rejects `..` segments, this doesn't rely on
        # that alone).
        candidate = (DIST_DIR / full_path).resolve()
        if candidate.is_file() and DIST_DIR in candidate.parents:
            return FileResponse(candidate)
        return Response(content=app.state.spa_index_html, media_type="text/html; charset=utf-8")

    # Exposed for tests/introspection: tests override the JWKS fetch via
    # `app.state.cf_jwks_fetcher.override = lambda: FAKE_JWKS` (both app and
    # api_app share the exact same JWKSFetcher instance, so this works no
    # matter which one a test reaches for).
    return app


def __getattr__(name: str):
    """PEP 562 module-level lazy attribute. `app` is built on first REAL
    access to `app.main.app` (e.g. uvicorn's `import_from_string("app.main:
    app")`, which does a plain `getattr`) — not merely on import. Every
    pytest test does `from app.main import create_app` (or imports
    something that transitively imports this module), which never
    references the `app` name at all, so it never triggers this and never
    has the side effect of building a default-settings app / writing a
    stray server/vsnote.db (confirmed: `python -c "import app.main"` writes
    no file — see docs/ARCHITECTURE.md's Deviations entry for the earlier,
    weaker `sys.modules` heuristic this replaced and why it was wrong: it
    only special-cased pytest specifically, not "nobody actually asked for
    the instance").
    """
    if name == "app":
        instance = create_app()
        globals()["app"] = instance  # cache: only ever built once per process
        return instance
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

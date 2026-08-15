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
  - `app` (root): `/share/*` only. NO CORSMiddleware — a raw share response
    must carry zero CORS headers (roadmap §1; see
    tests/test_raw_mode.py::test_no_cors_on_raw).
  - `api_app` (mounted at `/api`): everything else, INCLUDING the public
    `GET /api/share/{id}/content` route (see routers/share_public.py's
    `build_content_router` docstring for why that one specific public route
    lives here instead of on the root app) — CORS locked to the configured
    SPA origins, `allow_credentials=True`, never a wildcard.
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from .auth import JWKSFetcher, build_auth_deps
from .config import Settings, resolve_secret_key
from .db import Base, make_engine, make_sessionmaker
from .routers import auth as auth_router
from .routers import git_http as git_http_router
from .routers import share_public as share_public_router
from .routers import shares as shares_router


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    secret_key = resolve_secret_key(settings)

    engine = make_engine(settings.db_url)
    SessionLocal = make_sessionmaker(engine)
    Base.metadata.create_all(engine)

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit_default])
    jwks_fetcher = JWKSFetcher(settings.cf_access_team_domain)
    auth_deps = build_auth_deps(get_db, settings, secret_key, jwks_fetcher)

    # --- root app: /share/* only, no CORS -----------------------------
    app = FastAPI(title="Slate backend")
    app.state.settings = settings
    app.state.secret_key = secret_key
    app.state.limiter = limiter
    app.state.SessionLocal = SessionLocal
    app.state.cf_jwks_fetcher = jwks_fetcher
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.include_router(share_public_router.build_router(get_db, limiter, settings, secret_key, auth_deps))

    # Phase 11 (real sync) — bare git repos over smart-HTTP, `/git/{repo}.git/...`.
    # Mounted on the ROOT app (alongside `/share/*`) but with its OWN CORS
    # middleware (see `git_http.build_git_app`'s docstring) — `/share/*`
    # itself stays exactly as CORS-less as before; this is a sibling mount,
    # not a change to the app-wide middleware stack. Auth is Phase 9 API
    # tokens (Basic/Bearer), never cookies/CF-Access, so it doesn't need
    # `allow_credentials`.
    app.mount("/git", git_http_router.build_git_app(settings, SessionLocal))

    # --- /api sub-app: CORS-enabled -------------------------------------
    api_app = FastAPI(title="Slate API")
    api_app.state.settings = settings
    api_app.state.secret_key = secret_key
    api_app.state.limiter = limiter
    api_app.state.SessionLocal = SessionLocal
    api_app.state.cf_jwks_fetcher = jwks_fetcher
    api_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    api_app.add_middleware(SlowAPIMiddleware)
    api_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,  # never "*" — config.py has no wildcard escape hatch
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    api_app.include_router(auth_router.build_router(get_db, limiter, settings, secret_key, auth_deps))
    api_app.include_router(shares_router.build_router(get_db, limiter, settings, secret_key, auth_deps))
    api_app.include_router(share_public_router.build_content_router(get_db, limiter, settings, secret_key, auth_deps))

    app.mount("/api", api_app)

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
    stray server/slate.db (confirmed: `python -c "import app.main"` writes
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

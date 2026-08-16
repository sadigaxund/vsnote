"""Identity resolution for the owner-side (/api) surface, plus the
`/share/*` "who is this, if anyone" lookup used by policy.py's `restricted`
general-access check.

Three ways to authenticate, tried in this order by `get_optional_auth_context`:
  1. `Cf-Access-Jwt-Assertion` header — verified (signature + issuer +
     audience + exp/nbf) against the configured team domain's JWKS. NEVER
     trusted just because the header is present, and NEVER trusts
     `Cf-Access-Authenticated-User-Email` on its own (that header is not
     signed and is trivially spoofable if anything upstream forwards it
     unchecked). When CF Access isn't configured, this path is skipped
     entirely — not an implicit allow.
  2. The app's own signed session cookie (`POST /api/auth/login`).
  3. `Authorization: Bearer <token>` — a scoped ApiToken.

Magic-link auth is a deliberate, documented stub at the bottom of
routers/auth.py — DEFERRED per roadmap §2 (needs email infra).
"""

from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional, Set

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import models, security
from .config import Settings

APP_SESSION_COOKIE = "vsnote_session"


class JWKSFetcher:
    """Fetches + caches the Cloudflare Access team domain's JWKS (the
    `/cdn-cgi/access/certs` endpoint). `.override` is a test hook: set it to
    a callable returning a static JWKS dict instead of touching the network
    — every CF-Access pytest in tests/test_auth.py uses this, never a real
    HTTP call."""

    def __init__(self, team_domain: Optional[str]):
        self.team_domain = team_domain
        self.override: Optional[Callable[[], dict]] = None
        self._cache: Optional[dict] = None
        self._cache_time: float = 0.0

    def fetch(self) -> dict:
        if self.override is not None:
            return self.override()
        if not self.team_domain:
            raise RuntimeError("CF Access is not configured (no team domain)")
        now = time.time()
        if self._cache is not None and now - self._cache_time < 3600:
            return self._cache
        url = f"https://{self.team_domain}/cdn-cgi/access/certs"
        with urllib.request.urlopen(url, timeout=5) as resp:  # pragma: no cover - real network path
            data = json.loads(resp.read())
        self._cache = data
        self._cache_time = now
        return data


def verify_cf_access_jwt(token: str, settings: Settings, jwks_fetcher: JWKSFetcher) -> Optional[dict]:
    """Returns decoded claims on success, or None on ANY failure —
    unconfigured server, bad/unknown signature, wrong issuer/audience,
    expired. Callers must treat None as "no identity from this path", never
    as an implicit allow."""
    if not settings.cf_access_team_domain or not settings.cf_access_aud:
        return None
    try:
        jwks = jwks_fetcher.fetch()
    except Exception:
        return None
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    kid = header.get("kid")
    keys = jwks.get("keys") or jwks.get("public_certs") or []
    key = None
    for jwk_key in keys:
        if jwk_key.get("kid") == kid:
            try:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk_key))
            except Exception:
                return None
            break
    if key is None:
        return None
    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            audience=settings.cf_access_aud,
            issuer=f"https://{settings.cf_access_team_domain}",
            options={"require": ["exp", "iat"]},
        )
        return claims
    except jwt.PyJWTError:
        return None


def create_app_session_cookie(secret_key: str, user: "models.User", ttl_min: int) -> str:
    payload = {"kind": "app_session", "uid": user.id, "exp": time.time() + ttl_min * 60}
    return security.make_signed_cookie(secret_key, payload)


def read_app_session_user(db: Session, secret_key: str, cookie_value: Optional[str]) -> Optional["models.User"]:
    if not cookie_value:
        return None
    payload = security.verify_signed_cookie(secret_key, cookie_value)
    if not payload or payload.get("kind") != "app_session":
        return None
    uid = payload.get("uid")
    if uid is None:
        return None
    return db.get(models.User, uid)


def resolve_bearer_token(db: Session, token: Optional[str]) -> Optional["models.ApiToken"]:
    if not token:
        return None
    row = db.query(models.ApiToken).filter(models.ApiToken.token_hash == security.hash_token(token)).one_or_none()
    if row is None:
        return None
    if row.revoked_at is not None:
        return None
    if row.expires_at is not None and row.expires_at < time.time():
        return None
    return row


def _get_or_create_cf_user(db: Session, email: str) -> "models.User":
    user = db.query(models.User).filter(models.User.email == email).one_or_none()
    if user is not None:
        return user
    user = models.User(username=email, email=email, password_hash=None, is_admin=False)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@dataclass
class AuthContext:
    principal: str
    user: "models.User"
    scope: Optional[models.TokenScope]  # None == full session-derived rights
    source: str  # "cf_access" | "session" | "bearer"


@dataclass
class AuthDeps:
    """Bundles the FastAPI dependency callables built for one app instance
    (one Settings + one SessionLocal + one JWKSFetcher + one secret key) —
    see main.py's create_app(). Router modules receive this instead of
    reaching for module-level globals, so every pytest test gets a fully
    isolated app."""

    get_optional_auth_context: Callable
    require_auth_context: Callable
    require_scope: Callable[[Set[str]], Callable]


def build_auth_deps(get_db, settings: Settings, secret_key: str, jwks_fetcher: JWKSFetcher) -> AuthDeps:
    def get_optional_auth_context(
        request: Request, db: Session = Depends(get_db)
    ) -> Optional[AuthContext]:
        # 1. Cf-Access JWT (verified — never the raw header trusted alone).
        cf_token = request.headers.get("cf-access-jwt-assertion")
        if cf_token:
            claims = verify_cf_access_jwt(cf_token, settings, jwks_fetcher)
            if claims and claims.get("email"):
                user = _get_or_create_cf_user(db, claims["email"])
                return AuthContext(principal=user.email or user.username, user=user, scope=None, source="cf_access")

        # 2. App session cookie.
        cookie_value = request.cookies.get(APP_SESSION_COOKIE)
        user = read_app_session_user(db, secret_key, cookie_value)
        if user is not None:
            return AuthContext(principal=user.email or user.username, user=user, scope=None, source="session")

        # 3. Bearer token.
        authz = request.headers.get("authorization")
        if authz and authz.lower().startswith("bearer "):
            token_row = resolve_bearer_token(db, authz[7:].strip())
            if token_row is not None:
                token_row.last_used_at = time.time()
                db.commit()
                owner = db.get(models.User, token_row.user_id)
                if owner is not None:
                    return AuthContext(
                        principal=owner.email or owner.username,
                        user=owner,
                        scope=token_row.scope,
                        source="bearer",
                    )
        return None

    def require_auth_context(ctx: Optional[AuthContext] = Depends(get_optional_auth_context)) -> AuthContext:
        if ctx is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        return ctx

    def require_scope(allowed: Set[str]):
        def _dep(ctx: AuthContext = Depends(require_auth_context)) -> AuthContext:
            if ctx.scope is None:
                return ctx  # full session-derived rights (Cf-Access or password login)
            if ctx.scope.value in allowed:
                return ctx
            raise HTTPException(status_code=403, detail="Token scope does not permit this operation")

        return _dep

    return AuthDeps(
        get_optional_auth_context=get_optional_auth_context,
        require_auth_context=require_auth_context,
        require_scope=require_scope,
    )

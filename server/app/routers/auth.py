"""`/api/auth/*` — fallback username+password login, session cookies, API
token CRUD, and a deliberate magic-link stub. Mounted under the CORS-enabled
`/api` sub-app (see main.py); every route here sits behind app-level
identity, not the `/share/*` policy gate.
"""

from __future__ import annotations

import time
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from slowapi import Limiter

from .. import models, security, schemas
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps, APP_SESSION_COOKIE, create_app_session_cookie
from ..config import Settings


def build_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.post("/login")
    @limiter.limit(settings.rate_limit_share_auth)
    def login(request: Request, response: Response, payload: schemas.LoginRequest, db: Session = Depends(get_db)):
        user = db.query(models.User).filter(models.User.username == payload.username).one_or_none()
        # Generic, ~constant-time failure for BOTH "no such user" and "wrong
        # password" — same status, same body, and an argon2 verify runs
        # either way so account existence can't be timed either.
        if user is None or user.password_hash is None:
            security.verify_password_constant_time_for_missing_user(payload.password)
            write_audit_event(db, "login.failure", principal=payload.username, reason="unknown_user_or_sso_only", request=request)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if not security.verify_password(user.password_hash, payload.password):
            write_audit_event(db, "login.failure", principal=payload.username, reason="wrong_password", request=request)
            raise HTTPException(status_code=401, detail="Invalid username or password")

        cookie = create_app_session_cookie(secret_key, user, settings.session_ttl_min)
        response.set_cookie(
            APP_SESSION_COOKIE,
            cookie,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
            max_age=settings.session_ttl_min * 60,
        )
        write_audit_event(db, "login.success", principal=user.username, request=request)
        return {"username": user.username, "email": user.email}

    @router.post("/logout")
    def logout(response: Response):
        response.delete_cookie(APP_SESSION_COOKIE, path="/")
        return {"ok": True}

    @router.get("/whoami", response_model=schemas.WhoAmIOut)
    def whoami(ctx: AuthContext | None = Depends(auth_deps.get_optional_auth_context)):
        if ctx is None:
            return schemas.WhoAmIOut(authenticated=False)
        return schemas.WhoAmIOut(
            authenticated=True,
            username=ctx.user.username,
            email=ctx.user.email,
            is_admin=ctx.user.is_admin,
            source=ctx.source,
        )

    @router.post("/tokens", response_model=schemas.TokenCreateOut, status_code=201)
    def create_token(
        request: Request,
        payload: schemas.TokenCreateIn,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        plaintext = security.generate_api_token()
        row = models.ApiToken(
            user_id=ctx.user.id,
            name=payload.name,
            token_hash=security.hash_token(plaintext),
            prefix=plaintext[:12],
            scope=models.TokenScope(payload.scope),
            expires_at=payload.expires_at,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        write_audit_event(db, "token.create", principal=ctx.principal, request=request)
        return schemas.TokenCreateOut(
            id=row.id,
            name=row.name,
            prefix=row.prefix,
            scope=row.scope.value,
            token=plaintext,
            created_at=row.created_at,
            expires_at=row.expires_at,
        )

    @router.get("/tokens", response_model=List[schemas.TokenOut])
    def list_tokens(ctx: AuthContext = Depends(auth_deps.require_auth_context), db: Session = Depends(get_db)):
        rows = db.query(models.ApiToken).filter(models.ApiToken.user_id == ctx.user.id).order_by(models.ApiToken.id).all()
        return [
            schemas.TokenOut(
                id=r.id,
                name=r.name,
                prefix=r.prefix,
                scope=r.scope.value,
                created_at=r.created_at,
                last_used_at=r.last_used_at,
                revoked_at=r.revoked_at,
                expires_at=r.expires_at,
            )
            for r in rows
        ]

    @router.delete("/tokens/{token_id}")
    def revoke_token(
        token_id: int,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        row = db.get(models.ApiToken, token_id)
        if row is None or row.user_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        row.revoked_at = time.time()
        db.commit()
        write_audit_event(db, "token.revoke", principal=ctx.principal, request=request)
        return {"ok": True}

    # --- Magic link (DEFERRED — needs email infra, roadmap §2) -------------
    # Intended flow, not implemented: POST /api/auth/magic-link {email}
    # generates a one-time signed token and emails a link containing it;
    # GET /api/auth/magic-link/{token} verifies + consumes it (single use,
    # short TTL) and issues a normal app session cookie, same as /login.
    # Requires outbound email (SMTP/provider) this phase deliberately does
    # not add. This route exists purely so a client hitting it gets an
    # honest 501 instead of a bare 404 indistinguishable from "route doesn't
    # exist yet, keep guessing".
    @router.post("/magic-link", status_code=501)
    def magic_link_stub():
        raise HTTPException(status_code=501, detail="Magic link auth is not implemented yet (needs email infra)")

    return router

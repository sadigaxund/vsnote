"""`/share/*` — the public capability endpoints, OUTSIDE any SSO/app-auth
gate. Mounted directly on the ROOT app (main.py), never on the CORS-enabled
`/api` sub-app, so these responses carry zero CORS headers (roadmap §1).

Every request here (except the two structural exceptions noted below) is
resolved through policy.resolve_share() — see policy.py's module docstring
for the full deny-by-default order and why EVERY deny reason (missing,
revoked, expired, restricted, token-required, password-required, wrong
role) now collapses to the exact same 404 — there is no second ("password
challenge") response shape anywhere in this file.

Structural exceptions, both deliberate and both documented at their call
site: (1) `POST /share/{id}/auth` does NOT call resolve_share — it already
had its own always-correct symmetric 404 (wrong password and nonexistent
slug indistinguishable) before resolve_share's own uniform-404 fix, and
still implements that check directly rather than through resolve_share. (2)
the `{identifier}` path parameter is typed as a bare `str`, not a FastAPI
`Path(pattern=...)` — a regex-constrained path param that failed to match
would produce FastAPI's own 422 automatically, and the roadmap is explicit
that a malformed identifier must take the *identical 404 path* as a missing
one, never a 422. Format validation therefore happens exactly once, inside
policy.resolve_share (or, for the auth endpoint, via the same
`security.validate_slug_format` call used there) — never via a declarative
path constraint.

Contract for Phase 10 (client sharing UI): see server/README.md's "Public
share contract" section for the full request/response shapes documented for
the client team.
"""

from __future__ import annotations

import base64
import hashlib
import time
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from sqlalchemy.orm import Session

from .. import models, policy, schemas, security
from ..audit import write_audit_event
from ..auth import AuthDeps
from ..config import Settings

# Module-level constant, used UNCONDITIONALLY for the raw response — it is
# structurally impossible for this endpoint to emit text/html because this
# is the only Content-Type value any raw-mode code path ever passes to
# Response(). See tests/test_raw_mode.py::test_raw_never_html_even_for_html_payload.
RAW_CONTENT_TYPE = "text/plain; charset=utf-8"

RAW_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
}

JSON_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
}


def _wants_json(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "application/json" in accept


def _share_session_cookie_name(slug_or_alias: str) -> str:
    return f"slate_share_{slug_or_alias}"


def _extract_bearer(request: Request) -> Optional[str]:
    authz = request.headers.get("authorization")
    if authz and authz.lower().startswith("bearer "):
        return authz[7:].strip()
    return None


def _decode_content(blob: "models.Blob") -> Tuple[str, str]:
    try:
        return blob.content.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return base64.b64encode(blob.content).decode("ascii"), "base64"


def _content_payload(share: "models.Share", blob: "models.Blob") -> dict:
    content, encoding = _decode_content(blob)
    out = schemas.ShareContentOut(
        slug=share.slug,
        alias=share.alias,
        source_path=share.source_path,
        render_mode=share.render_mode.value,
        media_type_hint=blob.media_type_hint,
        blob_id=blob.id,
        size=blob.size,
        live=share.live,
        content=content,
        content_encoding=encoding,  # type: ignore[arg-type]
        created_at=share.created_at,
        last_access_at=share.last_access_at,
        hit_count=share.hit_count,
    )
    return out.model_dump()


def _resolve_get(
    identifier: str,
    request: Request,
    db: Session,
    *,
    secret_key: str,
    auth_deps: AuthDeps,
) -> policy.ShareAccess:
    ctx = auth_deps.get_optional_auth_context(request=request, db=db)
    session_cookie = request.cookies.get(_share_session_cookie_name(identifier))
    bearer = _extract_bearer(request)
    return policy.resolve_share(
        db,
        identifier,
        "GET",
        secret_key=secret_key,
        session_cookie=session_cookie,
        bearer_token=bearer,
        principal=ctx.principal if ctx else None,
        request=request,
    )


def _record_access(db: Session, share: "models.Share", access: policy.ShareAccess, request: Request) -> None:
    share.hit_count += 1
    share.last_access_at = time.time()
    db.commit()
    write_audit_event(db, "share.access", slug=share.slug, principal=access.principal, request=request)


def build_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    """Routes mounted on the ROOT app (no CORS): raw/JSON GET, password
    auth, editor PUT."""
    router = APIRouter(tags=["share-public"])

    @router.get("/share/{identifier}")
    @limiter.limit(settings.rate_limit_share)
    def get_share(identifier: str, request: Request, db: Session = Depends(get_db)):
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        share = access.share
        blob = db.get(models.Blob, share.blob_id)
        _record_access(db, share, access, request)

        if _wants_json(request):
            return JSONResponse(
                status_code=200,
                content=_content_payload(share, blob),
                headers=dict(JSON_SECURITY_HEADERS),
            )

        return Response(content=blob.content, media_type=RAW_CONTENT_TYPE, headers=dict(RAW_SECURITY_HEADERS))

    @router.post("/share/{identifier}/auth")
    @limiter.limit(settings.rate_limit_share_auth)
    def share_password_auth(
        identifier: str,
        request: Request,
        payload: schemas.SharePasswordAuthIn,
        db: Session = Depends(get_db),
    ):
        # Deliberately bypasses resolve_share: this endpoint's contract is a
        # plain, symmetric "404 for wrong password AND for nonexistent slug
        # alike" (roadmap §1) — the exact same uniform-404 policy.py now
        # applies everywhere, implemented directly here since this endpoint
        # doesn't otherwise share resolve_share's auth-mode branching (a
        # password submission isn't a GET/PUT).
        if not security.validate_slug_format(identifier):
            write_audit_event(db, "auth.failure", slug=identifier, reason="malformed_slug", request=request)
            return policy.not_found_response()

        share = policy.lookup_share(db, identifier)
        now = time.time()
        invalid = (
            share is None
            or share.revoked_at is not None
            or (share.expires_at is not None and share.expires_at < now)
            or share.auth_mode != models.AuthMode.password
            or not share.password_hash
        )
        if invalid:
            write_audit_event(db, "auth.failure", slug=identifier, reason="not_a_valid_password_share", request=request)
            return policy.not_found_response()

        if not security.verify_password(share.password_hash, payload.password):  # type: ignore[union-attr]
            write_audit_event(db, "auth.failure", slug=share.slug, reason="wrong_password", request=request)  # type: ignore[union-attr]
            return policy.not_found_response()

        cookie_payload = {
            "kind": "share_session",
            "slug": share.slug,  # type: ignore[union-attr]
            "exp": now + settings.session_ttl_min * 60,
        }
        cookie_value = security.make_signed_cookie(secret_key, cookie_payload)
        write_audit_event(db, "share.access", slug=share.slug, reason="password_auth_success", request=request)  # type: ignore[union-attr]

        # Setting the cookie on a `response: Response` DEPENDENCY parameter
        # only works when the endpoint returns a plain value for FastAPI to
        # serialize itself — an endpoint that instead returns its own
        # Response object (as every deny path above does, via
        # policy.not_found_response()) replaces that injected object
        # entirely, silently dropping the cookie. So the cookie is set
        # directly on the actual Response instance being returned here.
        out = JSONResponse(status_code=200, content={"ok": True})
        out.set_cookie(
            _share_session_cookie_name(share.slug),  # type: ignore[union-attr]
            cookie_value,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path=f"/share/{share.slug}",  # type: ignore[union-attr]
            max_age=settings.session_ttl_min * 60,
        )
        return out

    @router.put("/share/{identifier}")
    @limiter.limit(settings.rate_limit_share)
    async def put_share(identifier: str, request: Request, db: Session = Depends(get_db)):
        ctx = auth_deps.get_optional_auth_context(request=request, db=db)
        session_cookie = request.cookies.get(_share_session_cookie_name(identifier))
        bearer = _extract_bearer(request)
        try:
            access = policy.resolve_share(
                db,
                identifier,
                "PUT",
                secret_key=secret_key,
                session_cookie=session_cookie,
                bearer_token=bearer,
                principal=ctx.principal if ctx else None,
                request=request,
            )
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        body = await request.body()
        if len(body) > settings.max_blob_bytes:
            raise HTTPException(status_code=413, detail="Blob exceeds maximum size")

        digest = hashlib.sha256(body).hexdigest()
        if db.get(models.Blob, digest) is None:
            db.add(models.Blob(id=digest, content=body, size=len(body), media_type_hint=None))
        access.share.blob_id = digest
        db.commit()
        write_audit_event(
            db, "share.access", slug=access.share.slug, principal=access.principal, reason="editor_put", request=request
        )
        return {"ok": True, "blob_id": digest}

    return router


def build_content_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    """`GET /share/{identifier}/content` — mounted under the CORS-enabled
    `/api` sub-app (becomes `/api/share/{identifier}/content`) so the SPA's
    rendered-share page (Phase 10) can fetch it cross-origin with
    credentials, while still going through the SAME policy gate as every
    other `/share/*` request. This route is otherwise public — it carries no
    app-auth dependency of its own."""
    router = APIRouter(tags=["share-public-cors"])

    @router.get("/share/{identifier}/content")
    @limiter.limit(settings.rate_limit_share)
    def get_share_content(identifier: str, request: Request, db: Session = Depends(get_db)):
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        share = access.share
        blob = db.get(models.Blob, share.blob_id)
        _record_access(db, share, access, request)
        return JSONResponse(
            status_code=200,
            content=_content_payload(share, blob),
            headers=dict(JSON_SECURITY_HEADERS),
        )

    return router

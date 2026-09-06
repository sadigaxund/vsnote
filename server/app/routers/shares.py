"""Owner-side CRUD — `/api/blobs`, `/api/shares*` — behind the app auth gate
(Cf-Access JWT, app session cookie, or a scoped bearer token). Mounted under
the CORS-enabled `/api` sub-app.

Scope rules (roadmap §2 / phase brief): a full session (Cf-Access or
password login) implies full owner rights over the caller's own resources.
A scoped API token is restricted to exactly its declared scope — `read` is
rejected for every mutating route here (test: test_shares_api.py::
test_read_scope_token_rejected_for_write).
"""

from __future__ import annotations

import hashlib
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from slowapi import Limiter
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas, security
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps
from ..config import Settings
from ..runtime_settings import get_max_blob_bytes


def _share_out(db: Session, share: "models.Share") -> schemas.ShareOut:
    return schemas.ShareOut(
        id=share.id,
        slug=share.slug,
        alias=share.alias,
        source_path=share.source_path,
        blob_id=share.blob_id,
        live=share.live,
        render_mode=share.render_mode.value,
        general_access=share.general_access.value,
        auth_mode=share.auth_mode.value,
        has_password=bool(share.password_hash),
        expires_at=share.expires_at,
        revoked_at=share.revoked_at,
        created_at=share.created_at,
        last_access_at=share.last_access_at,
        hit_count=share.hit_count,
        link_role=share.link_role.value if hasattr(share.link_role, "value") else str(share.link_role or "viewer"),
        show_title=share.show_title,
        back_link=share.back_link,
        grants=[
            schemas.GrantOut(principal=g.principal, role=g.role.value if hasattr(g.role, "value") else str(g.role))
            for g in db.query(models.ShareGrant)
            .filter(models.ShareGrant.share_id == share.id)
            .order_by(models.ShareGrant.created_at)
            .all()
        ],
    )


def _generate_unique_slug(db: Session) -> str:
    slug = security.generate_slug()
    while db.query(models.Share).filter(models.Share.slug == slug).one_or_none() is not None:
        slug = security.generate_slug()
    return slug


def _check_auth_matches_render_mode(render_mode: str, auth_mode: str) -> None:
    """§4.6 auth matrix, enforced server-side (not just in the publish
    dialog): raw shares may only use `auth_mode` `none` or `token` — there
    is no UI surface to type a password against a raw byte stream, and a
    password challenge on a raw response would mean either serving an HTML
    challenge page (breaking "raw = bytes, never text/html") or silently
    ignoring the password. Rendered shares may use any of
    none/password/token; `general_access="restricted"` (sign-in) is
    orthogonal to all three and unaffected by this check. This is the ONE
    place both create_share and patch_share enforce the rule, so it can't
    drift between the two paths. This is an OWNER-facing validation error
    (a descriptive 422), not a visitor-facing deny — the uniform-404 rule
    in policy.py applies only to the public gate, never to this API."""
    if render_mode == "raw" and auth_mode == "password":
        raise HTTPException(
            status_code=422,
            detail="Password protection isn't available for raw shares. Use no auth or a token instead.",
        )


def _check_alias_available(db: Session, alias: str, *, exclude_share_id: Optional[int] = None) -> None:
    """§4.5 — explicit pre-check so a colliding alias returns a clean 4xx
    instead of a 500 IntegrityError. An alias must never collide with
    either an existing alias OR an existing slug (both columns share the
    same identifier namespace at the public gate — `policy.lookup_share`
    matches either). The DB's own unique constraints on `shares.alias` and
    `shares.slug` remain as the belt-and-suspenders backstop for the race
    between this check and the commit (still caught below as an
    IntegrityError -> 409)."""
    err = security.alias_error(alias)
    if err:
        raise HTTPException(status_code=422, detail=err)
    query = db.query(models.Share).filter(
        (models.Share.alias == alias) | (models.Share.slug == alias)
    )
    if exclude_share_id is not None:
        query = query.filter(models.Share.id != exclude_share_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="alias already in use")


def build_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(tags=["owner"])

    @router.post("/blobs", response_model=schemas.BlobOut, status_code=201)
    async def create_blob(
        file: UploadFile = File(...),
        media_type_hint: Optional[str] = Form(None),
        ctx: AuthContext = Depends(auth_deps.require_scope({"write", "share-admin"})),
        db: Session = Depends(get_db),
    ):
        content = await file.read()
        # DESIGN-SPEC item 40: the ceiling is the DB-backed admin setting,
        # NEVER `settings.max_blob_bytes` directly — that config value only
        # ever seeds the DB row once, at first boot (see
        # `runtime_settings.py`'s module docstring and
        # `main.py::bootstrap_runtime_settings`).
        if len(content) > get_max_blob_bytes(db):
            raise HTTPException(status_code=413, detail="Blob exceeds the configured maximum size")
        digest = hashlib.sha256(content).hexdigest()
        if db.get(models.Blob, digest) is None:
            db.add(models.Blob(id=digest, content=content, size=len(content), media_type_hint=media_type_hint))
            db.commit()
        return schemas.BlobOut(id=digest, size=len(content), media_type_hint=media_type_hint)

    @router.post("/shares", response_model=schemas.ShareOut, status_code=201)
    def create_share(
        request: Request,
        payload: schemas.ShareCreateIn,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        if not payload.blob_id:
            raise HTTPException(status_code=422, detail="blob_id is required")
        if db.get(models.Blob, payload.blob_id) is None:
            raise HTTPException(status_code=404, detail="Unknown blob_id — POST /api/blobs first")

        if payload.alias is not None:
            _check_alias_available(db, payload.alias)
        if payload.auth_mode == "password" and not payload.password:
            raise HTTPException(status_code=422, detail="password is required when auth_mode is 'password'")
        _check_auth_matches_render_mode(payload.render_mode, payload.auth_mode)

        share = models.Share(
            slug=_generate_unique_slug(db),
            alias=payload.alias,
            owner_id=ctx.user.id,
            source_path=payload.source_path,
            link_role=models.GrantRole(payload.link_role),
            show_title=payload.show_title,
            back_link=payload.back_link or None,
            blob_id=payload.blob_id,
            live=payload.live,
            render_mode=models.RenderMode(payload.render_mode),
            general_access=models.GeneralAccess(payload.general_access),
            auth_mode=models.AuthMode(payload.auth_mode),
            password_hash=security.hash_password(payload.password) if payload.password else None,
            expires_at=payload.expires_at,
        )
        db.add(share)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="alias already in use")
        db.refresh(share)

        for grant in payload.grants:
            db.add(models.ShareGrant(share_id=share.id, principal=grant.principal, role=models.GrantRole(grant.role)))
        db.commit()

        write_audit_event(db, "share.publish", slug=share.slug, principal=ctx.principal, request=request)
        return _share_out(db, share)

    @router.get("/shares", response_model=List[schemas.ShareOut])
    def list_shares(
        ctx: AuthContext = Depends(auth_deps.require_scope({"read", "write", "share-admin"})),
        db: Session = Depends(get_db),
    ):
        rows = (
            db.query(models.Share)
            .filter(models.Share.owner_id == ctx.user.id)
            .order_by(models.Share.id.desc())
            .all()
        )
        return [_share_out(db, r) for r in rows]

    @router.patch("/shares/{share_id}", response_model=schemas.ShareOut)
    def patch_share(
        share_id: int,
        payload: schemas.SharePatchIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")

        # Validate the FULL resulting state before mutating anything, so a
        # rejected patch never partially applies.
        if payload.alias:
            _check_alias_available(db, payload.alias, exclude_share_id=share.id)
        final_render_mode = payload.render_mode if payload.render_mode is not None else share.render_mode.value
        final_auth_mode = payload.auth_mode if payload.auth_mode is not None else share.auth_mode.value
        _check_auth_matches_render_mode(final_render_mode, final_auth_mode)

        if payload.alias is not None:
            share.alias = payload.alias or None
        if payload.clear_expiry:
            share.expires_at = None
        elif payload.expires_at is not None:
            share.expires_at = payload.expires_at
        if payload.source_path is not None and payload.source_path.strip():
            share.source_path = payload.source_path.strip()
        if payload.clear_password:
            share.password_hash = None
        elif payload.password is not None:
            share.password_hash = security.hash_password(payload.password)
        if payload.general_access is not None:
            share.general_access = models.GeneralAccess(payload.general_access)
        if payload.auth_mode is not None:
            share.auth_mode = models.AuthMode(payload.auth_mode)
        if payload.render_mode is not None:
            share.render_mode = models.RenderMode(payload.render_mode)
        if payload.live is not None:
            share.live = payload.live
        if payload.link_role is not None:
            share.link_role = models.GrantRole(payload.link_role)
        if payload.show_title is not None:
            share.show_title = payload.show_title
        if payload.back_link is not None:
            share.back_link = payload.back_link or None
        # Round 7 item 60 — grants are a wholesale replacement (None means
        # untouched, [] means remove everyone), mirroring the manifest's
        # replace semantics rather than inventing per-row endpoints.
        if payload.grants is not None:
            seen = set()
            for grant in payload.grants:
                principal = grant.principal.strip()
                if not principal:
                    raise HTTPException(status_code=422, detail="grant principal must not be empty")
                if principal.lower() in seen:
                    raise HTTPException(status_code=422, detail=f"duplicate grant principal: {principal}")
                seen.add(principal.lower())
            db.query(models.ShareGrant).filter(models.ShareGrant.share_id == share.id).delete()
            for grant in payload.grants:
                db.add(
                    models.ShareGrant(
                        share_id=share.id, principal=grant.principal.strip(), role=models.GrantRole(grant.role)
                    )
                )

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="alias already in use")
        db.refresh(share)
        write_audit_event(db, "share.publish", slug=share.slug, principal=ctx.principal, reason="policy_edit", request=request)
        return _share_out(db, share)

    @router.post("/shares/{share_id}/regenerate", response_model=schemas.ShareOut)
    def regenerate_share(
        share_id: int,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        old_slug = share.slug
        share.slug = _generate_unique_slug(db)
        db.commit()
        db.refresh(share)
        write_audit_event(
            db, "share.publish", slug=share.slug, principal=ctx.principal, reason=f"regenerated_from:{old_slug}", request=request
        )
        return _share_out(db, share)

    @router.delete("/shares/{share_id}")
    def delete_share(
        share_id: int,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        share.revoked_at = time.time()
        db.commit()
        write_audit_event(db, "share.revoke", slug=share.slug, principal=ctx.principal, request=request)
        return {"ok": True}

    # --- §4.2: per-share bearer tokens (owner-only, share-admin scope) ----
    #
    # Mirrors auth.py's `/tokens` endpoints (mint/list/revoke) but scoped to
    # ONE share's `ShareToken` rows instead of the owner's account-wide
    # `ApiToken` table. `_owned_share` below is the single place that keeps
    # the "a share the caller does not own 404s uniformly" contract from
    # drifting across the three routes (same shape as every other
    # `/shares/{id}` owner-scoped route above — 404, never 403, so a
    # caller can't distinguish "not yours" from "doesn't exist").
    #
    # Rotation is mint-new + revoke-old (two existing calls) rather than a
    # dedicated `/rotate` endpoint: there is no server-side reason a
    # rotation needs to be atomic (the old token keeps working, harmlessly,
    # for the moment between the two calls — that's strictly SAFER than a
    # window where neither token works), and the publish dialog already
    # needs the plain mint response to show the new plaintext once, so a
    # combined endpoint would just be these same two calls glued together
    # for no real benefit.
    def _owned_share(db: Session, share_id: int, ctx: AuthContext) -> models.Share:
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        return share

    @router.post("/shares/{share_id}/tokens", response_model=schemas.ShareTokenCreateOut, status_code=201)
    def create_share_token(
        share_id: int,
        payload: schemas.ShareTokenCreateIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = _owned_share(db, share_id, ctx)
        plaintext = security.generate_api_token()
        row = models.ShareToken(
            share_id=share.id,
            token_hash=security.hash_token(plaintext),
            prefix=plaintext[:12],
            label=payload.label,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        write_audit_event(db, "share_token.create", slug=share.slug, principal=ctx.principal, request=request)
        return schemas.ShareTokenCreateOut(
            id=row.id, prefix=row.prefix, label=row.label, token=plaintext, created_at=row.created_at
        )

    @router.get("/shares/{share_id}/tokens", response_model=List[schemas.ShareTokenOut])
    def list_share_tokens(
        share_id: int,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = _owned_share(db, share_id, ctx)
        rows = (
            db.query(models.ShareToken)
            .filter(models.ShareToken.share_id == share.id)
            .order_by(models.ShareToken.id)
            .all()
        )
        return [
            schemas.ShareTokenOut(
                id=r.id,
                prefix=r.prefix,
                label=r.label,
                created_at=r.created_at,
                last_used_at=r.last_used_at,
                revoked_at=r.revoked_at,
            )
            for r in rows
        ]

    @router.delete("/shares/{share_id}/tokens/{token_id}")
    def revoke_share_token(
        share_id: int,
        token_id: int,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = _owned_share(db, share_id, ctx)
        row = db.get(models.ShareToken, token_id)
        if row is None or row.share_id != share.id:
            raise HTTPException(status_code=404, detail="Not found")
        row.revoked_at = time.time()
        db.commit()
        write_audit_event(db, "share_token.revoke", slug=share.slug, principal=ctx.principal, request=request)
        return {"ok": True}

    return router

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


def _share_out(share: "models.Share") -> schemas.ShareOut:
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
    )


def _generate_unique_slug(db: Session) -> str:
    slug = security.generate_slug()
    while db.query(models.Share).filter(models.Share.slug == slug).one_or_none() is not None:
        slug = security.generate_slug()
    return slug


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
        if len(content) > settings.max_blob_bytes:
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
        blob = db.get(models.Blob, payload.blob_id)
        if blob is None:
            raise HTTPException(status_code=404, detail="Unknown blob_id — POST /api/blobs first")
        if payload.alias is not None and not security.validate_slug_format(payload.alias):
            raise HTTPException(status_code=422, detail="alias must match the slug format")
        if payload.auth_mode == "password" and not payload.password:
            raise HTTPException(status_code=422, detail="password is required when auth_mode is 'password'")

        share = models.Share(
            slug=_generate_unique_slug(db),
            alias=payload.alias,
            owner_id=ctx.user.id,
            source_path=payload.source_path,
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
        return _share_out(share)

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
        return [_share_out(r) for r in rows]

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

        if payload.alias is not None:
            if payload.alias and not security.validate_slug_format(payload.alias):
                raise HTTPException(status_code=422, detail="alias must match the slug format")
            share.alias = payload.alias or None
        if payload.expires_at is not None:
            share.expires_at = payload.expires_at
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

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="alias already in use")
        db.refresh(share)
        write_audit_event(db, "share.publish", slug=share.slug, principal=ctx.principal, reason="policy_edit", request=request)
        return _share_out(share)

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
        return _share_out(share)

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

    return router

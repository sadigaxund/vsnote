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


def _manifest_count(db: Session, share: "models.Share") -> Optional[int]:
    if share.kind != models.ShareKind.folder:
        return None
    return db.query(models.ShareManifestEntry).filter(models.ShareManifestEntry.share_id == share.id).count()


def _share_out(db: Session, share: "models.Share") -> schemas.ShareOut:
    return schemas.ShareOut(
        id=share.id,
        slug=share.slug,
        alias=share.alias,
        source_path=share.source_path,
        kind=share.kind.value if hasattr(share.kind, "value") else str(share.kind),
        blob_id=share.blob_id,
        manifest_count=_manifest_count(db, share),
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


def _validate_relpath(relpath: str) -> Optional[str]:
    """Belt-and-suspenders hygiene at WRITE time only — not itself the
    security boundary (that's the exact-match manifest lookup at READ time,
    see models.ShareManifestEntry's docstring: an entry containing "../x"
    would still be harmless to store, since it could only ever be reached by
    a request for the literal string "../x", which resolves nothing outside
    the manifest either). Rejecting obviously-malformed relpaths here just
    keeps the manifest table from accumulating garbage a legitimate client
    would never send. Returns an error message, or None if valid."""
    if not relpath or relpath.strip() == "":
        return "relpath must not be empty"
    if relpath.startswith("/"):
        return "relpath must not be absolute"
    if "\\" in relpath:
        return "relpath must not contain a backslash"
    segments = relpath.split("/")
    if any(seg in ("", ".", "..") for seg in segments):
        return "relpath must not contain empty/./.. segments"
    return None


def _apply_manifest(db: Session, share: "models.Share", entries: list) -> None:
    """Wholesale-replace `share`'s manifest rows. Every entry's `blob_id`
    must already exist (client POSTs blobs first, same as a file share) —
    404s otherwise. Raises HTTPException(422) for a malformed relpath."""
    seen = set()
    for entry in entries:
        err = _validate_relpath(entry.relpath)
        if err:
            raise HTTPException(status_code=422, detail=err)
        if entry.relpath in seen:
            raise HTTPException(status_code=422, detail=f"duplicate relpath: {entry.relpath}")
        seen.add(entry.relpath)
        blob = db.get(models.Blob, entry.blob_id)
        if blob is None:
            raise HTTPException(status_code=404, detail=f"Unknown blob_id for {entry.relpath} — POST /api/blobs first")

    db.query(models.ShareManifestEntry).filter(models.ShareManifestEntry.share_id == share.id).delete()
    for entry in entries:
        blob = db.get(models.Blob, entry.blob_id)
        db.add(
            models.ShareManifestEntry(
                share_id=share.id,
                relpath=entry.relpath,
                blob_id=entry.blob_id,
                size=blob.size,
                media_type_hint=blob.media_type_hint,
            )
        )
    db.commit()


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
        is_folder = payload.kind == "folder"

        if is_folder:
            if not payload.manifest:
                raise HTTPException(status_code=422, detail="manifest must be non-empty for a folder share")
        else:
            if not payload.blob_id:
                raise HTTPException(status_code=422, detail="blob_id is required for a file share")
            if db.get(models.Blob, payload.blob_id) is None:
                raise HTTPException(status_code=404, detail="Unknown blob_id — POST /api/blobs first")

        if payload.alias is not None and not security.validate_slug_format(payload.alias):
            raise HTTPException(status_code=422, detail="alias must match the slug format")
        if payload.auth_mode == "password" and not payload.password:
            raise HTTPException(status_code=422, detail="password is required when auth_mode is 'password'")

        # Validate every manifest relpath BEFORE creating the share row, so a
        # malformed entry never leaves a half-published folder share behind.
        if is_folder:
            for entry in payload.manifest:
                err = _validate_relpath(entry.relpath)
                if err:
                    raise HTTPException(status_code=422, detail=err)
                if db.get(models.Blob, entry.blob_id) is None:
                    raise HTTPException(
                        status_code=404, detail=f"Unknown blob_id for {entry.relpath} — POST /api/blobs first"
                    )

        share = models.Share(
            slug=_generate_unique_slug(db),
            alias=payload.alias,
            owner_id=ctx.user.id,
            source_path=payload.source_path,
            kind=models.ShareKind.folder if is_folder else models.ShareKind.file,
            blob_id=None if is_folder else payload.blob_id,
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

        if is_folder:
            _apply_manifest(db, share, payload.manifest)

        for grant in payload.grants:
            db.add(models.ShareGrant(share_id=share.id, principal=grant.principal, role=models.GrantRole(grant.role)))
        db.commit()

        write_audit_event(db, "share.publish", slug=share.slug, principal=ctx.principal, request=request)
        return _share_out(db, share)

    @router.get("/shares/{share_id}/manifest", response_model=schemas.ShareManifestOut)
    def get_share_manifest(
        share_id: int,
        ctx: AuthContext = Depends(auth_deps.require_scope({"read", "write", "share-admin"})),
        db: Session = Depends(get_db),
    ):
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        rows = (
            db.query(models.ShareManifestEntry)
            .filter(models.ShareManifestEntry.share_id == share.id)
            .order_by(models.ShareManifestEntry.relpath)
            .all()
        )
        return schemas.ShareManifestOut(
            entries=[
                schemas.ManifestEntryOut(relpath=r.relpath, blob_id=r.blob_id, size=r.size, media_type_hint=r.media_type_hint)
                for r in rows
            ]
        )

    @router.put("/shares/{share_id}/manifest", response_model=schemas.ShareOut)
    def update_share_manifest(
        share_id: int,
        payload: schemas.ManifestUpdateIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_scope({"share-admin"})),
        db: Session = Depends(get_db),
    ):
        """"Update share" for a folder share (roadmap §5.1) — republishes the
        subtree to the SAME slug by wholesale-replacing the manifest. The
        slug/alias/policy fields are untouched (use PATCH for those)."""
        share = db.get(models.Share, share_id)
        if share is None or share.owner_id != ctx.user.id:
            raise HTTPException(status_code=404, detail="Not found")
        if share.kind != models.ShareKind.folder:
            raise HTTPException(status_code=400, detail="Only folder shares have a manifest")
        if not payload.manifest:
            raise HTTPException(status_code=422, detail="manifest must be non-empty")

        _apply_manifest(db, share, payload.manifest)
        db.refresh(share)
        write_audit_event(db, "share.publish", slug=share.slug, principal=ctx.principal, reason="manifest_update", request=request)
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

    return router

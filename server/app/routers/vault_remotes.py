"""`/api/vault/remotes` — Phase 17 Milestone B: mirroring the authoritative
vault to external git remotes (GitHub/GitLab/Gitea/any), over SSH or HTTPS,
with credentials living SERVER-SIDE ONLY (see `app/mirror.py` and
`app/secrets_store.py`'s module docstrings for the engine and the storage
contract). Session-authenticated only, same posture as `routers/vault.py`
and `routers/git_admin.py`: a scoped API token — even a write-scoped one
meant for a git client — must never be able to add/edit/delete a mirror
target, read its metadata, or trigger a run; these are interactive,
owner-console operations, not something a leaked git-client token should
reach.

Every response is built through `_to_out()`, which reads only the metadata
columns on `models.VaultRemote` — never a secret file, never a secret
column (there isn't one). Credential fields on the request side
(`ssh_private_key`/`https_token`) are write-only: accepted on create/PATCH,
handed straight to `secrets_store` for on-disk storage, and never echoed
back in any response body, ever (`schemas.VaultRemoteOut` has no field for
either).

Audit events: create/update/delete, and every mirror success/failure
(written by `MirrorRunner.run_one`, called from `mirror_now` below with the
acting principal). `reason` strings on all of these come from `app/
mirror.py`'s own sanitization — never the raw remote URL's credential
portion (there is none, by construction — see `app/mirror.py`'s module
docstring for why a remote URL never embeds a token) and never raw key/token
material.
"""

from __future__ import annotations

import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import mirror, models, secrets_store
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps
from ..config import Settings
from ..schemas import (
    MirrorRunOut,
    RemoteTestOut,
    VaultRemoteCreateIn,
    VaultRemoteOut,
    VaultRemotePatchIn,
)


def _require_session(ctx: AuthContext) -> None:
    if ctx.scope is not None:
        raise HTTPException(status_code=403, detail="An interactive session is required")


def _to_out(remote: "models.VaultRemote") -> VaultRemoteOut:
    return VaultRemoteOut(
        id=remote.id,
        name=remote.name,
        url=remote.url,
        enabled=remote.enabled,
        push_on_receive=remote.push_on_receive,
        credential_kind=remote.credential_kind.value,
        credential_fingerprint=remote.credential_fingerprint,
        credential_last4=remote.credential_last4,
        last_mirror_at=remote.last_mirror_at,
        last_status=remote.last_status,
        last_error=remote.last_error,
        created_at=remote.created_at,
        updated_at=remote.updated_at,
    )


def _validate_url_or_422(url: str) -> None:
    try:
        mirror.validate_remote_url(url)
    except mirror.InvalidRemoteURL as exc:
        raise HTTPException(status_code=422, detail=f"invalid remote url: {exc}")


def _apply_credential(
    settings: Settings,
    remote: "models.VaultRemote",
    *,
    credential_kind: Optional[str],
    ssh_private_key: Optional[str],
    https_token: Optional[str],
) -> None:
    """Writes the new secret to disk (if any) and updates ONLY the metadata
    columns on `remote` — never a plaintext column. A no-op when
    `credential_kind` is `None` (field omitted: leave the existing
    credential untouched, same "omit means unchanged" convention as
    `SharePatchIn`'s other fields)."""
    if credential_kind is None:
        return
    kind = models.RemoteCredentialKind(credential_kind)
    if kind == models.RemoteCredentialKind.none:
        secrets_store.delete_credential_files(settings, remote.id)
        remote.credential_kind = kind
        remote.credential_fingerprint = None
        remote.credential_last4 = None
        return
    if kind == models.RemoteCredentialKind.ssh_key:
        if not ssh_private_key:
            raise HTTPException(status_code=422, detail="ssh_private_key is required for credential_kind=ssh_key")
        path = secrets_store.set_ssh_key(settings, remote.id, ssh_private_key)
        secrets_store.delete_https_token_only(settings, remote.id)
        remote.credential_kind = kind
        remote.credential_fingerprint = secrets_store.compute_ssh_fingerprint(path)
        remote.credential_last4 = None
        return
    if kind == models.RemoteCredentialKind.https_token:
        if not https_token:
            raise HTTPException(status_code=422, detail="https_token is required for credential_kind=https_token")
        secrets_store.set_https_token(settings, remote.id, https_token)
        secrets_store.delete_ssh_key_only(settings, remote.id)
        remote.credential_kind = kind
        remote.credential_fingerprint = None
        remote.credential_last4 = https_token[-4:]
        return


def build_router(get_db, settings: Settings, auth_deps: AuthDeps, mirror_runner: "mirror.MirrorRunner") -> APIRouter:
    router = APIRouter(prefix="/vault/remotes", tags=["vault-remotes"])

    @router.get("", response_model=List[VaultRemoteOut])
    def list_remotes(
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        rows = db.query(models.VaultRemote).order_by(models.VaultRemote.id).all()
        return [_to_out(r) for r in rows]

    @router.post("", response_model=VaultRemoteOut, status_code=201)
    def create_remote(
        payload: VaultRemoteCreateIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        _validate_url_or_422(payload.url)
        if payload.credential_kind == "ssh_key" and not payload.ssh_private_key:
            raise HTTPException(status_code=422, detail="ssh_private_key is required for credential_kind=ssh_key")
        if payload.credential_kind == "https_token" and not payload.https_token:
            raise HTTPException(status_code=422, detail="https_token is required for credential_kind=https_token")

        remote = models.VaultRemote(
            name=payload.name,
            url=payload.url,
            enabled=payload.enabled,
            push_on_receive=payload.push_on_receive,
            credential_kind=models.RemoteCredentialKind.none,
        )
        db.add(remote)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="a remote with this name already exists")
        db.refresh(remote)

        _apply_credential(
            settings,
            remote,
            credential_kind=payload.credential_kind,
            ssh_private_key=payload.ssh_private_key,
            https_token=payload.https_token,
        )
        db.commit()
        db.refresh(remote)
        write_audit_event(db, "vault_remote.create", principal=ctx.principal, reason=f"name={remote.name}", request=request)
        return _to_out(remote)

    @router.patch("/{remote_id}", response_model=VaultRemoteOut)
    def patch_remote(
        remote_id: int,
        payload: VaultRemotePatchIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        remote = db.get(models.VaultRemote, remote_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Not found")

        if payload.name is not None:
            remote.name = payload.name
        if payload.url is not None:
            _validate_url_or_422(payload.url)
            remote.url = payload.url
        if payload.enabled is not None:
            remote.enabled = payload.enabled
        if payload.push_on_receive is not None:
            remote.push_on_receive = payload.push_on_receive

        if payload.clear_credential:
            secrets_store.delete_credential_files(settings, remote.id)
            remote.credential_kind = models.RemoteCredentialKind.none
            remote.credential_fingerprint = None
            remote.credential_last4 = None
        else:
            _apply_credential(
                settings,
                remote,
                credential_kind=payload.credential_kind,
                ssh_private_key=payload.ssh_private_key,
                https_token=payload.https_token,
            )

        remote.updated_at = time.time()
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="a remote with this name already exists")
        db.refresh(remote)
        write_audit_event(db, "vault_remote.update", principal=ctx.principal, reason=f"name={remote.name}", request=request)
        return _to_out(remote)

    @router.delete("/{remote_id}")
    def delete_remote(
        remote_id: int,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        remote = db.get(models.VaultRemote, remote_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Not found")
        name = remote.name
        db.delete(remote)
        db.commit()
        secrets_store.delete_credential_files(settings, remote_id)
        write_audit_event(db, "vault_remote.delete", principal=ctx.principal, reason=f"name={name}", request=request)
        return {"ok": True}

    @router.post("/{remote_id}/mirror", response_model=MirrorRunOut)
    def mirror_now(
        remote_id: int,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        remote = db.get(models.VaultRemote, remote_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Not found")
        outcome = mirror_runner.run_one(remote_id, principal=ctx.principal)
        return MirrorRunOut(status=outcome.status, message=outcome.message, ts=outcome.ts)

    @router.post("/{remote_id}/test", response_model=RemoteTestOut)
    def test_remote_route(
        remote_id: int,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        remote = db.get(models.VaultRemote, remote_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Not found")
        result = mirror.test_remote(settings, remote)
        return RemoteTestOut(outcome=result.outcome, message=result.message)

    return router

"""`/api/vault` — Phase 17 Milestone A's owner-facing surface over
`app/vault.py`'s identity resolution. Session-authenticated only, same
posture as `routers/admin.py` and `routers/git_admin.py`: a scoped API
token (even a write-scoped one, meant for a git client) must never be able
to read the vault's identity or trigger its one-time init — those are
interactive, owner-console operations, not something a leaked git-client
token should reach. `ctx.scope is not None` is the exact check
`routers/git_admin.py::reset_repo` already uses for the same reasoning.

Two routes:
  - `GET /api/vault` — `describe_vault()`, read-only, side-effect-free.
  - `POST /api/vault/init` — the ONLY place `vault.init_vault()` is ever
    called from. Refuses (409) if a repo already exists at the vault path
    (`vault.VaultAlreadyInitialized`) — respecting an existing `.git` is
    binding, see `app/vault.py`'s module docstring. Refuses (503) if the
    server process cannot write to the vault path
    (`vault.VaultPathNotWritable`, DESIGN-SPEC Amendments round 7 item 50)
    — a structured JSON `detail` naming the path, never a raw traceback;
    the Dockerfile's entrypoint chowns the vault directory specifically to
    avoid hitting this in the default deployment shape.

Both write an audit event.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import vault as vault_module
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps
from ..config import Settings
from ..schemas import VaultInitIn, VaultOut


def _require_session(ctx: AuthContext) -> None:
    if ctx.scope is not None:
        raise HTTPException(status_code=403, detail="An interactive session is required")


def _to_out(description: "vault_module.VaultDescription") -> VaultOut:
    return VaultOut(
        path=description.path,
        mounted=description.mounted,
        initialized=description.initialized,
        bare=description.bare,
        repo_name=description.repo_name,
        head_branch=description.head_branch,
        has_commits=description.has_commits,
        worktree_dirty=description.worktree_dirty,
        last_commit_message=description.last_commit_message,
        last_commit_time=description.last_commit_time,
    )


def build_router(get_db, settings: Settings, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/vault", tags=["vault"])

    @router.get("", response_model=VaultOut)
    def get_vault(ctx: AuthContext = Depends(auth_deps.require_auth_context)):
        # Deliberately NOT audited: this is a read-only, side-effect-free
        # status probe the client polls (the setup wizard re-reads it after
        # every step, and the shell reads it at boot), so auditing it would
        # add one row per poll to a table `audit.py` documents as "every
        # deny and auth failure" plus real mutations. The mutation below is
        # audited, as are its refusals.
        _require_session(ctx)
        return _to_out(vault_module.describe_vault(settings))

    @router.post("/init", response_model=VaultOut)
    def init_vault(
        payload: VaultInitIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        _require_session(ctx)
        try:
            description = vault_module.init_vault(settings, branch=payload.branch)
        except vault_module.VaultAlreadyInitialized:
            write_audit_event(
                db,
                "vault.init_refused",
                principal=ctx.principal,
                reason="already initialized",
                request=request,
            )
            raise HTTPException(status_code=409, detail="Vault is already initialized.")
        except vault_module.VaultPathNotWritable as exc:
            # Never let the raw OSError/traceback reach the client (item 50)
            # — name the path and the fix so the setup wizard's one-row
            # error state is actually actionable.
            write_audit_event(
                db,
                "vault.init_refused",
                principal=ctx.principal,
                reason=f"not writable: {exc.original}",
                request=request,
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    f"The server process cannot write to the vault path {exc.path}. "
                    "Its owning process needs write permission there (a root-owned "
                    "Docker volume mounted before the container's entrypoint ran is "
                    "the common cause) — see server/README.md's \"Server-mounted "
                    "vault\" section."
                ),
            )
        write_audit_event(
            db,
            "vault.init",
            principal=ctx.principal,
            reason=f"mounted={description.mounted} branch={description.head_branch}",
            request=request,
        )
        return _to_out(description)

    return router

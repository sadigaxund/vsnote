"""`POST /api/git-repos/{repo_name}/reset` — round 6 item 19's explicit,
destructive "Replace remote with local" escape hatch for the
unrelated-history case (e.g. a browser vault whose local history was
recreated from scratch while the server's bare repo still holds the old
line — a non-fast-forward push is then *correctly* refused forever).

The sync pipeline itself NEVER force-pushes (roadmap §5.2, binding), and
this route doesn't change that: it is not a git-protocol operation at all.
It deletes the bare repository server-side and re-creates it empty, after
which the client's next plain, non-force push simply populates a fresh
repo — morally identical to deleting and re-creating a hosted repo by
hand, just reachable from the UI that needs it, behind its own confirm
dialog client-side.

Auth: an interactive session only (same reasoning as `routers/admin.py`'s
token rejection) — a leaked read- or even write-scoped API token made for
a git client must never be able to erase the server's copy of the history.

Phase 17 Milestone A: a MOUNTED, server-side authoritative vault is refused
outright (409) rather than deleted — it may be the owner's only copy of
their data (a real filesystem mount, not just a sync cache the client can
always regenerate by pushing again). The legacy (non-mounted) shape,
including a vault repo name that hasn't been mounted, keeps today's exact
delete-and-recreate behavior, unchanged — see `vault.py` for the
mounted/legacy distinction this defers to.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import vault
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps
from ..gitrepo import InvalidRepoName, ensure_bare_repo, resolve_repo_path


def build_router(get_db, settings, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/git-repos", tags=["git"])

    @router.post("/{repo_name}/reset")
    def reset_repo(
        repo_name: str,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        if ctx.scope is not None:
            raise HTTPException(status_code=403, detail="An interactive session is required")

        if repo_name == settings.vault_repo_name and vault.is_mounted(settings):
            write_audit_event(
                db,
                "git.vault_reset_refused",
                principal=ctx.principal,
                reason=f"repo={repo_name}",
                request=request,
            )
            raise HTTPException(
                status_code=409,
                detail="Cannot reset a server-mounted vault. It may be your only copy of this data.",
            )

        try:
            # Same validation + containment the git HTTP layer uses — one
            # path-resolution implementation, not a second guess.
            path = resolve_repo_path(Path(settings.git_root), f"/{repo_name}.git")
        except InvalidRepoName:
            raise HTTPException(status_code=422, detail="Invalid repository name")
        if path.exists():
            shutil.rmtree(path)
        ensure_bare_repo(path)
        write_audit_event(
            db,
            "git.repo_reset",
            principal=ctx.principal,
            reason=f"repo={repo_name}",
            request=request,
        )
        return {"ok": True}

    return router

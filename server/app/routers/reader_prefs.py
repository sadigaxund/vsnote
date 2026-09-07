"""`/api/reader-prefs` — feat(share) R4: the OWNER's "Reader appearance"
settings (Settings > Sharing's new group, `src/components/settings/
Sharing.tsx`), applied to every one of that owner's Rendered-mode shares.
Same auth posture as `routers/admin.py`'s doc explains for `/api/admin/*`:
the app-level `/api/*` deny posture (401 no identity), NOT the `/share/*`
uniform-404 policy gate — there's no existence-oracle concern on a fixed,
well-known owner-settings route.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import AuthContext, AuthDeps
from ..reader_prefs import get_reader_prefs, set_reader_prefs


def build_router(get_db, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/reader-prefs", tags=["reader-prefs"])

    @router.get("", response_model=schemas.ReaderPrefs)
    def get_prefs(ctx: AuthContext = Depends(auth_deps.require_auth_context)):
        return get_reader_prefs(ctx.user)

    @router.put("", response_model=schemas.ReaderPrefs)
    def put_prefs(
        payload: schemas.ReaderPrefs,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),
        db: Session = Depends(get_db),
    ):
        return set_reader_prefs(db, ctx.user, payload)

    return router

"""`/api/admin/*` — admin-only runtime settings (DESIGN-SPEC Amendments
round 5, item 40). Mounted on the `/api` sub-app alongside `routers/auth.py`
and `routers/shares.py`: every route here sits behind the SAME app-level
identity those do (Cf-Access JWT, app session cookie, or a bearer token),
NOT the `/share/*` uniform-404 policy gate in `policy.py` — see
`auth.py::build_auth_deps`'s `require_admin` docstring for why that
distinction is deliberate, not an oversight (in short: the policy gate
exists to prevent an existence oracle on secret, guessable share slugs;
there is no analogous secret on a fixed, well-known admin route, so the
already-established `/api/*` deny posture — 401 with no identity, 403 with
identity but insufficient privilege — applies here exactly as it does to
every other owner-side route).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import schemas
from ..audit import write_audit_event
from ..auth import AuthContext, AuthDeps
from ..runtime_settings import get_max_blob_bytes, set_max_blob_bytes


def build_router(get_db, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin"])

    @router.get("/settings", response_model=schemas.RuntimeSettingsOut)
    def get_settings(
        ctx: AuthContext = Depends(auth_deps.require_admin),
        db: Session = Depends(get_db),
    ):
        return schemas.RuntimeSettingsOut(max_blob_bytes=get_max_blob_bytes(db))

    @router.put("/settings", response_model=schemas.RuntimeSettingsOut)
    def put_settings(
        payload: schemas.RuntimeSettingsIn,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_admin),
        db: Session = Depends(get_db),
    ):
        row = set_max_blob_bytes(db, payload.max_blob_bytes)
        write_audit_event(
            db,
            "admin.settings_update",
            principal=ctx.principal,
            reason=f"max_blob_bytes={row.max_blob_bytes}",
            request=request,
        )
        return schemas.RuntimeSettingsOut(max_blob_bytes=row.max_blob_bytes)

    return router

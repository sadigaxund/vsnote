"""DB-backed admin-adjustable runtime settings (DESIGN-SPEC Amendments round
5, item 40). One singleton row (`models.RuntimeSettings`, primary key
`RUNTIME_SETTINGS_ID`) holds every admin-adjustable value; this phase's only
tenant is `max_blob_bytes`.

Precedence (this is the load-bearing contract every call site below and in
main.py relies on): `Settings.max_blob_bytes` (env `VSNOTE_MAX_BLOB_BYTES`)
SEEDS the singleton row exactly ONCE, the first time an app boots against a
DB that doesn't have the row yet (`main.py::bootstrap_runtime_settings`,
called from `create_app()` right after `bootstrap_user` — same
never-overwrite-once-it-exists idempotency). From that point on the DB row
is authoritative: every enforcement site
(`routers/shares.py::create_blob`, `routers/share_public.py::put_share`) and
the admin `GET`/`PUT /api/admin/settings` handlers
(`routers/admin.py`) read/write through `get_max_blob_bytes`/
`set_max_blob_bytes` below, NEVER `settings.max_blob_bytes` directly.
Restarting the process with a different `VSNOTE_MAX_BLOB_BYTES` therefore
has zero effect once the row exists, whether it was written by the initial
boot-seed or by an admin's PUT.
"""

from __future__ import annotations

import time

from sqlalchemy.orm import Session

from . import models

RUNTIME_SETTINGS_ID = 1

# Bounds for `max_blob_bytes` (DESIGN-SPEC item 40: "1-100 MB"), inclusive
# on both ends. `schemas.RuntimeSettingsIn` enforces these at the API
# boundary (a plain pydantic 422, not a crash) — imported from here so the
# schema and the enforcement logic can never drift apart.
MIN_MAX_BLOB_BYTES = 1 * 1024 * 1024  # 1 MB
MAX_MAX_BLOB_BYTES = 100 * 1024 * 1024  # 100 MB


def get_runtime_settings(db: Session) -> "models.RuntimeSettings":
    """Returns the singleton row. In every real deployment this is never
    None — `create_app()` seeds it via `bootstrap_runtime_settings` before
    any request can possibly be served — but a hand-built `Session` in a
    test that skips that boot step gets a safe, UNSAVED fallback (seeded at
    the config-level default's floor) rather than a crash."""
    row = db.get(models.RuntimeSettings, RUNTIME_SETTINGS_ID)
    if row is None:
        row = models.RuntimeSettings(id=RUNTIME_SETTINGS_ID, max_blob_bytes=MIN_MAX_BLOB_BYTES)
    return row


def get_max_blob_bytes(db: Session) -> int:
    return get_runtime_settings(db).max_blob_bytes


def set_max_blob_bytes(db: Session, value: int) -> "models.RuntimeSettings":
    """Writes the admin-set value. Bounds are validated at the schema layer
    (`schemas.RuntimeSettingsIn`) before this is ever called — this function
    trusts its caller, same division of responsibility as the rest of the
    routers (see routers/admin.py)."""
    row = db.get(models.RuntimeSettings, RUNTIME_SETTINGS_ID)
    if row is None:
        row = models.RuntimeSettings(id=RUNTIME_SETTINGS_ID, max_blob_bytes=value)
        db.add(row)
    else:
        row.max_blob_bytes = value
        row.updated_at = time.time()
    db.commit()
    db.refresh(row)
    return row

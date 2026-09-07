"""feat(share) — R4 owner-side "Reader appearance" settings. `User.
reader_prefs` (models.py) holds a JSON-encoded `schemas.ReaderPrefs` blob;
this module is the ONE place that parses/serializes it, so both the owner
Settings endpoint (`routers/reader_prefs.py`) and the public share content
endpoint (`routers/share_public.py`'s `_content_payload`) can never drift on
what "the stored prefs" means. Same "small settings blob, one owning
module" shape as `runtime_settings.py`'s admin-wide equivalent.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from . import models, schemas


def get_reader_prefs(user: "models.User") -> schemas.ReaderPrefs:
    """Never raises: a `None` column (never saved), an empty string, or a
    stored blob written by some future/older client that pydantic can't
    parse under the CURRENT closed-enum schema all fall back to
    `ReaderPrefs`'s own defaults — the exact defaults the removed R3-5b
    pill used, so an owner who never touches this setting (or whose stored
    value has gone stale under a schema change) gets a coherent visitor
    experience, never a 500."""
    raw = user.reader_prefs
    if not raw:
        return schemas.ReaderPrefs()
    try:
        return schemas.ReaderPrefs.model_validate_json(raw)
    except Exception:
        return schemas.ReaderPrefs()


def set_reader_prefs(db: Session, user: "models.User", prefs: schemas.ReaderPrefs) -> schemas.ReaderPrefs:
    user.reader_prefs = prefs.model_dump_json()
    db.commit()
    db.refresh(user)
    return prefs

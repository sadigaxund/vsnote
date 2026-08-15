"""Audit-log writer. Every deny (policy.py) and auth failure (routers/auth.py)
writes exactly one row here. `reason` is the INTERNAL explanation — callers
must never put this string into a response body (see models.AuditEvent's
docstring)."""

from __future__ import annotations

from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from . import models

# Recognized event names (roadmap-driven; not DB-enforced, kept as a plain
# string column so new event kinds don't need a migration):
#   auth.failure, policy.deny, share.publish, share.revoke, share.access,
#   token.create, token.revoke, login.success, login.failure


def write_audit_event(
    db: Session,
    event: str,
    *,
    slug: Optional[str] = None,
    principal: Optional[str] = None,
    reason: Optional[str] = None,
    request: Optional[Request] = None,
) -> None:
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    if request is not None:
        ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
    row = models.AuditEvent(
        event=event,
        slug=slug,
        principal=principal,
        reason=reason,
        ip=ip,
        user_agent=user_agent,
    )
    db.add(row)
    db.commit()

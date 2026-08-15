"""THE single deny-by-default share policy gate (roadmap §1). Every
`/share/*` request — raw GET, JSON-content GET, the password auth POST, and
the editor-only PUT — is resolved through `resolve_share()` below. There is
no other code path anywhere in this server that looks up a Share by slug.

Deny-by-default order (roadmap §1, implemented exactly in this sequence):
  1. identifier matches SLUG_RE
  2. share exists (lookup by slug OR alias)
  3. not revoked
  4. not expired
  5. general_access/auth requirement satisfied
  6. role allows the method (GET/HEAD = viewer+, PUT/PATCH = editor only)

Every deny path raises `PolicyDenied(reason)` — `reason` is for the audit
log ONLY and never reaches a client response. `denial_response()` below is
the ONE place a PolicyDenied becomes an HTTP response, and it ALWAYS emits
the exact same thing: `404 {"detail": "Not found"}`, no extra headers. There
is no second response shape anywhere in this module.

--- Uniform deny: why every reason collapses to the SAME 404 ---

ROADMAP-SHARING-AUTH.md §1 is literal: "no existence oracle: 404 for
missing/revoked/expired/unauthorized-without-identity look identical." Read
literally, that means EVERY deny reason for GET must be indistinguishable —
not just "missing vs. password-required" (an earlier draft of this module
treated that one pair specially and left every other pair distinguishable;
see docs/ARCHITECTURE.md's Deviations entry for the measured two-class
fingerprint that caught this and the full account of what changed).

Concretely, if a password-required deny returned 401 while every other deny
(revoked, expired, restricted, token-required) returned 404, an attacker
holding a candidate slug could learn its status for free just from the
status code: 404 proves the slug names a real record (something to revoke,
expire, or restrict), 401 proves it's either nonexistent or specifically
password-gated. That is a real, exploitable existence oracle on exactly the
kind of secret capability link this feature exists to protect — it doesn't
matter that "missing" and "password_no_session" happened to match each
other; every OTHER pair didn't.

The fix: there is exactly ONE deny response for the entire gate, for every
method (GET/HEAD/PUT/PATCH) and every reason (malformed, nonexistent,
revoked, expired, restricted-without-identity, restricted-wrong-identity,
token-required, invalid-token, password-required-without-session,
wrong-role-for-method). Yes, this means a real, live, password-protected
share ALSO 404s to a GET with no session — a caller cannot tell "this link
is dead" apart from "this link needs a password" from the response alone.
That is intentional: the alternative (a distinct 401 "enter a password"
challenge) is precisely the leak above. The client-side contract this
creates — render one generic "this link is unavailable, or it requires a
password" state on 404, with a password field that blindly POSTs to
`/share/{id}/auth` — is documented in server/README.md's "Public share
contract" section for the Phase 10 client to implement.

`POST /share/{id}/auth` is unaffected by any of this — it already had its
own, always-correct symmetric 404 (wrong password and nonexistent slug are
already indistinguishable there; see routers/share_public.py) and doesn't
go through `resolve_share()` at all.

tests/test_policy_gate.py::test_deny_state_equivalence_matrix builds every
deny state above and asserts they fingerprint (status, body, headers minus
Date/Content-Length/rate-limit) to the exact same tuple — a test that is
provably capable of catching a regression here (verified RED against a
deliberately reintroduced two-class bug, then GREEN against this file).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from . import models, security
from .audit import write_audit_event

NOT_FOUND_BODY = {"detail": "Not found"}

WRITE_METHODS = {"PUT", "PATCH"}
READ_METHODS = {"GET", "HEAD"}


class PolicyDenied(Exception):
    """Raised by every deny branch in resolve_share(). `reason` is
    audit-log-only (see audit.py / models.AuditEvent's docstring) — it is
    never read by denial_response() and must never be threaded into any
    client-facing text."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def not_found_response() -> JSONResponse:
    return JSONResponse(status_code=404, content=NOT_FOUND_BODY)


def denial_response(exc: "PolicyDenied") -> JSONResponse:
    """The ONLY place a PolicyDenied becomes an HTTP response. There is
    exactly one possible outcome — see the module docstring for why a
    second ("password challenge") response shape was removed."""
    return not_found_response()


@dataclass
class ShareAccess:
    share: models.Share
    role: str  # "viewer" | "editor"
    principal: Optional[str]


def lookup_share(db: Session, identifier: str) -> Optional[models.Share]:
    """Public helper — also used directly by routers/share_public.py's
    POST .../auth handler, which implements its own (also symmetric) 404
    for both wrong-password and nonexistent-slug instead of going through
    resolve_share()."""
    return (
        db.query(models.Share)
        .filter((models.Share.slug == identifier) | (models.Share.alias == identifier))
        .one_or_none()
    )


def has_valid_share_session(secret_key: str, share: models.Share, cookie_value: Optional[str]) -> bool:
    if not cookie_value:
        return False
    payload = security.verify_signed_cookie(secret_key, cookie_value)
    if not payload:
        return False
    # Constant-time compare on the slug binding, even though it's already
    # inside an HMAC-verified payload — belt and suspenders per roadmap's
    # "constant-time comparison for any secret comparison" requirement.
    return payload.get("kind") == "share_session" and security.constant_time_eq(
        str(payload.get("slug", "")), share.slug
    )


def _grant_role(db: Session, share: models.Share, principal: Optional[str]) -> Optional[str]:
    if not principal:
        return None
    grant = (
        db.query(models.ShareGrant)
        .filter(models.ShareGrant.share_id == share.id, models.ShareGrant.principal == principal)
        .one_or_none()
    )
    if grant is None:
        return None
    return grant.role.value if hasattr(grant.role, "value") else str(grant.role)


def resolve_share(
    db: Session,
    identifier: str,
    method: str,
    *,
    secret_key: str,
    session_cookie: Optional[str] = None,
    bearer_token: Optional[str] = None,
    principal: Optional[str] = None,
    request: Optional[Request] = None,
) -> ShareAccess:
    method = method.upper()

    # 1. Format. Never a 422 — a format failure takes the identical deny
    # path a missing/malformed identifier would (roadmap §1). No DB query
    # happens for a malformed identifier, so this branch costs nothing that
    # could be timed against a real lookup.
    if not security.validate_slug_format(identifier):
        write_audit_event(db, "policy.deny", slug=identifier, reason="malformed_slug", request=request)
        raise PolicyDenied("malformed_slug")

    share = lookup_share(db, identifier)

    # 2. Existence.
    if share is None:
        write_audit_event(db, "policy.deny", slug=identifier, reason="nonexistent", request=request)
        raise PolicyDenied("nonexistent")

    # 3. Revoked.
    if share.revoked_at is not None:
        write_audit_event(db, "policy.deny", slug=share.slug, reason="revoked", request=request)
        raise PolicyDenied("revoked")

    # 4. Expired.
    if share.expires_at is not None and share.expires_at < time.time():
        write_audit_event(db, "policy.deny", slug=share.slug, reason="expired", request=request)
        raise PolicyDenied("expired")

    # 5. Auth requirement.
    if share.auth_mode == models.AuthMode.none:
        pass
    elif share.auth_mode == models.AuthMode.password:
        if not has_valid_share_session(secret_key, share, session_cookie):
            write_audit_event(db, "policy.deny", slug=share.slug, reason="password_required", request=request)
            raise PolicyDenied("password_required")
    elif share.auth_mode == models.AuthMode.token:
        if not bearer_token:
            write_audit_event(db, "policy.deny", slug=share.slug, reason="token_required", request=request)
            raise PolicyDenied("token_required")
        token_row = (
            db.query(models.ApiToken)
            .filter(models.ApiToken.token_hash == security.hash_token(bearer_token))
            .one_or_none()
        )
        now = time.time()
        if (
            token_row is None
            or token_row.revoked_at is not None
            or (token_row.expires_at is not None and token_row.expires_at < now)
        ):
            write_audit_event(db, "policy.deny", slug=share.slug, reason="invalid_token", request=request)
            raise PolicyDenied("invalid_token")
        token_row.last_used_at = now
        db.commit()

    # Restricted general access additionally requires the caller's resolved
    # identity to be a listed principal.
    if share.general_access == models.GeneralAccess.restricted:
        if not principal:
            write_audit_event(db, "policy.deny", slug=share.slug, reason="restricted_no_identity", request=request)
            raise PolicyDenied("restricted_no_identity")
        role = _grant_role(db, share, principal)
        if role is None:
            write_audit_event(db, "policy.deny", slug=share.slug, reason="restricted_wrong_identity", request=request)
            raise PolicyDenied("restricted_wrong_identity")
    else:
        # "link" (anyone with the link) defaults to viewer; an explicit
        # grant for the resolved principal (if any) can upgrade to editor.
        role = _grant_role(db, share, principal) or "viewer"

    # commenter is not a usable role yet (rejected at the API for new
    # grants — schemas.GrantIn); if one somehow exists, treat as viewer.
    if role == "commenter":
        role = "viewer"

    # 6. Role allows method.
    if method in WRITE_METHODS and role != "editor":
        write_audit_event(db, "policy.deny", slug=share.slug, reason="role_forbids_method", request=request)
        raise PolicyDenied("role_forbids_method")

    return ShareAccess(share=share, role=role, principal=principal)

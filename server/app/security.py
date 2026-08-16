"""Password hashing (argon2id), token hashing, slug generation/validation,
and constant-time helpers. Nothing here talks to the DB — pure functions
only, so they're trivially unit-testable.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import string
import time
from typing import Any, Dict, Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

# argon2-cffi's PasswordHasher() defaults are already argon2id with sensible
# time/memory/parallelism costs (RFC 9106-ish); no need to hand-tune them.
_ph = PasswordHasher()

# --- Slugs -------------------------------------------------------------

# Base62: [0-9A-Za-z], never a hash of content or path (roadmap §1 — hashes
# are enumerable/oracle-y). 22 chars * log2(62) ≈ 130.99 bits >= 128.
SLUG_ALPHABET = string.ascii_letters + string.digits
SLUG_LENGTH = 22

# Validated at BOTH the API boundary (path param constraint) and inside the
# policy gate (policy.py). Note this is intentionally a SUPERSET of
# SLUG_ALPHABET (also allows '_' and '-') so custom aliases can use them too;
# generated slugs themselves only ever use SLUG_ALPHABET.
SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def generate_slug(length: int = SLUG_LENGTH) -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(length))


def validate_slug_format(identifier: str) -> bool:
    return bool(SLUG_RE.match(identifier))


# --- Passwords -----------------------------------------------------------


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False


# A fixed, precomputed hash so an unknown-username login still pays the same
# argon2 verify cost as a real one — a timing-based account-enumeration
# guard for POST /api/auth/login (roadmap §2).
_DUMMY_PASSWORD_HASH = _ph.hash("vsnote-dummy-password-for-timing-parity")


def verify_password_constant_time_for_missing_user(password: str) -> None:
    """Call (and ignore the result) whenever the looked-up user doesn't
    exist, so the login endpoint performs one argon2 verify regardless of
    account existence."""
    try:
        _ph.verify(_DUMMY_PASSWORD_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        pass


# --- Tokens ----------------------------------------------------------------


def generate_api_token() -> str:
    # `vsn_` (DESIGN-SPEC item 34's rebrand): the prefix is operator-visible —
    # it is shown in the token list and is the first thing on any token an
    # operator pastes into a git credential helper. Safe to change: each row
    # stores its OWN prefix (`routers/auth.py`'s `prefix=plaintext[:12]`) and
    # lookup is by that stored value, never against this constant, so tokens
    # minted as `slt_` before the rename keep validating unchanged.
    return "vsn_" + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 of the high-entropy secret. Never reversible, never the
    plaintext — the plaintext is returned to the caller exactly once at
    creation time and is not retrievable afterward."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --- Constant-time comparison ---------------------------------------------


def constant_time_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


# --- Signed, expiring cookie values ----------------------------------------
#
# Used for BOTH the app session cookie (auth.py) and the per-share password
# session cookie (policy.py / share_public.py). Format: "<b64url-json>.<hmac
# hex>" — HMAC-SHA256 over the base64 blob, verified with compare_digest.


def make_signed_cookie(secret_key: str, payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    sig = hmac.new(secret_key.encode("utf-8"), b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def verify_signed_cookie(secret_key: str, cookie_value: str) -> Optional[Dict[str, Any]]:
    if not cookie_value or "." not in cookie_value:
        return None
    b64, sig = cookie_value.rsplit(".", 1)
    expected = hmac.new(secret_key.encode("utf-8"), b64.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        padded = b64 + "=" * (-len(b64) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
        payload = json.loads(raw)
    except Exception:
        return None
    exp = payload.get("exp")
    if exp is not None and time.time() > exp:
        return None
    return payload

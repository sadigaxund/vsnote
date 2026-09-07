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
# policy gate (policy.py). This is ONLY the shape of a *generated* slug —
# see ALIAS_RE below for why custom aliases now get their own, looser
# pattern instead of sharing this one. Never loosen this to accommodate
# aliases: `test_slug.py`'s accept/reject table pins this exact shape, and
# widening it would silently widen what the policy gate accepts as "not
# even worth a DB lookup" for the OTHER identifier kind, defeating the
# split below.
SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def generate_slug(length: int = SLUG_LENGTH) -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(length))


def validate_slug_format(identifier: str) -> bool:
    return bool(SLUG_RE.match(identifier))


# --- Custom aliases -----------------------------------------------------
#
# R3-4 — the owner wants short, memorable aliases ("get", "help"). Generated
# slugs stay 22 mixed-case characters (`SLUG_LENGTH`/`SLUG_ALPHABET` above,
# unchanged) precisely BECAUSE they're never typed by a human and need the
# entropy; a custom alias is chosen and typed by the owner, so it gets its
# OWN, deliberately looser rules instead of `SLUG_RE` being loosened to fit
# both jobs:
#   - length 2-64 (was 8-64, shared with slugs)
#   - lowercase-only `[a-z0-9_-]` (was mixed-case) — an uppercase character
#     is a REJECTED input, never silently downcased: silently rewriting the
#     alias would hand the owner back a different URL than the one they
#     just typed and clicked "Publish" on.
ALIAS_MIN_LENGTH = 2
ALIAS_MAX_LENGTH = 64
ALIAS_RE = re.compile(rf"^[a-z0-9_-]{{{ALIAS_MIN_LENGTH},{ALIAS_MAX_LENGTH}}}$")


def validate_alias_format(alias: str) -> bool:
    return bool(ALIAS_RE.match(alias))


# The PUBLIC gate (`policy.py::resolve_share`, `routers/share_public.py`'s
# password-auth route) sees one `identifier` path segment that could be
# EITHER kind — it has to accept whichever of the two shapes matches before
# ever touching the DB (roadmap §1 step 1: a format failure is free, no
# lookup). Note the two ranges overlap at 8-64 chars (a slug can never be
# lowercase-only length 2-7, since it's always 22 chars; a >=8-char alias is
# accepted by either regex) — the union is exactly "2-7 chars: lowercase
# alias only; 8-64 chars: either shape".
def validate_identifier_format(identifier: str) -> bool:
    return validate_slug_format(identifier) or validate_alias_format(identifier)


# §4.5 — reserved words an alias can never be. Two parts:
#   1. A fixed list of words that read as "this is obviously a system path"
#      even though they are not literally routes this server serves today
#      (`static`, `admin`, `login`, `logout`, `health`, `s`, `raw`) —
#      reserving them now avoids ever having to evict an existing owner's
#      alias if one of these becomes a real route later.
#   2. Every top-level path this server or the SPA ACTUALLY serves today,
#      enumerated (not guessed) from:
#        - `server/app/main.py`'s root-app mounts/routes: `/share/*`
#          (share_public_router), `/git/*` (git_http_router's mount), and
#          `/api` (the api_app mount) — these are the only three
#          registrations on the ROOT app before the SPA catch-all, so
#          they're the only prefixes that could ever collide with
#          `/<alias>` at the browser-navigation layer.
#        - Vite's build output (`dist/`, confirmed by `ls dist/`): the
#          default `assetsDir` is `assets/`, so `/assets/*` is a second
#          real top-level path the SPA catch-all serves straight off disk.
#        - The SPA's own top-level client routing (`src/main.tsx`): there
#          is no client-side router (no react-router) — the ENTIRE client
#          route surface is the single `/^\/share\/(.+?)\/?$/` regex
#          branch in `main.tsx`, which is already covered by `share` above.
#          `src/App.tsx` adds no further top-level routes (it's the
#          always-mounted shell for the non-share branch, not a router).
#      Re-derive by re-reading those two files plus `ls dist/` if this list
#      is ever in doubt — nothing here is inferred from naming convention.
# Checked case-insensitively at BOTH create and patch time
# (`routers/shares.py`) via `alias_error` below — a single source of truth
# so the two call sites can't drift apart.
RESERVED_ALIASES = frozenset(
    {
        # actually-served top-level paths (main.py mounts + dist/assets)
        "api",
        "share",
        "git",
        "assets",
        # reserved pre-emptively — not live routes today, but the words an
        # owner would reasonably expect a real app to use for one
        "static",
        "admin",
        "login",
        "logout",
        "health",
        "s",
        "raw",
    }
)


def alias_error(alias: str) -> Optional[str]:
    """Returns a clean, owner-facing error string for an invalid alias, or
    `None` if the alias is acceptable on format/reserved-word grounds alone
    (uniqueness against existing slugs/aliases is a separate, case-
    insensitive DB-backed check — see `routers/shares.py`)."""
    if len(alias) < ALIAS_MIN_LENGTH or len(alias) > ALIAS_MAX_LENGTH:
        return f"alias must be {ALIAS_MIN_LENGTH}-{ALIAS_MAX_LENGTH} characters"
    if not validate_alias_format(alias):
        # Covers uppercase letters (the common case worth naming explicitly
        # per R3-4's decision — never silently downcased) as well as any
        # other disallowed character (spaces, slashes, punctuation, ...).
        return "Use lowercase letters, digits, hyphens and underscores"
    if alias.lower() in RESERVED_ALIASES:
        return "alias is a reserved word and can't be used"
    return None


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

"""Env-driven configuration. See server/.env.example and server/README.md for
the full list and what each variable does.
"""

from __future__ import annotations

import secrets
import warnings
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # populate_by_name=True matters a lot here: it lets tests construct
    # `Settings(db_url=..., rate_limit_share_auth=...)` directly with the
    # Pythonic field names (used throughout tests/conftest.py), in addition
    # to the SLATE_*/CF_ACCESS_* env var aliases used at process startup.
    # Without it, pydantic-settings only accepts the alias as a constructor
    # kwarg once validation_alias is set, silently ignoring `db_url=` (a
    # real bug caught during Phase 9 manual verification — see
    # ARCHITECTURE.md's Backend deviations note).
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    # "dev" (default) or "prod". Only gates whether SLATE_SECRET_KEY is
    # required — never used as an implicit trust/auth signal anywhere else.
    slate_env: str = Field(default="dev", validation_alias="SLATE_ENV")

    db_url: str = Field(default="sqlite:///./slate.db", validation_alias="SLATE_DB_URL")

    # Required in prod. Auto-generated (ephemeral, per-process, with a loud
    # warning) in dev so `npm run server` works out of the box locally.
    secret_key: Optional[str] = Field(default=None, validation_alias="SLATE_SECRET_KEY")

    port: int = Field(default=8787, validation_alias="SLATE_PORT")

    cf_access_team_domain: Optional[str] = Field(default=None, validation_alias="CF_ACCESS_TEAM_DOMAIN")
    cf_access_aud: Optional[str] = Field(default=None, validation_alias="CF_ACCESS_AUD")

    max_blob_bytes: int = Field(default=5 * 1024 * 1024, validation_alias="SLATE_MAX_BLOB_BYTES")

    # Phase 11 (real sync) — where bare git repos live, one directory per
    # repo name (`{SLATE_GIT_ROOT}/{repo}.git`), created on demand. Relative
    # paths are resolved against the CWD the process is started from (same
    # convention as `SLATE_DB_URL`'s sqlite path) — `npm run server` runs
    # uvicorn with `--app-dir server`, so the default lands at
    # `server/git-repos/`. See `app/gitrepo.py`'s module docstring for the
    # path-safety contract every repo name is validated against before this
    # setting is ever joined with user input.
    git_root: str = Field(default="./git-repos", validation_alias="SLATE_GIT_ROOT")

    # slowapi/`limits`-syntax strings, e.g. "60/minute". Kept as plain
    # strings (not parsed here) so a Limiter can consume them directly.
    rate_limit_default: str = Field(default="120/minute", validation_alias="SLATE_RATE_LIMIT_DEFAULT")
    rate_limit_share_auth: str = Field(default="5/minute", validation_alias="SLATE_RATE_LIMIT_SHARE_AUTH")
    rate_limit_share: str = Field(default="60/minute", validation_alias="SLATE_RATE_LIMIT_SHARE")

    session_ttl_min: int = Field(default=30, validation_alias="SLATE_SESSION_TTL_MIN")

    # Defaults True (real HTTPS deployments). server/README.md documents
    # setting this False for local http:// testing only.
    cookie_secure: bool = Field(default=True, validation_alias="SLATE_COOKIE_SECURE")


def resolve_secret_key(settings: Settings) -> str:
    """Computed once per app instance (see create_app) — never re-derived
    per-request, so an ephemeral dev key stays stable for the process
    lifetime (otherwise every signed cookie would fail verification on the
    very next request)."""
    if settings.secret_key:
        return settings.secret_key
    if settings.slate_env == "prod":
        raise RuntimeError("SLATE_SECRET_KEY is required when SLATE_ENV=prod")
    ephemeral = secrets.token_urlsafe(32)
    warnings.warn(
        "SLATE_SECRET_KEY is not set — using an EPHEMERAL, per-process secret "
        "key for signed cookies/sessions. This is fine for local dev only: "
        "every restart invalidates all sessions, and this MUST NOT be used "
        "for a shared or multi-worker deployment. Set SLATE_SECRET_KEY.",
        RuntimeWarning,
        stacklevel=2,
    )
    return ephemeral

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
    # to the VSNOTE_*/CF_ACCESS_* env var aliases used at process startup.
    # Without it, pydantic-settings only accepts the alias as a constructor
    # kwarg once validation_alias is set, silently ignoring `db_url=` (a
    # real bug caught during Phase 9 manual verification — see
    # ARCHITECTURE.md's Backend deviations note).
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    # "dev" (default) or "prod". Only gates whether VSNOTE_SECRET_KEY is
    # required — never used as an implicit trust/auth signal anywhere else.
    env: str = Field(default="dev", validation_alias="VSNOTE_ENV")

    db_url: str = Field(default="sqlite:///./vsnote.db", validation_alias="VSNOTE_DB_URL")

    # Required in prod. Auto-generated (ephemeral, per-process, with a loud
    # warning) in dev so `npm run server` works out of the box locally.
    secret_key: Optional[str] = Field(default=None, validation_alias="VSNOTE_SECRET_KEY")

    port: int = Field(default=8787, validation_alias="VSNOTE_PORT")

    cf_access_team_domain: Optional[str] = Field(default=None, validation_alias="CF_ACCESS_TEAM_DOMAIN")
    cf_access_aud: Optional[str] = Field(default=None, validation_alias="CF_ACCESS_AUD")

    max_blob_bytes: int = Field(default=5 * 1024 * 1024, validation_alias="VSNOTE_MAX_BLOB_BYTES")

    # Phase 11 (real sync) — where bare git repos live, one directory per
    # repo name (`{VSNOTE_GIT_ROOT}/{repo}.git`), created on demand. Relative
    # paths are resolved against the CWD the process is started from (same
    # convention as `VSNOTE_DB_URL`'s sqlite path) — `npm run server` runs
    # uvicorn with `--app-dir server`, so the default lands at
    # `server/git-repos/`. See `app/gitrepo.py`'s module docstring for the
    # path-safety contract every repo name is validated against before this
    # setting is ever joined with user input.
    git_root: str = Field(default="./git-repos", validation_alias="VSNOTE_GIT_ROOT")

    # slowapi/`limits`-syntax strings, e.g. "60/minute". Kept as plain
    # strings (not parsed here) so a Limiter can consume them directly.
    rate_limit_default: str = Field(default="120/minute", validation_alias="VSNOTE_RATE_LIMIT_DEFAULT")
    rate_limit_share_auth: str = Field(default="5/minute", validation_alias="VSNOTE_RATE_LIMIT_SHARE_AUTH")
    rate_limit_share: str = Field(default="60/minute", validation_alias="VSNOTE_RATE_LIMIT_SHARE")

    session_ttl_min: int = Field(default=30, validation_alias="VSNOTE_SESSION_TTL_MIN")

    # Defaults True (real HTTPS deployments). server/README.md documents
    # setting this False for local http:// testing only.
    cookie_secure: bool = Field(default=True, validation_alias="VSNOTE_COOKIE_SECURE")

    # Phase 12 (DESIGN-SPEC Amendments round 4 item 32) — "fallback-login
    # onboarding": the app-level username+password login (`routers/auth.py`)
    # is otherwise dead the moment nothing has ever created a `User` row
    # (only `scripts/demo.sh` did, previously). Both unset (the default) is
    # a complete no-op. Setting exactly ONE is a startup-time configuration
    # error (`main.py::bootstrap_user` raises loudly rather than silently
    # creating a half-configured account) — see that function's doc for the
    # full idempotency/never-overwrite/never-log-the-password contract.
    bootstrap_user: Optional[str] = Field(default=None, validation_alias="VSNOTE_BOOTSTRAP_USER")
    bootstrap_password: Optional[str] = Field(default=None, validation_alias="VSNOTE_BOOTSTRAP_PASSWORD")

    # Phase 17 Milestone A — the server-mounted, AUTHORITATIVE vault. Unset
    # (the default): no change from every earlier phase — the vault is just
    # the ordinary bare repo `{git_root}/{vault_repo_name}.git`, created on
    # demand like any other synced repo. Set to a filesystem path (a docker
    # volume mount or a host path) to make the vault a real, non-bare
    # working tree the owner can also read/edit directly (over SSH, another
    # editor, ...) — see `app/vault.py`'s module docstring for the full
    # identity-resolution + working-tree contract every other module (
    # `gitrepo.py`/`routers/git_http.py`/`vaultcommit.py`/`routers/
    # git_admin.py`) now goes through instead of guessing. An existing repo
    # at this path is always respected: nothing here ever auto-creates or
    # overwrites it, only the explicit `POST /api/vault/init` does.
    vault_path: Optional[str] = Field(default=None, validation_alias="VSNOTE_VAULT_PATH")

    # The repo NAME clients use in `<origin>/git/<name>.git` to reach the
    # vault (whichever shape it is). Must match `gitrepo.REPO_NAME_RE` — see
    # `app/vault.py::validate_vault_repo_name`, called at `create_app()` time
    # so a misconfigured value fails loudly at startup rather than silently
    # 404ing every request for it later.
    vault_repo_name: str = Field(default="vault", validation_alias="VSNOTE_VAULT_REPO_NAME")


def resolve_secret_key(settings: Settings) -> str:
    """Computed once per app instance (see create_app) — never re-derived
    per-request, so an ephemeral dev key stays stable for the process
    lifetime (otherwise every signed cookie would fail verification on the
    very next request)."""
    if settings.secret_key:
        return settings.secret_key
    if settings.env == "prod":
        raise RuntimeError("VSNOTE_SECRET_KEY is required when VSNOTE_ENV=prod")
    ephemeral = secrets.token_urlsafe(32)
    warnings.warn(
        "VSNOTE_SECRET_KEY is not set — using an EPHEMERAL, per-process secret "
        "key for signed cookies/sessions. This is fine for local dev only: "
        "every restart invalidates all sessions, and this MUST NOT be used "
        "for a shared or multi-worker deployment. Set VSNOTE_SECRET_KEY.",
        RuntimeWarning,
        stacklevel=2,
    )
    return ephemeral

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

    # ---- OAuth sign-in (TODO §8.2) ------------------------------------
    # Google-first, structured for provider extension. Both client fields
    # set ⇒ the provider's "Continue with Google" button renders and its
    # start/callback routes go live; otherwise they 404 (UI hides them via
    # /api/auth/oauth/providers). Redirect URI registered with the
    # provider is `{public origin}/api/auth/oauth/google/callback`.
    oauth_google_client_id: str = Field(default="", validation_alias="VSNOTE_OAUTH_GOOGLE_CLIENT_ID")
    oauth_google_client_secret: str = Field(default="", validation_alias="VSNOTE_OAUTH_GOOGLE_CLIENT_SECRET")

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

    # Phase 17 — the app-wide login gate (`routers/app_config.py`). True
    # (the default) means "gate the shell as soon as a credential path
    # exists"; the endpoint's own conjunction is what keeps a
    # credential-less deployment from locking its owner out. Set False to
    # keep the shell open on a deployment that HAS accounts and knows what
    # it is doing (the e2e suite does exactly this).
    require_login: bool = Field(default=True, validation_alias="VSNOTE_REQUIRE_LOGIN")

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

    # Phase 17 Milestone B — where SERVER-SIDE-ONLY credentials for
    # mirroring the vault to external remotes live (SSH private keys, HTTPS
    # tokens, the shared known_hosts file). Defaults the same relative way
    # `VSNOTE_GIT_ROOT` does: "./secrets", resolved against the CWD the
    # process is started from (`server/secrets/` under `npm run server`).
    # Created with 0700 permissions on first use; every credential file
    # inside it is written 0600 — see `app/secrets_store.py`'s module
    # docstring for the full contract. Never served, never logged, never
    # baked into the image.
    secrets_path: str = Field(default="./secrets", validation_alias="VSNOTE_SECRETS_PATH")

    # R3-2 — same-origin git CORS proxy (`app/git_proxy.py`,
    # `app/routers/git_proxy.py`, mounted at `/api/git-proxy`). Fixes
    # Settings → Git & Sync → Advanced: custom remote against a real
    # external host: isomorphic-git's browser transport is a bare
    # `fetch()`, and github.com/gitlab.com/etc. send no CORS headers on
    # their smart-HTTP endpoints, so the browser kills the request before
    # any status is even visible to JS. Passing this proxy as isomorphic-
    # git's own `corsProxy` option (`src/git/remote.ts`'s
    # `resolveGitCorsProxy`) makes the actual browser request same-origin;
    # this server does the cross-origin fetch itself instead.
    #
    # Comma-separated allowed upstream hosts. A request host must equal one
    # of these OR be an explicit subdomain (`foo.github.com` passes,
    # `notgithub.com` does not — see `git_proxy.is_allowed_host`).
    git_proxy_hosts: str = Field(
        default="github.com,gitlab.com,codeberg.org,bitbucket.org",
        validation_alias="VSNOTE_GIT_PROXY_HOSTS",
    )
    # SSRF guard: the target hostname is resolved and every returned address
    # checked against private/loopback/link-local/multicast/reserved/
    # unspecified ranges (`ipaddress` stdlib) — refused unless this is set.
    # Default False (refuse) is the binding posture
    # (`docs/ROADMAP-SHARING-AUTH.md`); this exists ONLY as a test/dev
    # escape hatch (`server/tests/test_git_proxy.py`'s happy-path test,
    # against a local fake git host, sets it True) — never enable this in a
    # deployment that shares a network with anything sensitive.
    git_proxy_allow_private_hosts: bool = Field(default=False, validation_alias="VSNOTE_GIT_PROXY_ALLOW_PRIVATE")
    # A sane cap on how much of either the request or the response body this
    # proxy will move before giving up — git packs can legitimately be
    # large, so this is generous (200 MiB), not `VSNOTE_MAX_BLOB_BYTES`-sized.
    git_proxy_max_body_bytes: int = Field(default=200 * 1024 * 1024, validation_alias="VSNOTE_GIT_PROXY_MAX_BODY_BYTES")


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

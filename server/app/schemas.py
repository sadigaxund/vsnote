"""Pydantic request/response models for the owner-side (/api) and public
(/share) HTTP contracts."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .runtime_settings import MAX_MAX_BLOB_BYTES, MIN_MAX_BLOB_BYTES

# --- Auth ------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


class WhoAmIOut(BaseModel):
    authenticated: bool
    username: Optional[str] = None
    email: Optional[str] = None
    is_admin: Optional[bool] = None
    source: Optional[str] = None  # "cf_access" | "session" | "bearer"


class AppConfigOut(BaseModel):
    """`GET /api/app-config` — public and unauthenticated, so it carries
    exactly three booleans and nothing else (no vault path, no repo name,
    no counts). See `routers/app_config.py` for why each one exists and
    how `login_required` is derived."""

    login_required: bool
    password_login: bool
    cf_access: bool


class TokenCreateIn(BaseModel):
    name: str
    # Grants (viewer/editor) use a Literal to reject "commenter" with a
    # clean 422 (roadmap: "commenter is later"). Token scope has no such
    # restriction — all three scopes are implemented this phase.
    scope: Literal["read", "write", "share-admin"]
    expires_at: Optional[float] = None


class TokenCreateOut(BaseModel):
    id: int
    name: str
    prefix: str
    scope: str
    token: str  # plaintext — returned exactly once, never again
    created_at: float
    expires_at: Optional[float] = None


class TokenOut(BaseModel):
    id: int
    name: str
    prefix: str
    scope: str
    created_at: float
    last_used_at: Optional[float] = None
    revoked_at: Optional[float] = None
    expires_at: Optional[float] = None


# --- Share tokens (§4.2 — per-share visitor credentials, NOT ApiToken) -----


class ShareTokenCreateIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=255)


class ShareTokenCreateOut(BaseModel):
    """Mint response — the ONLY time the plaintext token is ever returned.
    See `models.ShareToken`'s docstring."""

    id: int
    prefix: str
    label: Optional[str] = None
    token: str  # plaintext — never again
    created_at: float


class ShareTokenOut(BaseModel):
    """List response — never the secret, never even a hash."""

    id: int
    prefix: str
    label: Optional[str] = None
    created_at: float
    last_used_at: Optional[float] = None
    revoked_at: Optional[float] = None


# --- Blobs -------------------------------------------------------------


class BlobOut(BaseModel):
    id: str
    size: int
    media_type_hint: Optional[str] = None


# --- Shares (owner API) -----------------------------------------------


class GrantIn(BaseModel):
    principal: str
    # "commenter" is DB-modeled (models.GrantRole) but rejected here with a
    # 422 — it is explicitly "later" per docs/ROADMAP-SHARING-AUTH.md §1.
    role: Literal["viewer", "editor"]


class GrantOut(BaseModel):
    """Round 7 item 60 — grants are readable back on the owner API so the
    publish dialog can SHOW the people list instead of write-only adds."""

    principal: str
    role: str


class ShareCreateIn(BaseModel):
    source_path: str
    # §4.4 — folder shares removed entirely; every share pins exactly one
    # blob. `blob_id` is always required now (see routers/shares.py).
    blob_id: Optional[str] = None
    live: bool = False
    render_mode: Literal["raw", "rendered"] = "raw"
    general_access: Literal["restricted", "link"] = "restricted"
    auth_mode: Literal["none", "password", "token"] = "none"
    password: Optional[str] = Field(default=None, description="Plaintext; hashed server-side, never stored raw.")
    alias: Optional[str] = None
    expires_at: Optional[float] = None
    grants: List[GrantIn] = Field(default_factory=list)
    # Round 7 item 57 — the default role handed to "anyone with the link";
    # ignored (stored but never consulted) while general_access is
    # "restricted".
    link_role: Literal["viewer", "editor"] = "viewer"
    # §5 / DESIGN-SPEC round 10 items 66-67 — both off/unset by default. See
    # models.Share's docstring for the security posture on `show_title`.
    show_title: bool = False
    back_link: Optional[str] = None


class SharePatchIn(BaseModel):
    alias: Optional[str] = None
    expires_at: Optional[float] = None
    # Same sentinel problem as the password below: `expires_at: null` in the
    # JSON is indistinguishable from "field omitted" once parsed, so an
    # explicit flag is the only way to say "make this share never expire"
    # (round 6 item 5 made never-expires an explicit UI state).
    clear_expiry: bool = False
    # Round 6 item 8 — a moved/renamed vault file updates its share's
    # recorded path so tree indicators and Manage keep following it.
    source_path: Optional[str] = None
    # Explicit sentinel handling: omit the field to leave the password
    # unchanged; pass "" to clear it; pass a non-empty string to set it.
    password: Optional[str] = None
    clear_password: bool = False
    general_access: Optional[Literal["restricted", "link"]] = None
    auth_mode: Optional[Literal["none", "password", "token"]] = None
    render_mode: Optional[Literal["raw", "rendered"]] = None
    live: Optional[bool] = None
    # Round 7 item 57/60 — link-wide default role, and wholesale grant-list
    # replacement (None = leave grants untouched; [] = remove them all).
    link_role: Optional[Literal["viewer", "editor"]] = None
    grants: Optional[List[GrantIn]] = None
    # §5 / DESIGN-SPEC round 10 items 66-67. `back_link`: pass "" to clear
    # (same sentinel-free pattern as `link_role` — there's no ambiguous
    # "unset vs empty" distinction to worry about here since an empty
    # string is never a valid slug/alias anyway).
    show_title: Optional[bool] = None
    back_link: Optional[str] = None


class ShareOut(BaseModel):
    id: int
    slug: str
    alias: Optional[str] = None
    source_path: str
    blob_id: Optional[str] = None
    live: bool
    render_mode: str
    general_access: str
    auth_mode: str
    has_password: bool
    expires_at: Optional[float] = None
    revoked_at: Optional[float] = None
    created_at: float
    last_access_at: Optional[float] = None
    hit_count: int
    # Round 7 items 57/60.
    link_role: str = "viewer"
    grants: List[GrantOut] = Field(default_factory=list)
    # §5 / DESIGN-SPEC round 10 items 66-67.
    show_title: bool = False
    back_link: Optional[str] = None


# --- Public share endpoints ---------------------------------------------


class SharePasswordAuthIn(BaseModel):
    password: str


class ShareBackLinkOut(BaseModel):
    """One line of navigation — see `app/linkmap.py::resolve_back_link`'s
    docstring for the resolution and drop-silently-if-gone contract."""

    href: str
    label: str


class ReaderPrefs(BaseModel):
    """feat(share) — R4 owner-side "Reader appearance" settings
    (docs/ROADMAP-SHARING-AUTH.md): how ALL of this owner's Rendered-mode
    shares present to visitors, replacing the R3-5b per-visitor floating
    preferences pill. Every field a closed enum/bool (never a free string)
    so a stored value is always one this client — or any future one — knows
    how to render; pydantic rejects anything else as a 422 at the API
    boundary. Defaults here are the exact ones the removed pill used, so an
    owner who never opens the settings section gets byte-identical visitor
    behavior to before this change."""

    theme: Literal["system", "light", "dark"] = "system"
    font_size: Literal["s", "m", "l"] = "m"
    code_wrap: bool = True
    # "narrow" (~72ch, prose) / "wide" (~1100px, code/csv/json/html) / "full"
    # (fills the viewport, the sandboxed HTML iframe case). `None` means "no
    # explicit owner preference" — deliberately NOT defaulted to one of the
    # three literal values, so the client can still apply its own per-kind
    # default (code/csv/json shares default to "wide", markdown to "narrow")
    # exactly until the owner picks one explicitly, per this feature's own
    # spec ("code shares default to wide unless the owner picked
    # otherwise") — a non-optional default here could never express that
    # distinction.
    column_width: Optional[Literal["narrow", "wide", "full"]] = None


class ShareContentOut(BaseModel):
    """The JSON contract for rendered-mode shares — consumed by the Phase 10
    client. See server/README.md's "Rendered share contract" section."""

    slug: str
    # Round 6 items 11/12 — the CALLER's resolved role for this request
    # ("viewer" | "editor"), so the reader page knows whether to offer
    # editing. Purely informational: every write is re-gated server-side.
    role: Optional[str] = None
    alias: Optional[str] = None
    source_path: str
    render_mode: str
    media_type_hint: Optional[str] = None
    blob_id: str
    size: int
    live: bool
    content: str
    content_encoding: Literal["utf-8", "base64"] = "utf-8"
    created_at: float
    last_access_at: Optional[float] = None
    hit_count: int
    # §5 — dynamic link map (vault-relative link target, exactly as written
    # in the markdown -> the target share's URL path) and the resolved
    # back-link line. See `app/linkmap.py` for how both are computed with
    # zero filesystem access.
    links: Dict[str, str] = Field(default_factory=dict)
    back_link: Optional[ShareBackLinkOut] = None
    # feat(share) — the SHARE OWNER's reader-appearance settings (never the
    # visitor's — there is no visitor-side state anymore), included ONLY on
    # a successful content fetch, never on the shell/deny responses (the
    # uniform-404 posture is unchanged: `_error_response`/`policy.py` never
    # construct a `ShareContentOut` at all, so there's no field here to leak
    # on a deny).
    reader_prefs: ReaderPrefs = Field(default_factory=ReaderPrefs)


# --- Admin runtime settings (DESIGN-SPEC Amendments round 5, item 40) -----


class RuntimeSettingsOut(BaseModel):
    max_blob_bytes: int


class RuntimeSettingsIn(BaseModel):
    """`PUT /api/admin/settings` body. Bounds enforced HERE (pydantic
    `ge`/`le`, backed by the same constants `runtime_settings.py`'s
    enforcement sites use) so an out-of-range value is a plain 422
    validation error at the API boundary, never a crash and never silently
    clamped."""

    max_blob_bytes: int = Field(ge=MIN_MAX_BLOB_BYTES, le=MAX_MAX_BLOB_BYTES)


# --- Vault (Phase 17 Milestone A) ------------------------------------------


class VaultOut(BaseModel):
    """`GET /api/vault` and `POST /api/vault/init` response — mirrors
    `app.vault.VaultDescription` field for field. No secrets: `path` is a
    server-local filesystem path, fine to show an already-authenticated
    owner (same posture as every other `/api` response), never sent
    anywhere unauthenticated."""

    path: str
    mounted: bool
    initialized: bool
    bare: bool
    repo_name: str
    head_branch: Optional[str]
    has_commits: bool
    worktree_dirty: bool
    last_commit_message: Optional[str]
    last_commit_time: Optional[int]


class VaultInitIn(BaseModel):
    """`POST /api/vault/init` body. `branch` defaults to the client's own
    default branch name (`gitrepo.DEFAULT_CLIENT_BRANCH`) when omitted —
    see `routers/vault.py`."""

    branch: Optional[str] = None


# --- Vault remotes / mirroring (Phase 17 Milestone B) -----------------------


class VaultRemoteCreateIn(BaseModel):
    """`POST /api/vault/remotes` body. `ssh_private_key`/`https_token` are
    WRITE-ONLY: accepted here, stored server-side via `app/secrets_store.py`,
    and never returned by any response (see `VaultRemoteOut` below, which
    has no field for either)."""

    name: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1, max_length=2048)
    enabled: bool = True
    push_on_receive: bool = True
    credential_kind: Literal["none", "ssh_key", "https_token"] = "none"
    ssh_private_key: Optional[str] = None
    https_token: Optional[str] = None


class VaultRemotePatchIn(BaseModel):
    """`PATCH /api/vault/remotes/{id}` body. Same write-only credential
    contract as `VaultRemoteCreateIn`. `clear_credential` is the explicit
    sentinel that reverts to `credential_kind="none"` and deletes the
    on-disk secret file(s) — the same "omit means unchanged, explicit flag
    means clear" pattern `SharePatchIn.clear_password` already uses."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    enabled: Optional[bool] = None
    push_on_receive: Optional[bool] = None
    credential_kind: Optional[Literal["none", "ssh_key", "https_token"]] = None
    ssh_private_key: Optional[str] = None
    https_token: Optional[str] = None
    clear_credential: bool = False


class VaultRemoteOut(BaseModel):
    """No secret value is ever a field here — see
    `server/tests/test_vault_mirror.py::test_secrets_never_appear_in_any_
    remotes_response`, which greps the raw JSON of every route in
    `routers/vault_remotes.py` for the plaintext key/token."""

    id: int
    name: str
    url: str
    enabled: bool
    push_on_receive: bool
    credential_kind: Literal["none", "ssh_key", "https_token"]
    credential_fingerprint: Optional[str] = None
    credential_last4: Optional[str] = None
    last_mirror_at: Optional[float] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    created_at: float
    updated_at: float


class MirrorRunOut(BaseModel):
    """`POST /api/vault/remotes/{id}/mirror` response. `status` is one of
    "success" | "error" | "busy" | "skipped" — see `app/mirror.py`'s
    `MirrorOutcome`."""

    status: str
    message: str
    ts: float


class RemoteTestOut(BaseModel):
    """`POST /api/vault/remotes/{id}/test` response — mirrors the three (plus
    two) distinct outcomes `src/git/remote.ts::describeConnectionTest`
    already splits client-side for the in-app sync remote, applied here to
    an external mirror target instead."""

    outcome: Literal["reachable", "auth-rejected", "repo-missing", "unreachable", "error"]
    message: str

"""Pydantic request/response models for the owner-side (/api) and public
(/share) HTTP contracts."""

from __future__ import annotations

from typing import List, Literal, Optional

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


class ManifestEntryIn(BaseModel):
    """One INCLUDED file in a folder share's snapshot manifest (roadmap
    §5.1). `relpath` is vault-relative display text ONLY — never used for a
    filesystem lookup (see models.ShareManifestEntry's docstring); `blob_id`
    must already exist (client POSTs the blob to `/api/blobs` first, exactly
    like a file share)."""

    relpath: str
    blob_id: str


class ShareCreateIn(BaseModel):
    source_path: str
    kind: Literal["file", "folder"] = "file"
    # Required when kind=="file", ignored when kind=="folder" (folder
    # content lives entirely in `manifest` below).
    blob_id: Optional[str] = None
    # Required (non-empty) when kind=="folder", ignored when kind=="file".
    manifest: List[ManifestEntryIn] = Field(default_factory=list)
    live: bool = False
    render_mode: Literal["raw", "rendered"] = "raw"
    general_access: Literal["restricted", "link"] = "restricted"
    auth_mode: Literal["none", "password", "token"] = "none"
    password: Optional[str] = Field(default=None, description="Plaintext; hashed server-side, never stored raw.")
    alias: Optional[str] = None
    expires_at: Optional[float] = None
    grants: List[GrantIn] = Field(default_factory=list)


class ManifestUpdateIn(BaseModel):
    """`PUT /api/shares/{id}/manifest` — "Update share" for a folder share
    (roadmap §5.1: "Update share republishes the subtree to the SAME
    slug."). Wholesale-replaces the manifest; the slug/alias/policy are
    untouched."""

    manifest: List[ManifestEntryIn]


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


class ShareOut(BaseModel):
    id: int
    slug: str
    alias: Optional[str] = None
    source_path: str
    kind: Literal["file", "folder"] = "file"
    blob_id: Optional[str] = None
    # Folder shares only — number of INCLUDED files in the current manifest.
    # None for file shares.
    manifest_count: Optional[int] = None
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


# --- Public share endpoints ---------------------------------------------


class SharePasswordAuthIn(BaseModel):
    password: str


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


# --- Public folder-share endpoints (Phase 10.5, roadmap §5.1) --------------


class ShareListingEntryOut(BaseModel):
    """One row of a folder share's directory listing — either a file
    (resolved from a `ShareManifestEntry`) or a `dir` entry synthesized
    purely from the set of relpaths that share a prefix (no real directory
    row exists; see `routers/share_public.py::_listing_for_prefix`)."""

    name: str
    kind: Literal["file", "dir"]
    # relpath is the value the visitor's next request should target
    # (`GET /share/{id}/{relpath}`) — set for both files and dirs.
    relpath: str
    size: Optional[int] = None
    media_type_hint: Optional[str] = None


class ShareListingOut(BaseModel):
    """`GET /share/{id}` (folder root) or `GET /share/{id}/{relpath}` when
    `relpath` names a directory prefix rather than a file — a plain listing,
    never an inlined-into-HTML render (roadmap §5.1: "no README special-
    casing", "must not inline user content into HTML server-side")."""

    slug: str
    # Same as ShareContentOut.role — the caller's resolved role.
    role: Optional[str] = None
    alias: Optional[str] = None
    kind: Literal["folder"] = "folder"
    prefix: str
    entries: List[ShareListingEntryOut]
    created_at: float
    last_access_at: Optional[float] = None
    hit_count: int


class ManifestEntryOut(BaseModel):
    relpath: str
    blob_id: str
    size: int
    media_type_hint: Optional[str] = None


class ShareManifestOut(BaseModel):
    """`GET /api/shares/{id}/manifest` — owner-only, used by the Publish
    dialog's "Edit policy…" flow on a folder share to prefill the checkbox
    tree's excluded state (an entry NOT in this list is excluded)."""

    entries: List[ManifestEntryOut]


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

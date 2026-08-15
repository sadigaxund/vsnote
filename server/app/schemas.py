"""Pydantic request/response models for the owner-side (/api) and public
(/share) HTTP contracts."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

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


class ShareCreateIn(BaseModel):
    source_path: str
    blob_id: str
    live: bool = False
    render_mode: Literal["raw", "rendered"] = "raw"
    general_access: Literal["restricted", "link"] = "restricted"
    auth_mode: Literal["none", "password", "token"] = "none"
    password: Optional[str] = Field(default=None, description="Plaintext; hashed server-side, never stored raw.")
    alias: Optional[str] = None
    expires_at: Optional[float] = None
    grants: List[GrantIn] = Field(default_factory=list)


class SharePatchIn(BaseModel):
    alias: Optional[str] = None
    expires_at: Optional[float] = None
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
    blob_id: str
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

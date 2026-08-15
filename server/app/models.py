"""SQLAlchemy ORM models. SQLite via `Base.metadata.create_all` (no
Alembic this phase — see ARCHITECTURE.md's "Backend (v2)" section).
"""

from __future__ import annotations

import enum
import time
from typing import Optional

from sqlalchemy import Boolean, Enum as SAEnum, Float, ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class TokenScope(str, enum.Enum):
    read = "read"
    write = "write"
    share_admin = "share-admin"


class RenderMode(str, enum.Enum):
    raw = "raw"
    rendered = "rendered"


class ShareKind(str, enum.Enum):
    """Phase 10.5 (roadmap §5.1). `file` is the original Phase 9/10 shape
    (one share = one pinned blob at `Share.blob_id`). `folder` shares pin a
    whole subtree snapshot instead: `Share.blob_id` is NULL and the content
    lives in `ShareManifestEntry` rows (one per INCLUDED file, keyed by
    `(share_id, relpath)`). See that model's docstring for why manifest
    lookup is the entire security boundary for folder shares."""

    file = "file"
    folder = "folder"


class GeneralAccess(str, enum.Enum):
    restricted = "restricted"
    link = "link"


class AuthMode(str, enum.Enum):
    none = "none"
    password = "password"
    token = "token"


class GrantRole(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"
    # "Commenter is 'later' per roadmap": the DB enum carries the value so
    # the column type never needs a migration when it lands, but
    # schemas.py's request models use a Literal["viewer","editor"] that
    # rejects it with 422 at the API boundary — see routers/shares.py.
    commenter = "commenter"


def _enum_col(enum_cls):
    return SAEnum(enum_cls, native_enum=False, values_callable=lambda e: [m.value for m in e])


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # Nullable: SSO-only (Cf-Access) users never get a local password.
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    # SHA-256 hex of the plaintext secret. The plaintext itself is NEVER
    # stored anywhere — see security.hash_token / security.generate_api_token.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(16), index=True)
    scope: Mapped[TokenScope] = mapped_column(_enum_col(TokenScope))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_used_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    revoked_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    expires_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class Blob(Base):
    """Content-addressed snapshot. The server is vault-agnostic (roadmap §3
    option a): clients POST the exact bytes to /api/blobs at publish time;
    the server never reads a vault path directly."""

    __tablename__ = "blobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 hex of `content`
    content: Mapped[bytes] = mapped_column(LargeBinary)
    size: Mapped[int] = mapped_column(Integer)
    # The client's declared logical filetype (e.g. "markdown"/"typescript").
    # Purely informational — NEVER used to pick a response Content-Type for
    # raw mode (share_public.py's RAW_CONTENT_TYPE is a hardcoded constant).
    media_type_hint: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    alias: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Display only (e.g. "notes/architecture.md") — NEVER used for any
    # filesystem lookup. The server only ever serves the pinned `blob_id`
    # snapshot; there is no code path anywhere that opens a file by this
    # string. Keep it that way — see policy.py's module docstring.
    source_path: Mapped[str] = mapped_column(String(1024))
    kind: Mapped[ShareKind] = mapped_column(_enum_col(ShareKind), default=ShareKind.file)
    # NULL for kind=="folder" — a folder share has no single "the" blob, its
    # content lives entirely in ShareManifestEntry rows. Every read path
    # branches on `share.kind` BEFORE ever touching `blob_id` (see
    # routers/share_public.py) so this is never dereferenced null for a
    # folder share.
    blob_id: Mapped[Optional[str]] = mapped_column(ForeignKey("blobs.id"), nullable=True)
    live: Mapped[bool] = mapped_column(Boolean, default=False)
    render_mode: Mapped[RenderMode] = mapped_column(_enum_col(RenderMode))
    general_access: Mapped[GeneralAccess] = mapped_column(_enum_col(GeneralAccess))
    auth_mode: Mapped[AuthMode] = mapped_column(_enum_col(AuthMode))
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    revoked_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_access_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)


class ShareManifestEntry(Base):
    """A single INCLUDED file inside a `kind=="folder"` Share's pinned
    snapshot. `relpath` is the vault-relative path exactly as it appeared
    under the published subtree root (e.g. `"notes/queue.md"`) — display
    AND the entire lookup key, never a filesystem path. `(share_id,
    relpath)` is unique, and this table is the ONLY place a folder share's
    content is resolved from: `routers/share_public.py`'s manifest
    resolution does one exact-match query, `WHERE share_id = ? AND relpath
    = ?`, against these rows — no normalization, no `os.path`/`pathlib`
    join, no filesystem access. An excluded file (the owner unchecked it in
    the publish dialog's checkbox tree) simply never gets a row here; a
    request for its relpath is therefore indistinguishable, at the DB
    layer, from a request for a relpath that never existed at all, `..`
    traversal, an absolute path, or a relpath that belongs to a DIFFERENT
    share's manifest (excluded by the `share_id` half of the WHERE clause)
    — every one of those is just "no row matched", which resolves to the
    exact same uniform 404 as every other policy-gate deny (see policy.py's
    module docstring; ARCHITECTURE.md's "Folder shares" section walks
    through why this makes traversal structurally impossible rather than
    merely sanitized-against).
    """

    __tablename__ = "share_manifest_entries"
    __table_args__ = (UniqueConstraint("share_id", "relpath", name="uq_share_manifest_relpath"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    share_id: Mapped[int] = mapped_column(ForeignKey("shares.id"), index=True)
    relpath: Mapped[str] = mapped_column(String(1024), index=True)
    blob_id: Mapped[str] = mapped_column(ForeignKey("blobs.id"))
    size: Mapped[int] = mapped_column(Integer)
    media_type_hint: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class ShareGrant(Base):
    """Per-principal role for a share. `principal` is an email or username
    string, matched against the identity resolved by auth.py (never trusted
    from an unverified client-supplied header)."""

    __tablename__ = "share_grants"
    __table_args__ = (UniqueConstraint("share_id", "principal", name="uq_share_principal"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    share_id: Mapped[int] = mapped_column(ForeignKey("shares.id"), index=True)
    principal: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[GrantRole] = mapped_column(_enum_col(GrantRole))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[float] = mapped_column(Float, default=time.time, index=True)
    event: Mapped[str] = mapped_column(String(64), index=True)
    slug: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    principal: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # INTERNAL deny reason only. This string must NEVER be echoed back into
    # any client-facing response body — audit.py / policy.py enforce this by
    # construction (the client responses use fixed constant bodies that
    # never interpolate `reason`).
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

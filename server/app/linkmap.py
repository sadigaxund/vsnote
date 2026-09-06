"""§5 (docs/PLAN-2026-09-05-refresh.md) — the dynamic link map that makes a
"blog" out of nothing but ordinary shares. A relative markdown link
(`[next](./part-2.md)`) means nothing on its own at `/share/<slug>`; this
module resolves such links, at content-fetch time, against the OWNER's
OTHER active shares, using ONLY rows the database already has.

--- Why this is safe: the no-filesystem argument -----------------------

`compute_link_map` and `resolve_back_link` below NEVER touch a filesystem,
in any form — no `open()`, no `os.path.exists`, no `Path.resolve()`, no
`os.path.realpath()`, nothing that could stat or read a real path. Every
input is either the markdown TEXT already loaded into memory (the blob the
caller already fetched to serve the response) or `Share.source_path`
strings already sitting in the `shares` table. All path arithmetic here is
PURE STRING MANIPULATION — `_normalize_vault_path` below reimplements the
lexical part of `posixpath.normpath` by hand (split on "/", drop "." and
resolve ".." segments against the stack) specifically so this file has no
dependency, even an incidental one, on any stdlib path function that ever
touches disk. `Share.source_path` is display-only and untrusted-as-a-path
by design (see models.Share's docstring) — this module is the reason that
constraint is safe to keep: matching it is just comparing two strings, so
there is structurally no path a crafted `source_path` or a crafted markdown
link could take to make this code open a file, follow a symlink, or read
anything outside the `shares` table.

--- Visibility decision: restricted/password shares in a public link map --

A rendered share's link map includes matches from ANY of the owner's other
non-revoked, non-expired, `render_mode="rendered"` shares — including ones
with `auth_mode` password/token or `general_access="restricted"` sign-in.
Decision: INCLUDE them. Reasoning:

1. The link is a capability URL, not a bypass. Every `/share/<slug>` still
   goes through the exact same `policy.resolve_share` gate on click — a
   password/restricted target keeps demanding its own password/identity no
   matter how the visitor arrived at its URL. Nothing about being reachable
   FROM a link map weakens that target's own policy by one bit.
2. The alternative (excluding them) actively breaks the feature the roadmap
   asks for: an owner's blog index (public) linking to a members-only post
   (restricted) would silently drop that link with no diagnostic, which is
   worse than "the link exists but demands a password" — the owner would
   have no way to discover why a link went missing short of reading this
   module's source.
3. What excluding them would NOT buy back: the mere existence of a
   password/restricted share at some vault-relative path is not the kind
   of secret the policy gate protects (the gate's uniform-404 argument, see
   policy.py's module docstring, is about not leaking whether a GUESSED
   slug is real — it says nothing about an owner's own already-public
   sibling share revealing that ANOTHER of the owner's files is ALSO
   shared). A visitor who already holds a real, working public link chosen
   by the owner to point at that other file is exactly the audience the
   owner intended to reach; the fact that the target needs its own
   credential is the target's own business.

What this DOES cost: a public share's link map can reveal that some
vault-relative path is shared at all (not its content, not its policy
details beyond "exists and needs a credential"). That is a real, small
disclosure, and it is the one traded away here — recorded explicitly per
the task brief, and mirrored in docs/ARCHITECTURE.md's sharing section.

--- What is NOT covered -------------------------------------------------

Revoked/expired targets are simply absent from the map (no "not shared"
placeholder needed — the whole map is opt-in-per-file already). No
republish is needed for a link to start OR stop working: this is computed
fresh on every content fetch, straight off the current DB rows.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from . import models
from .policy import is_expired, lookup_share

# --- Pure lexical path normalization (see module docstring) ----------------


def _normalize_vault_path(path: str) -> str:
    """Collapse "." and ".." segments and duplicate/backslash separators in
    a vault-relative path STRING. Pure string manipulation — see the module
    docstring's no-filesystem argument. A leading ".." that would go above
    the top of a relative path is simply kept as a literal ".." segment
    (there is no root to escape into here — this never becomes a real
    filesystem path, so "escaping" only means "the resulting string won't
    match any real `source_path`", which is exactly the safe outcome for
    both `../../../etc/passwd`-shaped input and absolute-path input, see
    `_resolve_markdown_link` below for how the latter is handled)."""
    normalized = path.replace("\\", "/")
    parts = normalized.split("/")
    stack: List[str] = []
    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            if stack and stack[-1] != "..":
                stack.pop()
            else:
                stack.append("..")
            continue
        stack.append(part)
    return "/".join(stack)


def _dirname(vault_path: str) -> str:
    normalized = _normalize_vault_path(vault_path)
    if "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


# --- Markdown link extraction ------------------------------------------

# Matches both `[text](target)` and `![alt](target)` — an image reference
# to another shared file is just as "linked" as a text link for this
# purpose. Deliberately simple (no full CommonMark parser): title-attribute
# forms (`[text](target "title")`) are not unwrapped, which just means such
# a link's raw target string (title text included) won't match a
# `source_path` and is silently omitted from the map — no crash, no wrong
# match, only a link that stays unresolved.
_MD_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")

_SKIP_PREFIXES = ("http://", "https://", "//", "mailto:", "data:", "#")


def extract_link_targets(markdown: str) -> List[str]:
    """Every `(...)` link target in `markdown`, as WRITTEN (whitespace
    trimmed only), minus obviously-external/non-path forms. Duplicates are
    preserved-but-harmless: callers build a dict keyed by this exact
    string, so a repeated link just gets computed twice."""
    targets = []
    for match in _MD_LINK_RE.finditer(markdown):
        target = match.group(1).strip()
        if not target or target.startswith(_SKIP_PREFIXES):
            continue
        targets.append(target)
    return targets


def _resolve_markdown_link(source_dir: str, target: str) -> Optional[str]:
    """Resolve a written link `target` (e.g. `./part-2.md`, `x.md`,
    `../sibling/y.md`) relative to `source_dir` (the current share's
    `source_path` directory) into a normalized vault-relative path, or
    `None` if the target can't be meaningfully resolved as one (an
    absolute-path-looking target, or a bare fragment/query with no path).

    Absolute-path-looking input (a leading "/") is deliberately treated as
    UNRESOLVABLE rather than reinterpreted as "relative to the vault
    root" — the roadmap's "must never escape into absolute paths" is
    honored by simply refusing to guess what an absolute path means here,
    not by attempting some other resolution of it. Since this function
    never touches a filesystem either way, "escape" can only ever mean
    "produce a string that happens to match some `source_path` it
    shouldn't" — returning `None` here means an absolute-looking link can
    never enter the matching step at all."""
    target = target.split("#", 1)[0].split("?", 1)[0]
    if not target:
        return None
    if target.startswith("/"):
        return None
    joined = f"{source_dir}/{target}" if source_dir else target
    return _normalize_vault_path(joined)


def _url_path_for(share: "models.Share") -> str:
    return f"/share/{share.alias or share.slug}"


def _active_rendered_shares_by_owner(db: Session, *, owner_id: int, exclude_share_id: int) -> List["models.Share"]:
    """Same-owner, not-revoked, not-expired, `render_mode="rendered"` shares
    other than the one being served. See the module docstring's visibility
    decision for why password/token/restricted shares are NOT filtered out
    here."""
    now = time.time()
    rows = (
        db.query(models.Share)
        .filter(
            models.Share.owner_id == owner_id,
            models.Share.id != exclude_share_id,
            models.Share.revoked_at.is_(None),
            models.Share.render_mode == models.RenderMode.rendered,
        )
        .all()
    )
    return [r for r in rows if not is_expired(r.expires_at, now)]


def compute_link_map(db: Session, share: "models.Share", markdown: str) -> Dict[str, str]:
    """The `links` field of `ShareContentOut` — see module docstring for the
    full security/visibility argument. Keyed by the link target EXACTLY as
    written in the markdown (so the client can do a literal string
    rewrite), valued by the resolved target share's URL path."""
    targets = extract_link_targets(markdown)
    if not targets:
        return {}

    candidates = _active_rendered_shares_by_owner(db, owner_id=share.owner_id, exclude_share_id=share.id)
    by_path: Dict[str, "models.Share"] = {}
    for candidate in candidates:
        by_path[_normalize_vault_path(candidate.source_path)] = candidate

    source_dir = _dirname(share.source_path)
    links: Dict[str, str] = {}
    for target in targets:
        resolved = _resolve_markdown_link(source_dir, target)
        if resolved is None:
            continue
        match = by_path.get(resolved)
        if match is None:
            continue
        links[target] = _url_path_for(match)
    return links


# --- back_link resolution ------------------------------------------------


@dataclass
class ResolvedBackLink:
    href: str
    label: str


_H1_RE = re.compile(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", re.MULTILINE)


def title_for(share: "models.Share", markdown: Optional[str]) -> str:
    """First H1 of the markdown, falling back to the basename of
    `source_path` — same rule `share_public.py`'s `show_title` meta
    injection uses (see that module's docstring), reused here so a back
    link's label matches what the target page would show as its own
    title."""
    if markdown:
        m = _H1_RE.search(markdown)
        if m:
            return m.group(1).strip()
    basename = share.source_path.replace("\\", "/").rsplit("/", 1)[-1]
    return basename or share.slug


def resolve_back_link(db: Session, share: "models.Share") -> Optional[ResolvedBackLink]:
    """`Share.back_link` is a slug-or-alias string (same identifier
    namespace `policy.lookup_share` matches against everywhere else) — NOT
    a foreign key, because the target can be renamed, revoked, or deleted
    out from under this share at any time and that must degrade silently
    (omit the back link) rather than ever error or dangle. Returns `None`
    when `back_link` is unset, the target doesn't exist, or the target is
    revoked/expired — a stale-pointing back link simply stops rendering,
    no republish of THIS share required, mirroring the link map's own
    immediate-effect semantics."""
    if not share.back_link:
        return None

    target = lookup_share(db, share.back_link)
    if target is None or target.revoked_at is not None:
        return None
    if is_expired(target.expires_at):
        return None

    blob = db.get(models.Blob, target.blob_id)
    markdown: Optional[str] = None
    if blob is not None:
        try:
            markdown = blob.content.decode("utf-8")
        except UnicodeDecodeError:
            markdown = None

    return ResolvedBackLink(href=_url_path_for(target), label=title_for(target, markdown))

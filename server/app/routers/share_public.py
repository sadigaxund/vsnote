"""`/share/*` — the public capability endpoints, OUTSIDE any SSO/app-auth
gate. Mounted directly on the ROOT app (main.py), never on the CORS-enabled
`/api` sub-app, so these responses carry zero CORS headers (roadmap §1).

Every request here (except the two structural exceptions noted below) is
resolved through policy.resolve_share() — see policy.py's module docstring
for the full deny-by-default order and why EVERY deny reason (missing,
revoked, expired, restricted, token-required, password-required, wrong
role) now collapses to the exact same 404 — there is no second ("password
challenge") response shape anywhere in this file.

Structural exceptions, both deliberate and both documented at their call
site: (1) `POST /share/{id}/auth` does NOT call resolve_share — it already
had its own always-correct symmetric 404 (wrong password and nonexistent
slug indistinguishable) before resolve_share's own uniform-404 fix, and
still implements that check directly rather than through resolve_share. (2)
the `{identifier}` path parameter is typed as a bare `str`, not a FastAPI
`Path(pattern=...)` — a regex-constrained path param that failed to match
would produce FastAPI's own 422 automatically, and the roadmap is explicit
that a malformed identifier must take the *identical 404 path* as a missing
one, never a 422. Format validation therefore happens exactly once, inside
policy.resolve_share (or, for the auth endpoint, via the same
`security.validate_slug_format` call used there) — never via a declarative
path constraint.

Contract for Phase 10 (client sharing UI): see server/README.md's "Public
share contract" section for the full request/response shapes documented for
the client team.

--- Phase 10.5a: single-origin SPA serving, roadmap §5.4 --------------------

A real browser navigation (`Accept: text/html`) to `GET /share/{id}` gets
the built SPA's `index.html` instead of this route's raw/JSON response —
for EVERY outcome: a successful rendered-mode file share, AND every deny
reason (bogus slug, revoked, expired, restricted, password-required-with-
no-session — see `_deny_response`'s doc for why widening this to cover
denials too, rather than keeping denials JSON-only, is what makes
password-protected/private links actually usable through a cold browser
navigation, and why it makes the navigation-level oracle STRICTLY narrower,
not wider). The ONE exception, non-negotiable: a successful RAW-mode file
share always returns raw bytes unconditionally, browser or not, per
roadmap §1's "a raw share must never execute" — `_wants_html` is checked
there but the branch is gated on `render_mode == "raw"` failing, not on
`Accept`. A non-browser caller that never sends `Accept: text/html` (no
header, `Accept: application/json`, curl's plain `*/*`) is completely
unaffected either way — same raw/JSON responses as before this phase,
including the byte-identical uniform 404 for every deny reason.

--- §4.4: folder shares removed (2026-09-05) --------------------------------

This module used to also serve `kind=="folder"` shares — a whole subtree
snapshot resolved by exact-match manifest lookup, with its own listing/
directory routes and a public editor write-back for files inside the tree.
That entire feature was removed 2026-09-05 (docs/PLAN-2026-09-05-refresh.md
§4.4; see docs/ARCHITECTURE.md's superseded "Folder shares (Phase 10.5)"
section for the full history and docs/ROADMAP-SHARING-AUTH.md §5.1's
SUPERSEDED marker). Every share is a single pinned blob again — there is no
`{relpath:path}` route on `/share/{identifier}` anymore, and a request
shaped like one (`/share/<slug>/anything`) simply doesn't match any route
this module registers, which FastAPI 404s on its own terms (still never
distinguishable from a policy-gate deny at the JSON layer — see
`tests/test_folder_shares_removed.py`). There is deliberately no migration
for databases that predate the removal.

--- §4.1: raw = bytes -------------------------------------------------------

A raw share's Content-Type is decided by SNIFFING THE BLOB, never by
`Blob.media_type_hint` (client-declared, untrusted — see that field's
docstring) and never by deriving anything from the file's extension alone.
The allowed output set is EXACTLY two values: `text/plain; charset=utf-8`
for content that decodes as UTF-8 with no embedded NUL, and
`application/octet-stream` for anything else. No other Content-Type is ever
emitted here, in particular never `text/html` or any other ACTIVE type —
see `_raw_content_type` below and `tests/test_raw_mode.py`.
"""

from __future__ import annotations

import base64
import hashlib
import html as html_escape
import re
import time
from pathlib import Path
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from sqlalchemy.orm import Session

from .. import models, policy, schemas, security
from ..audit import write_audit_event
from ..auth import AuthDeps
from ..config import Settings
from ..linkmap import compute_link_map, resolve_back_link, title_for
from ..runtime_settings import get_max_blob_bytes
from ..vaultcommit import commit_share_edit

# --- §4.1: raw content-type sniffing ----------------------------------------
#
# The allowed output set for a raw response's Content-Type is EXACTLY these
# two values — nothing else is ever passed to Response() on this path. Text
# stays text/plain (browsers/curl/scripts can read it inline); anything that
# looks binary gets application/octet-stream so a browser downloads it
# instead of trying to render it. `media_type_hint` is NEVER consulted here
# (see models.Blob's docstring) — the extension of `source_path` is checked
# only as a SECONDARY signal that can push an ambiguous sniff toward
# "binary", never toward "text", and never toward any THIRD value.
RAW_TEXT_CONTENT_TYPE = "text/plain; charset=utf-8"
RAW_BINARY_CONTENT_TYPE = "application/octet-stream"

_SNIFF_WINDOW_BYTES = 8192

# Extensions that are unambiguously binary formats even when their bytes
# happen to be valid UTF-8 by coincidence (rare, but not impossible for
# small/degenerate files) — a secondary signal only, see the module
# docstring above.
_BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif",
    ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".mov", ".webm", ".wav", ".ogg",
    ".exe", ".dll", ".so", ".bin", ".wasm",
}


def _raw_content_type(content: bytes, source_path: str) -> str:
    """Sniff `content` to decide the raw response's Content-Type. A NUL
    byte in the first `_SNIFF_WINDOW_BYTES` bytes, or a failed strict
    UTF-8 decode of the whole blob, means binary; a known binary extension
    on `source_path` forces binary even for a sniff that came back clean
    (defense in depth against a coincidentally-valid-UTF-8 binary file) —
    but nothing here can ever push the result the OTHER way, toward text or
    toward any value outside the two-member allowed set above."""
    if b"\x00" in content[:_SNIFF_WINDOW_BYTES]:
        return RAW_BINARY_CONTENT_TYPE
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        return RAW_BINARY_CONTENT_TYPE
    ext = Path(source_path).suffix.lower()
    if ext in _BINARY_EXTENSIONS:
        return RAW_BINARY_CONTENT_TYPE
    return RAW_TEXT_CONTENT_TYPE


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")


def _sanitize_filename(source_path: str, fallback: str) -> str:
    """The basename of `source_path`, with control characters, quotes, and
    any path separator stripped — it must never contain a slash (that's
    what makes it safe to drop straight into a `Content-Disposition`
    header's quoted-string). Falls back to `fallback` (the share's slug)
    when the result sanitizes to empty (e.g. `source_path` was itself just
    `"/"` or entirely control characters)."""
    basename = source_path.replace("\\", "/").rsplit("/", 1)[-1]
    basename = _CONTROL_CHARS_RE.sub("", basename).replace('"', "").strip()
    basename = basename.replace("/", "")
    return basename or fallback


def _content_disposition(source_path: str, slug: str, *, download: bool) -> str:
    """RFC 6266 `Content-Disposition` value — `inline` by default,
    `attachment` when `?download=1` is present (see `_wants_download`).
    The filename is quoted with backslash/quote escaped per the RFC, on top
    of `_sanitize_filename`'s own stripping."""
    filename = _sanitize_filename(source_path, slug)
    escaped = filename.replace("\\", "\\\\").replace('"', '\\"')
    disposition = "attachment" if download else "inline"
    return f'{disposition}; filename="{escaped}"'


RAW_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}

JSON_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
}


def _raw_response(share: "models.Share", blob: "models.Blob", *, download: bool) -> Response:
    content_type = _raw_content_type(blob.content, share.source_path)
    headers = dict(RAW_SECURITY_HEADERS)
    headers["Content-Disposition"] = _content_disposition(share.source_path, share.slug, download=download)
    return Response(content=blob.content, media_type=content_type, headers=headers)


def _wants_json(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "application/json" in accept


def _wants_html(request: Request) -> bool:
    """A real browser navigation (`Accept: text/html,...`) — the signal
    `_spa_shell_response` below uses to decide whether to hand back the
    built SPA's `index.html` instead of this route's normal raw/JSON
    response. Deliberately NOT "absence of `application/json`": a plain
    curl/script with no `Accept` header at all must keep getting the
    documented default (raw bytes — see `server/README.md`'s "Public share
    contract") exactly as before this phase. Only an explicit `text/html`
    preference is treated as "this is a page load, hand back the app
    shell.\""""
    accept = request.headers.get("accept", "")
    return "text/html" in accept


def _wants_download(request: Request) -> bool:
    return request.query_params.get("download") == "1"


def _inject_meta_title(html: bytes, title: str) -> bytes:
    """Splice an escaped `<title>` + a couple of OG tags in right before
    `</head>` (case-insensitive search, case-preserving splice). `title` is
    ATTACKER-INFLUENCED (it comes from the share's own markdown content, see
    `_shell_meta_title_for` below) so it is HTML-escaped here, unconditionally,
    before it ever touches the response body. If no `</head>` is found (a
    malformed or unexpected shell), the shell is returned byte-for-byte
    unchanged rather than guessing where else to splice — never crash, never
    silently corrupt the shell."""
    idx = html.lower().find(b"</head>")
    if idx == -1:
        return html
    escaped = html_escape.escape(title, quote=True)
    tags = (
        f"<title>{escaped}</title>"
        f'<meta property="og:title" content="{escaped}">'
        f'<meta property="og:type" content="article">'
    ).encode("utf-8")
    return html[:idx] + tags + html[idx:]


def _spa_shell_response(request: Request, *, meta_title: Optional[str] = None) -> Optional[Response]:
    """Single-origin refactor (Phase 10.5a, roadmap §5.4): FastAPI is now
    also the SPA's own web server (`main.py`'s `app.state.spa_index_html`),
    so a real browser navigating to `/share/<slug>` needs to land on the
    app shell (which then re-fetches this exact same content via
    `share/ShareApp.tsx`'s own `Accept: application/json` request), not the
    raw bytes / JSON this route serves to non-browser callers.

    Called from BOTH the success path (`get_share`, for a rendered-mode
    file share) AND the deny path (`_deny_response` below, for EVERY deny
    reason — bogus slug, revoked, expired, password-required-with-no-
    session, wrong role). Content-independent: the exact same
    `app.state.spa_index_html` bytes are returned in every case, with no
    slug/policy/error detail ever baked into it — see `_deny_response`'s
    doc for why serving this UNCONDITIONALLY for `Accept: text/html` is
    what actually closes the existence oracle for navigation, rather than
    reopening one.

    `meta_title` is the ONE exception to "content-independent", and it is
    deliberately an opt-in keyword only the SUCCESS path in `get_share` ever
    passes (see that call site's `_shell_meta_title_for` guard for the exact
    three-condition rule — show_title on, auth_mode none, access already
    resolved). `_deny_response` NEVER passes it, on purpose: a deny means
    access did NOT resolve, so there is no share to safely name here even if
    its `show_title`/`auth_mode` happened to qualify — passing `meta_title`
    on any deny path would reopen exactly the existence oracle this function
    exists to keep closed. When `meta_title` is `None` (the default, and the
    only value the deny path ever uses), the returned bytes are BYTE-
    IDENTICAL to before this parameter existed.

    Returns `None` (never raises) when the SPA hasn't been built yet
    (`app.state.spa_index_html` unset — `main.py` logs this at startup) so
    every caller falls back to its normal raw/JSON response instead of
    crashing — the API stays fully usable with no `dist/` present."""
    html = getattr(request.app.state, "spa_index_html", None)
    if html is None:
        # Production: read the CURRENT dist/index.html per request (a rebuild
        # goes live without a backend restart). Tests inject bytes via the
        # state attribute, which still wins when present.
        path = getattr(request.app.state, "spa_index_path", None)
        if path is None:
            return None
        html = Path(path).read_bytes()
    if meta_title is not None:
        html = _inject_meta_title(html, meta_title)
    return Response(content=html, media_type="text/html; charset=utf-8", headers={"X-Content-Type-Options": "nosniff"})


def _shell_meta_title_for(share: "models.Share", blob: "models.Blob") -> str:
    """The title text for `_inject_meta_title` — first H1 of the share's
    markdown, falling back to the basename of `source_path` (same rule
    `app/linkmap.py::title_for` uses for a back link's label, reused here
    verbatim). Escaping happens in `_inject_meta_title`, not here — this
    returns plain text only."""
    try:
        markdown = blob.content.decode("utf-8")
    except UnicodeDecodeError:
        markdown = None
    return title_for(share, markdown)


def _deny_response(request: Request, exc: "Optional[policy.PolicyDenied]") -> Response:
    """The single place every deny reason on `GET /share/{id}` becomes an
    HTTP response (bogus/malformed slug, revoked, expired,
    restricted-no-identity, wrong role, password-required-with-no-session
    — literally every branch that used to call
    `policy.denial_response(exc)`/`policy.not_found_response()` directly).
    Two possible outcomes, chosen ONLY by `Accept`, never by the deny
    reason itself:

    - A real browser navigation (`_wants_html`, and NOT also asking for
      JSON) gets the SPA shell — UNCONDITIONALLY, the identical bytes for
      every single deny reason, exactly the same bytes a SUCCESSFUL
      rendered-mode share's navigation gets too (`_spa_shell_response`
      above). This is a deliberate widening from this phase's original,
      more conservative design (deny always JSON, no exceptions) — caught
      in review: that design made password-protected/revoked/expired/
      bogus links literally unusable in the single-origin deployment,
      since a cold browser navigation could never reach the SPA's own
      password-prompt UI at all (`ShareApp.tsx`'s "unavailable, or it
      requires a password" state — see that file's doc — never gets a
      chance to mount). Serving the shell here instead makes navigation
      STRICTLY MORE private, not less: previously a plain
      `curl -H 'Accept: text/html'` could distinguish "real, accessible,
      rendered share" (200 HTML) from "anything denied" (404 JSON) from
      "real raw-mode share" (200 raw bytes) — three classes. Now every
      deny reason AND every rendered success collapse into ONE identical
      200-HTML class; only a successful RAW-mode share still stands apart
      (200 raw bytes — see `get_share`'s own doc for why that one case is
      excluded, non-negotiably, on its own terms).
    - Every other request (no `Accept` at all — the documented default —
      or an explicit `Accept: application/json`) gets the byte-identical
      JSON `404 {"detail":"Not found"}`, UNCHANGED from before this
      widening: `tests/test_policy_gate.py`'s equivalence-matrix tests
      (httpx's default carries no `Accept` header at all) exercise exactly
      this branch and are completely unaffected by the change above.
    """
    if _wants_html(request) and not _wants_json(request):
        shell = _spa_shell_response(request)
        if shell is not None:
            return shell
    if exc is None:
        return policy.not_found_response()
    return policy.denial_response(exc)


def _share_session_cookie_name(slug_or_alias: str) -> str:
    return f"vsnote_share_{slug_or_alias}"


def _extract_bearer(request: Request) -> Optional[str]:
    authz = request.headers.get("authorization")
    if authz and authz.lower().startswith("bearer "):
        return authz[7:].strip()
    return None


def _decode_content(blob: "models.Blob") -> Tuple[str, str]:
    try:
        return blob.content.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return base64.b64encode(blob.content).decode("ascii"), "base64"


def _content_payload(db: Session, share: "models.Share", blob: "models.Blob", role: Optional[str] = None) -> dict:
    content, encoding = _decode_content(blob)
    # §5 — the link map and back link are computed fresh on every fetch,
    # straight off the current DB rows (see app/linkmap.py's module
    # docstring): no republish needed for a sibling share to start/stop
    # resolving, and both are harmless no-ops for a raw share or plain text
    # (a link map over content with no markdown-link syntax is just {}).
    links = compute_link_map(db, share, content) if encoding == "utf-8" else {}
    resolved_back = resolve_back_link(db, share)
    out = schemas.ShareContentOut(
        slug=share.slug,
        role=role,
        alias=share.alias,
        source_path=share.source_path,
        render_mode=share.render_mode.value,
        media_type_hint=blob.media_type_hint,
        blob_id=blob.id,
        size=blob.size,
        live=share.live,
        content=content,
        content_encoding=encoding,  # type: ignore[arg-type]
        created_at=share.created_at,
        last_access_at=share.last_access_at,
        hit_count=share.hit_count,
        links=links,
        back_link=schemas.ShareBackLinkOut(href=resolved_back.href, label=resolved_back.label)
        if resolved_back
        else None,
    )
    return out.model_dump()


def _resolve_get(
    identifier: str,
    request: Request,
    db: Session,
    *,
    secret_key: str,
    auth_deps: AuthDeps,
) -> policy.ShareAccess:
    ctx = auth_deps.get_optional_auth_context(request=request, db=db)
    session_cookie = request.cookies.get(_share_session_cookie_name(identifier))
    bearer = _extract_bearer(request)
    return policy.resolve_share(
        db,
        identifier,
        "GET",
        secret_key=secret_key,
        session_cookie=session_cookie,
        bearer_token=bearer,
        principal=ctx.principal if ctx else None,
        request=request,
    )


def _record_access(db: Session, share: "models.Share", access: policy.ShareAccess, request: Request) -> None:
    """The one place `hit_count`/`last_access_at` are ever incremented.
    Unconditional — every call site is already responsible for only
    calling this on a content-bearing response (never the HTML shell). A
    reload/re-fetch of the SAME content-bearing URL is legitimately another
    hit (DESIGN-SPEC round 7 item 59: "a reload is legitimately another
    open"), so there is no dedup at this level."""
    share.hit_count += 1
    share.last_access_at = time.time()
    db.commit()
    write_audit_event(db, "share.access", slug=share.slug, principal=access.principal, request=request)


def build_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    """Routes mounted on the ROOT app (no CORS): raw/JSON GET, password
    auth, editor PUT."""
    router = APIRouter(tags=["share-public"])

    @router.get("/share/{identifier}")
    @limiter.limit(settings.rate_limit_share)
    def get_share(identifier: str, request: Request, db: Session = Depends(get_db)):
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return _deny_response(request, exc)

        share = access.share
        blob = db.get(models.Blob, share.blob_id)

        # Item 59 — count the content-bearing response, never the shell.
        # `_record_access` fires exactly once, right before whichever
        # content response actually gets returned.
        if _wants_json(request):
            _record_access(db, share, access, request)
            return JSONResponse(
                status_code=200,
                content=_content_payload(db, share, blob, access.role),
                headers=dict(JSON_SECURITY_HEADERS),
            )

        # Single-origin refactor (Phase 10.5a) — a real browser navigation
        # to a RENDERED-mode file share needs the SPA's fullscreen rendered
        # view (roadmap §1), which re-fetches this exact content itself via
        # JSON. RAW-mode shares NEVER take this branch, full stop — they
        # keep returning raw bytes unconditionally regardless of Accept,
        # exactly as before (roadmap §1: "never text/html — a raw share
        # must never execute"; see `tests/test_raw_mode.py`).
        # NOT counted: this branch's own return is the shell, not content.
        if share.render_mode == models.RenderMode.rendered and _wants_html(request):
            # DESIGN-SPEC round 10 item 67 — the ONLY place a share's title
            # ever gets baked into the shell HTML, and ONLY when every one
            # of these three conditions holds. Reaching this line already
            # means access resolved successfully (we're past the
            # PolicyDenied try/except above) — that's condition (c). The
            # other two are checked explicitly, right here, so the "byte-
            # identical to today" guarantee for every other case is visible
            # in one place rather than scattered across branches:
            meta_title = (
                _shell_meta_title_for(share, blob)
                if share.show_title and share.auth_mode == models.AuthMode.none
                else None
            )
            shell = _spa_shell_response(request, meta_title=meta_title)
            if shell is not None:
                return shell

        _record_access(db, share, access, request)
        return _raw_response(share, blob, download=_wants_download(request))

    @router.post("/share/{identifier}/auth")
    @limiter.limit(settings.rate_limit_share_auth)
    def share_password_auth(
        identifier: str,
        request: Request,
        payload: schemas.SharePasswordAuthIn,
        db: Session = Depends(get_db),
    ):
        # Deliberately bypasses resolve_share: this endpoint's contract is a
        # plain, symmetric "404 for wrong password AND for nonexistent slug
        # alike" (roadmap §1) — the exact same uniform-404 policy.py now
        # applies everywhere, implemented directly here since this endpoint
        # doesn't otherwise share resolve_share's auth-mode branching (a
        # password submission isn't a GET/PUT). This is also the ONE route
        # `settings.rate_limit_share_auth` throttles specifically (see
        # server/README.md and tests/test_policy_gate.py's throttling
        # test) — the 429 slowapi emits when exhausted is identical for a
        # real share and a nonexistent one (keyed by caller IP, not by
        # slug), so exhausting it never tells an attacker anything about
        # whether the slug names a real record.
        if not security.validate_slug_format(identifier):
            write_audit_event(db, "auth.failure", slug=identifier, reason="malformed_slug", request=request)
            return policy.not_found_response()

        share = policy.lookup_share(db, identifier)
        now = time.time()
        invalid = (
            share is None
            or share.revoked_at is not None
            or policy.is_expired(share.expires_at, now)
            or share.auth_mode != models.AuthMode.password
            or not share.password_hash
        )
        if invalid:
            write_audit_event(db, "auth.failure", slug=identifier, reason="not_a_valid_password_share", request=request)
            return policy.not_found_response()

        if not security.verify_password(share.password_hash, payload.password):  # type: ignore[union-attr]
            write_audit_event(db, "auth.failure", slug=share.slug, reason="wrong_password", request=request)  # type: ignore[union-attr]
            return policy.not_found_response()

        cookie_payload = {
            "kind": "share_session",
            "slug": share.slug,  # type: ignore[union-attr]
            "exp": now + settings.session_ttl_min * 60,
        }
        cookie_value = security.make_signed_cookie(secret_key, cookie_payload)
        write_audit_event(db, "share.access", slug=share.slug, reason="password_auth_success", request=request)  # type: ignore[union-attr]

        # Setting the cookie on a `response: Response` DEPENDENCY parameter
        # only works when the endpoint returns a plain value for FastAPI to
        # serialize itself — an endpoint that instead returns its own
        # Response object (as every deny path above does, via
        # policy.not_found_response()) replaces that injected object
        # entirely, silently dropping the cookie. So the cookie is set
        # directly on the actual Response instance being returned here.
        out = JSONResponse(status_code=200, content={"ok": True})
        out.set_cookie(
            _share_session_cookie_name(share.slug),  # type: ignore[union-attr]
            cookie_value,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path=f"/share/{share.slug}",  # type: ignore[union-attr]
            max_age=settings.session_ttl_min * 60,
        )
        return out

    @router.put("/share/{identifier}")
    @limiter.limit(settings.rate_limit_share)
    async def put_share(identifier: str, request: Request, db: Session = Depends(get_db)):
        ctx = auth_deps.get_optional_auth_context(request=request, db=db)
        session_cookie = request.cookies.get(_share_session_cookie_name(identifier))
        bearer = _extract_bearer(request)
        try:
            access = policy.resolve_share(
                db,
                identifier,
                "PUT",
                secret_key=secret_key,
                session_cookie=session_cookie,
                bearer_token=bearer,
                principal=ctx.principal if ctx else None,
                request=request,
            )
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        body = await request.body()
        # DESIGN-SPEC item 40: DB-backed admin setting, not the config
        # value directly — see routers/shares.py::create_blob's identical
        # comment and runtime_settings.py's module docstring.
        if len(body) > get_max_blob_bytes(db):
            raise HTTPException(status_code=413, detail="Blob exceeds maximum size")

        digest = hashlib.sha256(body).hexdigest()
        if db.get(models.Blob, digest) is None:
            db.add(models.Blob(id=digest, content=body, size=len(body), media_type_hint=None))
        access.share.blob_id = digest
        db.commit()
        # Round 6 item 12 — the edit also lands as a real commit in the
        # bare sync repo (best-effort, see vaultcommit.py's doc), so the
        # owner receives it through the ordinary sync pipeline.
        committed = commit_share_edit(settings, access.share.source_path, body, access.principal)
        write_audit_event(
            db, "share.access", slug=access.share.slug, principal=access.principal, reason="editor_put", request=request
        )
        return {"ok": True, "blob_id": digest, "vault_committed": committed}

    @router.api_route("/share/{identifier}/{rest:path}", methods=["GET", "HEAD", "PUT", "PATCH"])
    @limiter.limit(settings.rate_limit_share)
    def share_subpath_removed(identifier: str, rest: str, request: Request, db: Session = Depends(get_db)):
        """§4.4 — folder shares (and their `/share/{id}/{relpath}` routes)
        were removed entirely; every share is now a single pinned blob
        reachable only at the bare `/share/{identifier}` route above. A
        request shaped like the old folder route (ANY extra path segment
        after the identifier, for ANY of these methods) is just one more
        deny reason — uniform with every other one, never a distinct
        "route not found" shape, and never routed to the generic SPA
        catch-all in `main.py` (which doesn't apply the same JSON-vs-HTML
        negotiation `_deny_response` does). `identifier`/`rest` themselves
        are never looked at — even a real, live slug 404s here, exactly
        like the Phase 10.5 "file share has no sub-paths" deny reason
        did."""
        if request.method in ("GET", "HEAD"):
            return _deny_response(request, None)
        return policy.not_found_response()

    return router


def build_content_router(get_db, limiter: Limiter, settings: Settings, secret_key: str, auth_deps: AuthDeps) -> APIRouter:
    """`GET /share/{identifier}/content` — mounted under the CORS-enabled
    `/api` sub-app (becomes `/api/share/{identifier}/content`) so the SPA's
    rendered-share page (Phase 10) can fetch it cross-origin with
    credentials, while still going through the SAME policy gate as every
    other `/share/*` request. This route is otherwise public — it carries no
    app-auth dependency of its own."""
    router = APIRouter(tags=["share-public-cors"])

    @router.get("/share/{identifier}/content")
    @limiter.limit(settings.rate_limit_share)
    def get_share_content(identifier: str, request: Request, db: Session = Depends(get_db)):
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        share = access.share
        blob = db.get(models.Blob, share.blob_id)
        # Item 59 — this whole route is the CORS twin of the ROOT app
        # route: always JSON, no shell branch ever exists here, so every
        # response is content-bearing and counts unconditionally.
        _record_access(db, share, access, request)
        return JSONResponse(
            status_code=200,
            content=_content_payload(db, share, blob, access.role),
            headers=dict(JSON_SECURITY_HEADERS),
        )

    @router.api_route("/share/{identifier}/content/{rest:path}", methods=["GET", "HEAD"])
    @limiter.limit(settings.rate_limit_share)
    def share_content_subpath_removed(identifier: str, rest: str, request: Request, db: Session = Depends(get_db)):
        """The CORS-enabled twin of `share_subpath_removed` above — §4.4,
        folder shares removed. Always the plain JSON uniform 404, this
        route never serves the HTML shell."""
        return policy.not_found_response()

    return router

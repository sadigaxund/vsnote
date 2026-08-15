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

A real browser navigation (`Accept: text/html`) to `GET /share/{id}` or
`GET /share/{id}/{relpath}` gets the built SPA's `index.html` instead of this
route's raw/JSON response — for EVERY outcome: a successful rendered-mode
file share, ANY folder share (success), AND every deny reason (bogus slug,
revoked, expired, restricted, password-required-with-no-session, an
unresolvable relpath — see `_deny_response`'s doc for why widening this to
cover denials too, rather than keeping denials JSON-only, is what makes
password-protected/private links actually usable through a cold browser
navigation, and why it makes the navigation-level oracle STRICTLY narrower,
not wider). The ONE exception, non-negotiable: a successful RAW-mode file
share always returns `text/plain` unconditionally, browser or not, per
roadmap §1's "a raw share must never execute" — `_wants_html` is checked
there but the branch is gated on `render_mode == "raw"` failing, not on
`Accept`. A non-browser caller that never sends `Accept: text/html` (no
header, `Accept: application/json`, curl's plain `*/*`) is completely
unaffected either way — same raw/JSON responses as before this phase,
including the byte-identical uniform 404 for every deny reason.

--- Phase 10.5: folder ("group") shares, roadmap §5.1 -----------------------

A `kind=="folder"` Share has no single `blob_id`; its content is a snapshot
manifest (`models.ShareManifestEntry` rows, one per INCLUDED file, keyed by
`(share_id, relpath)`). `GET /share/{identifier}/{relpath:path}` (added
below, `build_folder_router`) resolves a path inside that manifest with ONE
exact-string-match DB query — `_manifest_entry()` — no normalization
(`os.path`/`pathlib`), no filesystem access, no path joining of any kind.
That is the entire security argument for why traversal is structurally
impossible rather than merely sanitized against: `..`, an absolute path
(`/etc/passwd`), a URL-encoded or double-encoded traversal string, a
backslash variant, and a relpath that's real but belongs to a DIFFERENT
share's manifest all fail for the exact same reason an unknown or excluded
path does — no row in `share_manifest_entries` has that `(share_id,
relpath)` pair — and therefore all fall through to the identical
`policy.not_found_response()` every other deny reason in this module uses.
See `models.ShareManifestEntry`'s docstring and `docs/ARCHITECTURE.md`'s
"Folder shares" section for the full writeup, and
`tests/test_folder_shares.py` for the resolution matrix this claim is tested
against (extended into `test_policy_gate.py`'s existing equivalence-matrix
tests too, so the new routes are covered by the same single-fingerprint
assertion as every Phase 9 deny state).

Directory listings (`_listing_for_prefix`) are the one place this module
does more than an exact match — enumerating a share's manifest rows that
share a path prefix, to build a plain listing (roadmap: "no README
special-casing... folder URLs show a plain listing", "must not inline user
content into HTML server-side"). This still never leaves the manifest: the
query is `WHERE share_id = ?`, so it can only ever enumerate rows that
already belong to the share the caller was granted access to — an unknown
or excluded prefix (no matching rows) returns `None`, same as an unknown
file, same uniform 404.
"""

from __future__ import annotations

import base64
import hashlib
import time
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from sqlalchemy.orm import Session

from .. import models, policy, schemas, security
from ..audit import write_audit_event
from ..auth import AuthDeps
from ..config import Settings

# Module-level constant, used UNCONDITIONALLY for the raw response — it is
# structurally impossible for this endpoint to emit text/html because this
# is the only Content-Type value any raw-mode code path ever passes to
# Response(). See tests/test_raw_mode.py::test_raw_never_html_even_for_html_payload.
RAW_CONTENT_TYPE = "text/plain; charset=utf-8"

RAW_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
}

JSON_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
}


def _wants_json(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "application/json" in accept


def _wants_html(request: Request) -> bool:
    """A real browser navigation (`Accept: text/html,...`) — the signal
    `_spa_shell_response` below uses to decide whether to hand back the
    built SPA's `index.html` instead of this route's normal raw/JSON
    response. Deliberately NOT "absence of `application/json`": a plain
    curl/script with no `Accept` header at all must keep getting the
    documented default (raw bytes for a file, the JSON listing for a
    folder — see `server/README.md`'s "Public share contract") exactly as
    before this phase. Only an explicit `text/html` preference is treated
    as "this is a page load, hand back the app shell.\""""
    accept = request.headers.get("accept", "")
    return "text/html" in accept


def _spa_shell_response(request: Request) -> Optional[Response]:
    """Single-origin refactor (Phase 10.5a, roadmap §5.4): FastAPI is now
    also the SPA's own web server (`main.py`'s `app.state.spa_index_html`),
    so a real browser navigating to `/share/<slug>[/<relpath>]` needs to
    land on the app shell (which then re-fetches this exact same content
    via `share/ShareApp.tsx`'s own `Accept: application/json` request), not
    the raw bytes / JSON this route serves to non-browser callers.

    Called from BOTH the success path (`get_share`/`get_share_path`/
    `_render_folder_resolution`, for a rendered-mode file share or ANY
    folder share) AND the deny path (`_deny_response` below, for EVERY
    deny reason — bogus slug, revoked, expired, password-required-with-no-
    session, wrong role, unresolvable relpath). Content-independent: the
    exact same `app.state.spa_index_html` bytes are returned in every case,
    with no slug/policy/error detail ever baked into it — see
    `_deny_response`'s doc for why serving this UNCONDITIONALLY for
    `Accept: text/html` is what actually closes the existence oracle for
    navigation, rather than reopening one.

    Returns `None` (never raises) when the SPA hasn't been built yet
    (`app.state.spa_index_html` unset — `main.py` logs this at startup) so
    every caller falls back to its normal raw/JSON response instead of
    crashing — the API stays fully usable with no `dist/` present."""
    html = getattr(request.app.state, "spa_index_html", None)
    if html is None:
        return None
    return Response(content=html, media_type="text/html; charset=utf-8", headers={"X-Content-Type-Options": "nosniff"})


def _deny_response(request: Request, exc: "Optional[policy.PolicyDenied]") -> Response:
    """The single place every deny reason on `GET /share/{id}[/{relpath}]`
    becomes an HTTP response (bogus/malformed slug, revoked, expired,
    restricted-no-identity, wrong role, password-required-with-no-session,
    an unresolvable folder relpath — literally every branch that used to
    call `policy.denial_response(exc)`/`policy.not_found_response()`
    directly). Two possible outcomes, chosen ONLY by `Accept`, never by the
    deny reason itself:

    - A real browser navigation (`_wants_html`, and NOT also asking for
      JSON) gets the SPA shell — UNCONDITIONALLY, the identical bytes for
      every single deny reason, exactly the same bytes a SUCCESSFUL
      rendered-mode/folder share's navigation gets too (`_spa_shell_
      response` above). This is a deliberate widening from this phase's
      original, more conservative design (deny always JSON, no exceptions)
      — caught in review: that design made password-protected/revoked/
      expired/bogus links literally unusable in the single-origin
      deployment, since a cold browser navigation could never reach the
      SPA's own password-prompt UI at all (`ShareApp.tsx`'s "unavailable,
      or it requires a password" state — see that file's doc — never gets
      a chance to mount). Serving the shell here instead makes navigation
      STRICTLY MORE private, not less: previously a plain
      `curl -H 'Accept: text/html'` could distinguish "real, accessible,
      rendered/folder share" (200 HTML) from "anything denied" (404 JSON)
      from "real raw-mode share" (200 text/plain) — three classes. Now
      every deny reason AND every rendered/folder success collapse into
      ONE identical 200-HTML class; only a successful RAW-mode share still
      stands apart (200 text/plain — see `get_share`'s own doc for why
      that one case is excluded, non-negotiably, on its own terms).
    - Every other request (no `Accept` at all — the documented default —
      or an explicit `Accept: application/json`) gets the byte-identical
      JSON `404 {"detail":"Not found"}`, UNCHANGED from before this
      widening: `tests/test_policy_gate.py`'s equivalence-matrix tests
      (httpx's default carries no `Accept` header at all) exercise exactly
      this branch and are completely unaffected by the change above.

    `exc=None` covers the "access already granted, but this specific
    relpath/kind doesn't resolve" family (unresolvable folder relpath, a
    file share hit with a sub-path) — same treatment, no distinct shape."""
    if _wants_html(request) and not _wants_json(request):
        shell = _spa_shell_response(request)
        if shell is not None:
            return shell
    if exc is None:
        return policy.not_found_response()
    return policy.denial_response(exc)


def _share_session_cookie_name(slug_or_alias: str) -> str:
    return f"slate_share_{slug_or_alias}"


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


def _content_payload(share: "models.Share", blob: "models.Blob") -> dict:
    content, encoding = _decode_content(blob)
    out = schemas.ShareContentOut(
        slug=share.slug,
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
    )
    return out.model_dump()


def _manifest_entry(db: Session, share_id: int, relpath: str) -> Optional["models.ShareManifestEntry"]:
    """THE security boundary for folder-share content resolution — see this
    module's header doc. One exact-match query, nothing else."""
    return (
        db.query(models.ShareManifestEntry)
        .filter(models.ShareManifestEntry.share_id == share_id, models.ShareManifestEntry.relpath == relpath)
        .one_or_none()
    )


def _listing_for_prefix(db: Session, share_id: int, prefix: str) -> Optional[List[Dict[str, Any]]]:
    """Directory listing for `prefix` (`""` = subtree root), computed purely
    from this share's own manifest rows. `None` means `prefix` isn't the
    root and doesn't match anything in the manifest — the caller 404s that
    exactly like an unknown file (see this module's header doc)."""
    rows = db.query(models.ShareManifestEntry).filter(models.ShareManifestEntry.share_id == share_id).all()
    norm_prefix = "" if prefix == "" else prefix.rstrip("/") + "/"
    matched = [r for r in rows if r.relpath.startswith(norm_prefix)]
    if prefix != "" and not matched:
        return None

    children: Dict[str, Dict[str, Any]] = {}
    for r in matched:
        rest = r.relpath[len(norm_prefix) :]
        if not rest:
            continue
        if "/" in rest:
            name = rest.split("/", 1)[0]
            children.setdefault(name, {"name": name, "kind": "dir", "relpath": f"{norm_prefix}{name}"})
        else:
            children[rest] = {
                "name": rest,
                "kind": "file",
                "relpath": r.relpath,
                "size": r.size,
                "media_type_hint": r.media_type_hint,
            }
    return sorted(children.values(), key=lambda e: (e["kind"] != "dir", e["name"].lower()))


def _listing_payload(share: "models.Share", prefix: str, entries: List[Dict[str, Any]]) -> dict:
    out = schemas.ShareListingOut(
        slug=share.slug,
        alias=share.alias,
        prefix=prefix,
        entries=[schemas.ShareListingEntryOut(**e) for e in entries],
        created_at=share.created_at,
        last_access_at=share.last_access_at,
        hit_count=share.hit_count,
    )
    return out.model_dump()


def _folder_file_content_payload(share: "models.Share", entry: "models.ShareManifestEntry", blob: "models.Blob") -> dict:
    content, encoding = _decode_content(blob)
    out = schemas.ShareContentOut(
        slug=share.slug,
        alias=share.alias,
        source_path=entry.relpath,
        render_mode=share.render_mode.value,
        media_type_hint=entry.media_type_hint,
        blob_id=entry.blob_id,
        size=entry.size,
        live=False,
        content=content,
        content_encoding=encoding,  # type: ignore[arg-type]
        created_at=share.created_at,
        last_access_at=share.last_access_at,
        hit_count=share.hit_count,
    )
    return out.model_dump()


FolderResolution = Union[Tuple[str, "models.ShareManifestEntry"], Tuple[str, List[Dict[str, Any]]], None]


def _resolve_folder_path(db: Session, share: "models.Share", relpath: str) -> FolderResolution:
    """Returns `("file", entry)`, `("dir", entries)`, or `None` (not found —
    caller 404s). `relpath` is used EXACTLY as received — see this module's
    header doc for why that's the whole security property."""
    entry = _manifest_entry(db, share.id, relpath)
    if entry is not None:
        return ("file", entry)
    listing = _listing_for_prefix(db, share.id, relpath)
    if listing is not None:
        return ("dir", listing)
    return None


def _render_folder_resolution(
    resolution: FolderResolution,
    share: "models.Share",
    db: Session,
    request: Request,
    prefix: str,
) -> Optional[Response]:
    """Turns a non-None `_resolve_folder_path` result into the actual HTTP
    Response (raw bytes / JSON content / JSON listing, content-negotiated
    the same way the file-share route is). Returns None for the `None`
    (not-found) case so callers fall through to the uniform 404."""
    if resolution is None:
        return None
    # Single-origin refactor (Phase 10.5a) — a real browser navigation into
    # ANY part of a folder share (root listing, a subdirectory, or an
    # individual file) needs the SPA's slim tree+content reader page
    # (roadmap §5.1), not this route's raw/JSON response — that page then
    # re-fetches this exact URL itself via `Accept: application/json`. Only
    # applies once access is already granted (see `_spa_shell_response`'s
    # doc) and only when the SPA has actually been built; otherwise this is
    # a no-op and every existing non-browser caller (curl, the documented
    # API contract, this file's own test suite) sees byte-identical
    # behavior to before this phase.
    if not _wants_json(request) and _wants_html(request):
        shell = _spa_shell_response(request)
        if shell is not None:
            return shell
    kind, payload = resolution
    if kind == "file":
        entry = payload
        blob = db.get(models.Blob, entry.blob_id)
        if _wants_json(request):
            return JSONResponse(
                status_code=200,
                content=_folder_file_content_payload(share, entry, blob),
                headers=dict(JSON_SECURITY_HEADERS),
            )
        return Response(content=blob.content, media_type=RAW_CONTENT_TYPE, headers=dict(RAW_SECURITY_HEADERS))
    # "dir" — always JSON; there is no raw-bytes representation of a listing
    # (roadmap §5.1: never inline content into HTML server-side).
    return JSONResponse(
        status_code=200,
        content=_listing_payload(share, prefix, payload),
        headers=dict(JSON_SECURITY_HEADERS),
    )


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

        if share.kind == models.ShareKind.folder:
            # Folder root — always the subtree listing (roadmap §5.1: "no
            # README special-casing... folder URLs show a plain listing"),
            # never a specific file's raw bytes. Resolution is never None
            # for the root prefix (empty manifests still list as "no
            # entries"), but the check is kept for symmetry with
            # get_share_path below.
            resolution = _resolve_folder_path(db, share, "")
            if resolution is None:
                return _deny_response(request, None)
            _record_access(db, share, access, request)
            resp = _render_folder_resolution(resolution, share, db, request, "")
            return resp if resp is not None else _deny_response(request, None)

        blob = db.get(models.Blob, share.blob_id)
        _record_access(db, share, access, request)

        if _wants_json(request):
            return JSONResponse(
                status_code=200,
                content=_content_payload(share, blob),
                headers=dict(JSON_SECURITY_HEADERS),
            )

        # Single-origin refactor (Phase 10.5a) — a real browser navigation
        # to a RENDERED-mode file share needs the SPA's fullscreen rendered
        # view (roadmap §1), which re-fetches this exact content itself via
        # JSON. RAW-mode shares NEVER take this branch, full stop — they
        # keep returning `text/plain` unconditionally regardless of Accept,
        # exactly as before (roadmap §1: "never text/html — a raw share
        # must never execute"; see `tests/test_raw_mode.py::
        # test_raw_never_html_even_for_html_payload_with_script_tag`).
        if share.render_mode == models.RenderMode.rendered and _wants_html(request):
            shell = _spa_shell_response(request)
            if shell is not None:
                return shell

        return Response(content=blob.content, media_type=RAW_CONTENT_TYPE, headers=dict(RAW_SECURITY_HEADERS))

    @router.get("/share/{identifier}/{relpath:path}")
    @limiter.limit(settings.rate_limit_share)
    def get_share_path(identifier: str, relpath: str, request: Request, db: Session = Depends(get_db)):
        """Folder-share subtree resolution (roadmap §5.1) — see this
        module's header doc for the exact-match security argument. `GET
        .../auth` (the one other 2-segment route on this identifier) is a
        POST-only literal route registered separately, so it never reaches
        here for its own method; a stray GET to `.../auth` legitimately
        falls through to manifest resolution for a file literally named
        "auth", same as any other relpath — nothing structurally special
        about that string."""
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return _deny_response(request, exc)

        share = access.share
        if share.kind != models.ShareKind.folder:
            # File shares have no sub-paths — same uniform 404 as any other
            # deny, not a distinct "wrong kind" shape.
            return _deny_response(request, None)

        resolution = _resolve_folder_path(db, share, relpath)
        if resolution is None:
            return _deny_response(request, None)
        _record_access(db, share, access, request)
        resp = _render_folder_resolution(resolution, share, db, request, relpath)
        return resp if resp is not None else _deny_response(request, None)

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
        # password submission isn't a GET/PUT).
        if not security.validate_slug_format(identifier):
            write_audit_event(db, "auth.failure", slug=identifier, reason="malformed_slug", request=request)
            return policy.not_found_response()

        share = policy.lookup_share(db, identifier)
        now = time.time()
        invalid = (
            share is None
            or share.revoked_at is not None
            or (share.expires_at is not None and share.expires_at < now)
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

        if access.share.kind == models.ShareKind.folder:
            # Editor write-back for folder shares is out of Phase 10.5 scope
            # (roadmap §5.1 only specifies "Update share" via the owner-only
            # `PUT /api/shares/{id}/manifest`, not a public per-subtree PUT)
            # — same uniform 404 as any other deny, not a distinct
            # "unsupported" shape.
            return policy.not_found_response()

        body = await request.body()
        if len(body) > settings.max_blob_bytes:
            raise HTTPException(status_code=413, detail="Blob exceeds maximum size")

        digest = hashlib.sha256(body).hexdigest()
        if db.get(models.Blob, digest) is None:
            db.add(models.Blob(id=digest, content=body, size=len(body), media_type_hint=None))
        access.share.blob_id = digest
        db.commit()
        write_audit_event(
            db, "share.access", slug=access.share.slug, principal=access.principal, reason="editor_put", request=request
        )
        return {"ok": True, "blob_id": digest}

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

        if share.kind == models.ShareKind.folder:
            resolution = _resolve_folder_path(db, share, "")
            if resolution is None:
                return policy.not_found_response()
            _record_access(db, share, access, request)
            # Always JSON on this route (it's the CORS-enabled JSON twin) —
            # reuse the same listing/file payload shaping as the root app's
            # `{relpath:path}` route.
            kind, payload = resolution
            if kind == "file":
                blob = db.get(models.Blob, payload.blob_id)
                return JSONResponse(
                    status_code=200,
                    content=_folder_file_content_payload(share, payload, blob),
                    headers=dict(JSON_SECURITY_HEADERS),
                )
            return JSONResponse(
                status_code=200,
                content=_listing_payload(share, "", payload),
                headers=dict(JSON_SECURITY_HEADERS),
            )

        blob = db.get(models.Blob, share.blob_id)
        _record_access(db, share, access, request)
        return JSONResponse(
            status_code=200,
            content=_content_payload(share, blob),
            headers=dict(JSON_SECURITY_HEADERS),
        )

    @router.get("/share/{identifier}/content/{relpath:path}")
    @limiter.limit(settings.rate_limit_share)
    def get_share_content_path(identifier: str, relpath: str, request: Request, db: Session = Depends(get_db)):
        """The CORS-enabled twin of the root app's `GET
        /share/{identifier}/{relpath:path}` — same policy gate, same
        manifest resolution, always JSON (this route exists purely for the
        SPA's cross-origin `fetch(..., {credentials:"include"})`, which
        needs `Access-Control-Allow-Origin` back; raw bytes make no sense
        here since the visitor reader page always wants structured JSON)."""
        try:
            access = _resolve_get(identifier, request, db, secret_key=secret_key, auth_deps=auth_deps)
        except policy.PolicyDenied as exc:
            return policy.denial_response(exc)

        share = access.share
        if share.kind != models.ShareKind.folder:
            return policy.not_found_response()

        resolution = _resolve_folder_path(db, share, relpath)
        if resolution is None:
            return policy.not_found_response()
        _record_access(db, share, access, request)

        kind, payload = resolution
        if kind == "file":
            blob = db.get(models.Blob, payload.blob_id)
            return JSONResponse(
                status_code=200,
                content=_folder_file_content_payload(share, payload, blob),
                headers=dict(JSON_SECURITY_HEADERS),
            )
        return JSONResponse(
            status_code=200,
            content=_listing_payload(share, relpath, payload),
            headers=dict(JSON_SECURITY_HEADERS),
        )

    return router

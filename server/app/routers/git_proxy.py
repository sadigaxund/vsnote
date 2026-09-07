"""`POST|GET /api/git-proxy/{rest_of_path:path}` — the streaming HTTP side of
R3-2's same-origin git CORS proxy. `app/git_proxy.py`'s module docstring has
the full "why" (isomorphic-git's `corsProxy` contract, the browser-CORS
problem this solves) and the pure validation rules this route enforces; this
file is just the network/streaming plumbing around those rules.

Mounted on `api_app` (`/api`-grade auth applies — same
`AuthDeps.require_auth_context` every other `/api` route uses, session
cookie or any scoped API token), deliberately NOT on the unauthenticated
`/git` mount `main.py` already owns for the vault's own bare repos: this
route makes THIS server originate arbitrary outbound requests to
allowlisted third-party hosts, which must never be reachable by an
unauthenticated caller.

Route shape mirrors exactly what isomorphic-git's `corsProxify` produces
when given `corsProxy = "{origin}/api/git-proxy"` (no trailing `?`):

    corsProxy + '/' + url.replace(/^https?:\\/\\//, '')
    = {origin}/api/git-proxy/github.com/me/notes.git/info/refs?service=...

i.e. `rest_of_path` is `<host>/<path...>` with the scheme already stripped
by isomorphic-git, and the query string arrives as this request's own query
string (Starlette splits path/query for us) — `git_proxy.validate_target`
reassembles both back into a real `https://` target URL.
"""

from __future__ import annotations

from typing import AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, Request
from starlette.responses import Response, StreamingResponse

from ..auth import AuthContext, AuthDeps
from ..config import Settings
from ..git_proxy import (
    GitProxyRefusal,
    check_host_allowed,
    check_not_private,
    filter_request_headers,
    filter_response_headers,
    validate_target,
)

MAX_REDIRECTS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
REFUSAL_MARKER = "VSNOTE-GIT-PROXY-REFUSAL:"


def _refusal_response(exc: GitProxyRefusal) -> Response:
    # Plain text, never JSON: the client reads this exact prefix straight
    # out of isomorphic-git's `HttpError.data.response` (the raw response
    # body isomorphic-git already captures for us) — see
    # `src/git/remote.ts`'s `mapError` doc. Never includes the incoming
    # Authorization header or any credential — `exc.detail` is always one of
    # this module's own static/templated messages.
    return Response(content=f"{REFUSAL_MARKER} {exc.detail}", status_code=exc.status_code, media_type="text/plain")


class _BodyTooLarge(Exception):
    pass


async def _bounded_body(request: Request, max_bytes: int) -> AsyncIterator[bytes]:
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise _BodyTooLarge()
        yield chunk


def build_router(settings: Settings, auth_deps: AuthDeps) -> APIRouter:
    router = APIRouter(prefix="/git-proxy", tags=["git-proxy"])
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)

    @router.api_route("/{rest_of_path:path}", methods=["GET", "POST"])
    async def proxy(
        rest_of_path: str,
        request: Request,
        ctx: AuthContext = Depends(auth_deps.require_auth_context),  # noqa: ARG001 — auth-only, unused otherwise
    ):
        # Cheap up-front check against a declared Content-Length — the
        # `_bounded_body` wrapper below is the real enforcement (a client
        # can lie about or omit Content-Length; it can't lie about how many
        # bytes it actually streams).
        declared_length = request.headers.get("content-length")
        if declared_length is not None:
            try:
                if int(declared_length) > settings.git_proxy_max_body_bytes:
                    return Response(
                        content=f"{REFUSAL_MARKER} Request body too large.",
                        status_code=413,
                        media_type="text/plain",
                    )
            except ValueError:
                pass

        try:
            target = validate_target(rest_of_path, request.url.query, settings)
        except GitProxyRefusal as exc:
            return _refusal_response(exc)

        method = request.method
        req_headers = filter_request_headers(request.headers.items())

        client = httpx.AsyncClient(follow_redirects=False, timeout=timeout)

        async def body_source() -> Optional[AsyncIterator[bytes]]:
            if method != "POST":
                return None
            return _bounded_body(request, settings.git_proxy_max_body_bytes)

        current_url = target
        redirects = 0
        upstream: httpx.Response
        try:
            while True:
                content = await body_source()
                try:
                    upstream = await client.send(
                        client.build_request(method, current_url, headers=req_headers, content=content),
                        stream=True,
                    )
                except _BodyTooLarge:
                    await client.aclose()
                    return Response(
                        content=f"{REFUSAL_MARKER} Request body too large.",
                        status_code=413,
                        media_type="text/plain",
                    )

                if method == "GET" and upstream.status_code in REDIRECT_STATUSES:
                    location = upstream.headers.get("location")
                    await upstream.aclose()
                    if not location or redirects >= MAX_REDIRECTS:
                        break
                    redirects += 1
                    next_url = httpx.URL(current_url).join(location)
                    if next_url.scheme != "https" or not next_url.host:
                        await client.aclose()
                        return Response(
                            content=f"{REFUSAL_MARKER} Redirected to a non-https target.",
                            status_code=400,
                            media_type="text/plain",
                        )
                    try:
                        check_host_allowed(next_url.host, settings)
                        check_not_private(next_url.host, settings)
                    except GitProxyRefusal as exc:
                        await client.aclose()
                        return _refusal_response(exc)
                    current_url = str(next_url)
                    continue
                break
        except httpx.RequestError:
            await client.aclose()
            return Response(
                content=f"{REFUSAL_MARKER} Could not reach the upstream git host.",
                status_code=502,
                media_type="text/plain",
            )

        response_headers = dict(filter_response_headers(upstream.headers.items()))

        async def stream() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(stream(), status_code=upstream.status_code, headers=response_headers)

    return router

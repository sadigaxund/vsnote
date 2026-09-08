"""R3-2 — same-origin git CORS proxy: pure validation/parsing helpers.
`routers/git_proxy.py` is the actual streaming HTTP route; this module is
kept separate and import-light (`ipaddress`/`socket`/`urllib.parse` only —
no `httpx`, no FastAPI) so every refusal rule is directly unit-testable
without spinning up an app or touching a socket for the pure cases.

**Why this exists** (docs/ROADMAP-SHARING-AUTH.md's binding security
posture, mirrored here): Settings → Git & Sync → "Advanced: custom remote"
against a real external host (github.com, ...) fails from the browser
because isomorphic-git's transport is a bare `fetch()`, and those hosts send
no CORS headers on their smart-HTTP endpoints — the browser kills the
request before any HTTP status is visible to JS at all. isomorphic-git's own
`corsProxy` option is the fix: passed to `fetch`/`push`/`getRemoteInfo`,
isomorphic-git itself rewrites the request URL to
`${corsProxy}/${url-without-scheme}` (confirmed against
`node_modules/isomorphic-git/index.js`'s `corsProxify`:
`corsProxy.endsWith('?') ? corsProxy+url : corsProxy+'/'+url.replace(/^https?:\\/\\//,'')`)
before ever calling `fetch()` — so the browser's own request becomes
same-origin (this app's own `/api/git-proxy`), and THIS module does the
actual cross-origin fetch server-side, where CORS is not a browser concept.

Every refusal this module raises (`GitProxyRefusal`) is surfaced by the
router with the body prefixed `VSNOTE-GIT-PROXY-REFUSAL:` — the client
(`src/git/remote.ts`'s `mapError`) reads that exact prefix out of
isomorphic-git's `HttpError.data.response` to tell "our own proxy refused
this on policy grounds" apart from "the actual remote rejected the
credentials" (both can otherwise arrive as a plain HTTP 400/403)."""

from __future__ import annotations

import ipaddress
import re
import socket
from typing import Iterable
from urllib.parse import urlsplit

from .config import Settings

_SCHEME_RE = re.compile(r"^(https?)://(.*)$", re.IGNORECASE | re.DOTALL)

DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = ("github.com", "gitlab.com", "codeberg.org", "bitbucket.org")

# Only these are ever forwarded upstream (module docstring's "Authorization
# and git smart-HTTP content types" clause) — no cookies, no other app
# headers ever leak to a third-party host through this proxy.
ALLOWED_REQUEST_HEADERS: frozenset[str] = frozenset(
    {"authorization", "content-type", "accept", "git-protocol", "user-agent"}
)

# Never forwarded back to the browser verbatim — plain hop-by-hop headers
# (RFC 7230 §6.1) plus `content-encoding` (the body is passed through
# exactly as `httpx` already decoded it, so a stale `Content-Encoding:
# gzip` label on the un-re-encoded bytes would corrupt the response).
HOP_BY_HOP_RESPONSE_HEADERS: frozenset[str] = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-encoding",
    }
)

# R5-2 — never relayed to the browser, period, regardless of what upstream
# sent. This is the root cause of the "browser's native login prompt
# appears after touching Git & Sync" bug: a real 401 from an upstream host
# like github.com carries its OWN `WWW-Authenticate: Basic realm="GitHub"`
# challenge, and a same-origin browser `fetch()` (this proxy's whole reason
# to exist — see module docstring) that sees that header on ANY response
# pops Chrome's native credential dialog, exactly like `git_http.py`'s
# `/git` route used to before item 26a gated it there. isomorphic-git never
# reads this header at all — `onAuth`/`onAuthFailure` are driven purely off
# the response's HTTP status code (401/403), confirmed against
# `node_modules/isomorphic-git/index.js`'s `GitRemoteHTTP`/auth-retry
# logic — so dropping it changes nothing about how isomorphic-git behaves;
# it only stops the byte from ever reaching the browser's own fetch
# machinery. Kept as its own frozenset (rather than folded into
# `HOP_BY_HOP_RESPONSE_HEADERS`, which is a distinct RFC 7230 §6.1 concept)
# so the "why" here — a browser-popup guard, not a hop-by-hop rule — stays
# attached to the header it actually governs. The 401 status and body are
# untouched; only this one header is ever stripped.
NEVER_RELAYED_RESPONSE_HEADERS: frozenset[str] = frozenset({"www-authenticate"})

_UNSAFE_IP_ATTRS = ("is_private", "is_loopback", "is_link_local", "is_multicast", "is_reserved", "is_unspecified")


class GitProxyRefusal(Exception):
    """Any policy-level reason this proxy declines to make (or continue) a
    request — allowlist, scheme, SSRF, malformed target. Never raised for an
    upstream error (that's just proxied through as-is)."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def parse_allowed_hosts(raw: str) -> tuple[str, ...]:
    hosts = tuple(h.strip().lower() for h in raw.split(",") if h.strip())
    return hosts or DEFAULT_ALLOWED_HOSTS


def is_allowed_host(host: str, allowed: Iterable[str]) -> bool:
    """Explicit subdomain rule, never a bare substring/suffix match:
    `foo.github.com` passes for allowed host `github.com`; `notgithub.com`
    and `github.com.evil.example` do not."""
    host = host.lower().rstrip(".")
    for domain in allowed:
        domain = domain.lower().rstrip(".")
        if not domain:
            continue
        if host == domain or host.endswith("." + domain):
            return True
    return False


def split_scheme(rest_of_path: str) -> tuple[str, str]:
    """isomorphic-git's `corsProxify` already strips the scheme before this
    ever reaches us (`url.replace(/^https?:\\/\\//, '')`) — a well-formed
    request never carries one. If one IS present anyway (a hand-crafted
    request, or a future isomorphic-git behavior change), it's still
    resolved and validated here rather than silently reinterpreted: `https`
    passes through, anything else (including plain `http`) is refused by
    the caller."""
    m = _SCHEME_RE.match(rest_of_path)
    if m:
        return m.group(1).lower(), m.group(2)
    return "https", rest_of_path


def build_target_url(rest_of_path: str, query: str, *, allow_http: bool = False) -> tuple[str, str]:
    """Returns `(target_url, hostname)`. Every request this proxy makes
    upstream is `https://` by construction UNLESS `allow_http` — the same
    test/dev escape hatch as `check_not_private`'s
    `git_proxy_allow_private_hosts` (a local fake git server in
    `server/tests/test_git_proxy.py` speaks plain HTTP; production traffic
    never sets this). Raises `GitProxyRefusal` for a disallowed scheme,
    empty, or unparseable target."""
    scheme, remainder = split_scheme(rest_of_path)
    if scheme != "https" and not (allow_http and scheme == "http"):
        raise GitProxyRefusal(400, "Only https upstream git remotes are supported.")
    remainder = remainder.strip()
    if not remainder:
        raise GitProxyRefusal(400, "Missing upstream host in the proxied git URL.")
    target = f"{scheme}://{remainder}"
    if query:
        target = f"{target}?{query}"
    hostname = urlsplit(target).hostname
    if not hostname:
        raise GitProxyRefusal(400, "Could not determine the upstream host.")
    return target, hostname


def check_host_allowed(hostname: str, settings: Settings) -> None:
    allowed = parse_allowed_hosts(settings.git_proxy_hosts)
    if not is_allowed_host(hostname, allowed):
        raise GitProxyRefusal(403, f"Host {hostname!r} is not on the git proxy allowlist.")


def check_not_private(hostname: str, settings: Settings, port: int = 443) -> None:
    """SSRF guard — resolves `hostname` and refuses if ANY returned address
    is private/loopback/link-local/multicast/reserved/unspecified (covers
    RFC1918, loopback, link-local, and IPv6 unique-local `fc00::/7`, which
    Python's `ipaddress.IPv6Address.is_private` already classifies as
    private). Applied to the original request AND, by the router, to every
    redirect hop — a redirect can never launder a private-IP target past
    this check. `settings.git_proxy_allow_private_hosts` is a test/dev-only
    escape hatch (see config.py), off by default."""
    if settings.git_proxy_allow_private_hosts:
        return
    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise GitProxyRefusal(502, f"Could not resolve {hostname!r}.") from exc
    for info in infos:
        raw_ip = info[4][0]
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if any(getattr(ip, attr) for attr in _UNSAFE_IP_ATTRS):
            raise GitProxyRefusal(403, f"Host {hostname!r} resolves to a non-public address; refused.")


def validate_target(rest_of_path: str, query: str, settings: Settings) -> str:
    """The one entry point the router calls for the initial request AND
    (with the redirect's own path+query) for each hop it follows."""
    target, hostname = build_target_url(rest_of_path, query, allow_http=settings.git_proxy_allow_private_hosts)
    check_host_allowed(hostname, settings)
    check_not_private(hostname, settings)
    return target


def filter_request_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers:
        if key.lower() in ALLOWED_REQUEST_HEADERS:
            out[key] = value
    return out


def filter_response_headers(headers: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    dropped = HOP_BY_HOP_RESPONSE_HEADERS | NEVER_RELAYED_RESPONSE_HEADERS
    return [(k, v) for k, v in headers if k.lower() not in dropped]

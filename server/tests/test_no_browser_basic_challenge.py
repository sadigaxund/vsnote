"""R5-2 (the acceptance test) — no browser-shaped request, ANYWHERE in this
app, ever receives a `WWW-Authenticate: Basic` challenge on a 401. That
header on ANY response is what makes Chrome pop its own native credential
dialog on a same-origin `fetch()` — this is the exact symptom the ticket
reports ("after interacting with Settings > Git & Sync... Chrome pops its
own native username/password dialog").

Two independent sources of that header exist in this codebase (confirmed
by `grep -rn WWW-Authenticate server/app` finding only these two files):

  1. `routers/git_http.py`'s `/git/*` mount — gated to real git clients by
     `_is_git_client`'s `User-Agent` check (item 26a,
     `test_git_http_ua_gating.py` covers this in depth; this file adds the
     cross-surface sweep so a regression anywhere else can't slip past).
  2. `git_proxy.py`'s `/api/git-proxy/*` — this ticket's actual root
     cause: an upstream host's OWN `WWW-Authenticate` (e.g. a real
     `401 Bad credentials` from github.com) used to be relayed straight
     through to the browser untouched. `NEVER_RELAYED_RESPONSE_HEADERS`
     drops it unconditionally now, regardless of caller shape — isomorphic-
     git never reads this header at all (it drives `onAuth`/retry off the
     401 status code only), so this is a pure browser-popup guard, not
     something that changes sync behavior.

Every other surface (`/api/*`, `/share/*`) never sets this header at all
(`auth.py`'s 401 is a plain `HTTPException`, no `WWW-Authenticate`) — the
tests below prove that stays true for a realistic browser-shaped request,
so a future contributor adding, say, `HTTPBasic()` to a FastAPI dependency
somewhere can't reintroduce this bug unnoticed.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {"User-Agent": BROWSER_UA, "Accept": "*/*"}


def _no_basic_challenge(resp) -> None:
    headers = {k.lower(): v for k, v in resp.headers.items()}
    www_auth = headers.get("www-authenticate", "")
    assert "basic" not in www_auth.lower(), f"got a Basic challenge: {www_auth!r}"


# --- /api/* : a browser hitting a protected route with no session -------


def test_api_protected_route_no_basic_challenge(client):
    # A real session-authenticated route (`GET /api/shares`,
    # `routers/shares.py`) with no session cookie at all.
    r = client.get("/api/shares", headers=BROWSER_HEADERS)
    assert r.status_code == 401
    _no_basic_challenge(r)


# --- /share/* : a deny path (nonexistent slug — indistinguishable, per
# ROADMAP-SHARING-AUTH's uniform-404 policy, from wrong-password/revoked/
# expired) stays a plain 404, never a 401/Basic challenge. ----------------


def test_share_deny_path_no_basic_challenge(client):
    r = client.get("/share/does-not-exist-slug", headers=BROWSER_HEADERS)
    assert r.status_code == 404
    _no_basic_challenge(r)


# --- /git/* : covered in depth by test_git_http_ua_gating.py; one sweep
# entry here so this file alone proves the cross-surface claim. ----------


def test_git_route_browser_ua_no_basic_challenge(client, owner):
    r = client.get(
        "/git/somerepo.git/info/refs?service=git-upload-pack",
        headers=BROWSER_HEADERS,
    )
    assert r.status_code == 401
    _no_basic_challenge(r)


def test_git_route_real_git_ua_still_gets_basic_challenge(client, owner):
    # The one case that MUST still carry `Basic` — real `git clone/push/
    # pull` depends on this to know to prompt/retry with credentials at
    # all (`git_http.py::_is_git_client`, `test_git_sync.py`'s live
    # round-trip tests). A future change to this file's other assertions
    # must never come at the cost of silently breaking the CLI.
    r = client.get(
        "/git/somerepo.git/info/refs?service=git-upload-pack",
        headers={"User-Agent": "git/2.43.0", "Accept": "*/*"},
    )
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == 'Basic realm="vsnote-git"'


# --- /api/git-proxy/* relaying a stub upstream 401 carrying its OWN
# WWW-Authenticate: Basic — the ticket's actual root cause. -----------------


class _Fake401Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = b"Bad credentials"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="GitHub"')
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def fake_401_upstream():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Fake401Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address  # (host, port)
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_git_proxy_never_relays_upstream_www_authenticate(fake_401_upstream, make_app, make_settings):
    """The ticket's actual repro: a stub upstream sends a real
    `401 ... WWW-Authenticate: Basic realm="GitHub"` (exactly what
    github.com sends for bad/missing credentials) through
    `/api/git-proxy`. Status and body must reach the browser unchanged;
    the header must not."""
    from fastapi.testclient import TestClient

    from app import models, security

    host, port = fake_401_upstream
    settings = make_settings(git_proxy_hosts=host, git_proxy_allow_private_hosts=True)
    app = make_app(settings)
    client = TestClient(app)
    db = app.state.SessionLocal()
    try:
        db.add(
            models.User(
                username="owner",
                password_hash=security.hash_password("correct horse battery staple 1"),
                email="owner@example.com",
                is_admin=True,
            )
        )
        db.commit()
    finally:
        db.close()
    r = client.post("/api/auth/login", json={"username": "owner", "password": "correct horse battery staple 1"})
    assert r.status_code == 200, r.text

    resp = client.get(
        f"/api/git-proxy/http://{host}:{port}/vault.git/info/refs",
        params={"service": "git-upload-pack"},
        headers=BROWSER_HEADERS,
    )
    assert resp.status_code == 401
    assert resp.content == b"Bad credentials"
    _no_basic_challenge(resp)

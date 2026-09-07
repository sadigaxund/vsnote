"""R3-2 — `POST|GET /api/git-proxy/{rest_of_path}`, the same-origin git CORS
proxy (`app/git_proxy.py` + `app/routers/git_proxy.py`). Covers the refusal
matrix from the router/module docstrings (allowlist, scheme, SSRF,
unauthenticated, header filtering) as pure unit tests on `app/git_proxy.py`
directly where possible, plus one integration happy path against a REAL
local HTTP server (never the real network — `docs/ROADMAP-SHARING-AUTH.md`'s
posture is tested here, not exercised against github.com).
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import git_proxy


# --- pure unit tests: app/git_proxy.py, no app/network involved -----------


def test_is_allowed_host_exact_and_subdomain():
    allowed = ("github.com",)
    assert git_proxy.is_allowed_host("github.com", allowed)
    assert git_proxy.is_allowed_host("api.github.com", allowed)
    assert git_proxy.is_allowed_host("GITHUB.COM", allowed)


def test_is_allowed_host_rejects_lookalikes():
    allowed = ("github.com",)
    assert not git_proxy.is_allowed_host("notgithub.com", allowed)
    assert not git_proxy.is_allowed_host("github.com.evil.example", allowed)
    assert not git_proxy.is_allowed_host("evilgithub.com", allowed)


def test_split_scheme_strips_https_but_flags_http():
    assert git_proxy.split_scheme("github.com/x") == ("https", "github.com/x")
    assert git_proxy.split_scheme("https://github.com/x") == ("https", "github.com/x")
    assert git_proxy.split_scheme("http://github.com/x") == ("http", "github.com/x")


def test_build_target_url_refuses_non_https_scheme():
    with pytest.raises(git_proxy.GitProxyRefusal) as exc:
        git_proxy.build_target_url("http://github.com/x", "")
    assert exc.value.status_code == 400


def test_build_target_url_refuses_empty_host():
    with pytest.raises(git_proxy.GitProxyRefusal):
        git_proxy.build_target_url("", "")


def test_build_target_url_reassembles_query():
    target, host = git_proxy.build_target_url("github.com/me/notes.git/info/refs", "service=git-upload-pack")
    assert target == "https://github.com/me/notes.git/info/refs?service=git-upload-pack"
    assert host == "github.com"


def test_check_host_allowed_refuses_disallowed_host(make_settings):
    settings = make_settings()
    with pytest.raises(git_proxy.GitProxyRefusal) as exc:
        git_proxy.check_host_allowed("evil.example.com", settings)
    assert exc.value.status_code == 403


def test_check_host_allowed_accepts_default_hosts(make_settings):
    settings = make_settings()
    git_proxy.check_host_allowed("github.com", settings)  # no raise
    git_proxy.check_host_allowed("gist.github.com".replace("gist", "api"), settings)


def test_check_not_private_refuses_loopback_even_when_allowlisted(make_settings):
    # Allowlist the literal hostname so this exercises the SSRF/IP check
    # specifically, not the allowlist check.
    settings = make_settings(git_proxy_hosts="127.0.0.1,github.com")
    with pytest.raises(git_proxy.GitProxyRefusal) as exc:
        git_proxy.check_not_private("127.0.0.1", settings)
    assert exc.value.status_code == 403
    assert "non-public" in exc.value.detail


def test_check_not_private_allows_loopback_with_escape_hatch(make_settings):
    settings = make_settings(git_proxy_hosts="127.0.0.1", git_proxy_allow_private_hosts=True)
    git_proxy.check_not_private("127.0.0.1", settings)  # no raise


def test_filter_request_headers_keeps_only_the_allowed_set():
    headers = [
        ("Authorization", "Bearer secret"),
        ("Cookie", "session=abc"),
        ("Content-Type", "application/x-git-upload-pack-request"),
        ("X-Forwarded-For", "1.2.3.4"),
        ("Host", "vsnote.example.com"),
    ]
    out = git_proxy.filter_request_headers(headers)
    assert out == {"Authorization": "Bearer secret", "Content-Type": "application/x-git-upload-pack-request"}


def test_filter_response_headers_drops_hop_by_hop():
    headers = [("Content-Type", "text/plain"), ("Connection", "keep-alive"), ("Transfer-Encoding", "chunked")]
    out = git_proxy.filter_response_headers(headers)
    assert out == [("Content-Type", "text/plain")]


# --- integration: unauthenticated refusal, no local server needed ---------


def test_proxy_refuses_unauthenticated(anon_client):
    r = anon_client.get("/api/git-proxy/github.com/me/notes.git/info/refs?service=git-upload-pack")
    assert r.status_code == 401


def test_proxy_refuses_disallowed_host_when_authenticated(owner_client):
    r = owner_client.get("/api/git-proxy/evil.example.com/x/info/refs?service=git-upload-pack")
    assert r.status_code == 403
    assert r.text.startswith("VSNOTE-GIT-PROXY-REFUSAL:")
    assert "allowlist" in r.text


def test_proxy_refuses_explicit_http_scheme(owner_client):
    r = owner_client.get("/api/git-proxy/http://github.com/x/info/refs")
    assert r.status_code == 400
    assert r.text.startswith("VSNOTE-GIT-PROXY-REFUSAL:")
    assert "https" in r.text.lower()


# --- integration happy path: a REAL local HTTP server, never the network --


class _FakeGitHandler(BaseHTTPRequestHandler):
    received_headers: dict | None = None

    def log_message(self, *args):  # silence test output
        pass

    def do_GET(self):
        _FakeGitHandler.received_headers = dict(self.headers.items())
        if self.path.startswith("/redirect-to-disallowed"):
            self.send_response(302)
            self.send_header("Location", "https://evil.example.com/x/info/refs?service=git-upload-pack")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = b"001e# service=git-upload-pack\n0000"
        self.send_response(200)
        self.send_header("Content-Type", "application/x-git-upload-pack-advertisement")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_request_body(self) -> bytes:
        # The proxy streams an upload whose length it doesn't know up front
        # as `Transfer-Encoding: chunked` (httpx's standard behavior for an
        # async-iterable request body) — `BaseHTTPRequestHandler` doesn't
        # dechunk automatically, so this fake endpoint has to.
        if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
            chunks = []
            while True:
                size_line = self.rfile.readline().strip()
                size = int(size_line.split(b";", 1)[0], 16)
                if size == 0:
                    self.rfile.readline()  # trailing CRLF after the 0-size chunk
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)  # CRLF after each chunk's data
            return b"".join(chunks)
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def do_POST(self):
        _FakeGitHandler.received_headers = dict(self.headers.items())
        _ = self._read_request_body()
        body = b"0008NAK\n0000"
        self.send_response(200)
        self.send_header("Content-Type", "application/x-git-upload-pack-result")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def fake_git_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeGitHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address  # (host, port)
    finally:
        server.shutdown()
        thread.join(timeout=5)


@pytest.fixture
def proxy_client_for(make_app, make_settings):
    """Builds a logged-in TestClient against an app whose settings allowlist
    + permit `{host}:{port}` (the local fake server), since the default
    `owner_client`/`app` fixtures' settings only allowlist the real hosts
    and refuse private addresses — exactly the production posture, which is
    the thing under test everywhere else in this file."""
    from fastapi.testclient import TestClient

    from app import models, security

    def _make(host: str, port: int):
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
        return client

    return _make


def test_proxy_happy_path_get_against_local_fake_git_server(fake_git_server, proxy_client_for):
    host, port = fake_git_server
    client = proxy_client_for(host, port)

    resp = client.get(
        f"/api/git-proxy/http://{host}:{port}/vault.git/info/refs",
        params={"service": "git-upload-pack"},
        headers={"Authorization": "Bearer irrelevant-for-the-fake-server"},
    )
    assert resp.status_code == 200
    assert resp.content == b"001e# service=git-upload-pack\n0000"
    assert resp.headers["content-type"] == "application/x-git-upload-pack-advertisement"

    # Header filtering held on the way upstream too: Authorization forwarded,
    # nothing else app-specific leaked (no Cookie, no Host mismatch surprise).
    received = {k.lower(): v for k, v in (_FakeGitHandler.received_headers or {}).items()}
    assert received.get("authorization") == "Bearer irrelevant-for-the-fake-server"
    assert "cookie" not in received


def test_proxy_refuses_a_redirect_to_a_disallowed_host(fake_git_server, proxy_client_for):
    # The proxy follows GET redirects itself (git hosts occasionally 30x
    # `info/refs` for a renamed repo) — this pins that it re-validates the
    # redirect TARGET through the exact same allowlist/SSRF checks as the
    # original request, so a redirect can never launder a request past them.
    host, port = fake_git_server
    client = proxy_client_for(host, port)
    resp = client.get(f"/api/git-proxy/http://{host}:{port}/redirect-to-disallowed")
    assert resp.status_code == 403
    assert resp.text.startswith("VSNOTE-GIT-PROXY-REFUSAL:")
    assert "allowlist" in resp.text


def test_proxy_happy_path_post_against_local_fake_git_server(fake_git_server, proxy_client_for):
    host, port = fake_git_server
    client = proxy_client_for(host, port)

    resp = client.post(
        f"/api/git-proxy/http://{host}:{port}/vault.git/git-upload-pack",
        content=b"0032want deadbeef00000000000000000000deadbeef\n00000009done\n",
        headers={"Content-Type": "application/x-git-upload-pack-request"},
    )
    assert resp.status_code == 200
    assert resp.content == b"0008NAK\n0000"

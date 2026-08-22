"""OAuth sign-in (TODO §8.2) — route + upsert + session contract.

The provider HTTP calls are monkeypatched at the module boundary
(`oauth.exchange_code`), so these tests exercise the real routing, state
signing/verification, user upsert, session cookie, and audit events with
no network. Uses the conftest `make_app` fixture so OAuth settings can be
injected at construction time.
"""
from __future__ import annotations

import urllib.parse as up

import pytest
from fastapi.testclient import TestClient

from app import models
from app.routers import oauth as oauth_module

STATE_COOKIE = "vsnote_oauth_state"


@pytest.fixture
def oauth_app(make_app, monkeypatch):
    """App built with Google OAuth enabled + exchange stubbed."""

    async def fake_exchange(settings, code, redirect_uri):
        assert code == "good-code"
        return {"email": "person@example.com", "email_verified": True}

    monkeypatch.setattr(oauth_module, "exchange_code", fake_exchange)
    return make_app(
        oauth_google_client_id="test-client-id",
        oauth_google_client_secret="test-client-secret",
    )


def _start_and_callback(client: TestClient, code: str = "good-code"):
    start = client.get("/api/auth/oauth/google/start?return_to=/share/x", follow_redirects=False)
    assert start.status_code == 302
    assert start.headers["location"].startswith("https://accounts.google.com/")
    state = up.parse_qs(up.urlparse(start.headers["location"]).query)["state"][0]
    callback = client.get(
        f"/api/auth/oauth/google/callback?code={code}&state={state}",
        follow_redirects=False,
    )
    return start, callback


def test_unconfigured_provider_404s_and_reports_disabled(make_app):
    c = TestClient(make_app())
    assert c.get("/api/auth/oauth/providers").json() == {"google": False}
    assert c.get("/api/auth/oauth/google/start", follow_redirects=False).status_code == 404


def test_start_sets_state_cookie_redirects_and_providers_reports_enabled(oauth_app):
    c = TestClient(oauth_app)
    assert c.get("/api/auth/oauth/providers").json() == {"google": True}
    start = c.get("/api/auth/oauth/google/start?return_to=/share/x", follow_redirects=False)
    assert start.status_code == 302
    assert start.headers["location"].startswith("https://accounts.google.com/")
    cookies = [h.split(";")[0] for h in start.headers.get_list("set-cookie")]
    assert any(h.startswith(STATE_COOKIE) for h in cookies)


def test_callback_upserts_user_sets_session_writes_audit(oauth_app):
    c = TestClient(oauth_app)
    _, callback = _start_and_callback(c)
    assert callback.status_code == 302
    assert callback.headers["location"] == "/share/x"

    who = c.get("/api/auth/whoami").json()
    assert who["authenticated"] is True
    assert who["email"] == "person@example.com"

    # OAuth-only contract: the account can never password-login (the row was
    # created with password_hash=None — auth.py's generic-401 path covers it).
    bad = TestClient(oauth_app).post(
        "/api/auth/login",
        json={"username": "person@example.com", "password": ""},
    )
    assert bad.status_code == 401


def test_state_mismatch_rejected_without_session(oauth_app):
    c = TestClient(oauth_app)
    start = c.get("/api/auth/oauth/google/start?return_to=/share/x", follow_redirects=False)
    state = up.parse_qs(up.urlparse(start.headers["location"]).query)["state"][0]
    tampered = state[:-2] + ("aa" if not state.endswith("aa") else "bb")
    callback = c.get(
        f"/api/auth/oauth/google/callback?code=good-code&state={tampered}",
        follow_redirects=False,
    )
    assert callback.status_code == 302
    assert "login-error" in callback.headers["location"]
    who = c.get("/api/auth/whoami").json()
    assert who["authenticated"] is False


def test_open_redirect_forced_root_relative(oauth_app):
    c = TestClient(oauth_app)
    evil = "https://evil.example.com/grab"
    start = c.get(
        "/api/auth/oauth/google/start?return_to=" + up.quote(evil, safe=""),
        follow_redirects=False,
    )
    state = up.parse_qs(up.urlparse(start.headers["location"]).query)["state"][0]
    callback = c.get(f"/api/auth/oauth/google/callback?code=good-code&state={state}", follow_redirects=False)
    assert callback.headers["location"].startswith("/")

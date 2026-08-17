"""`GET /api/app-config` — the public contract behind Phase 17's app-wide
login gate. See `app/routers/app_config.py`'s module docstring for the
reasoning each case below pins."""

from __future__ import annotations

from app import models, security

from conftest import OWNER_PASSWORD, OWNER_USERNAME


def _add_user(app, *, with_password: bool = True) -> None:
    db = app.state.SessionLocal()
    try:
        db.add(
            models.User(
                username=OWNER_USERNAME,
                password_hash=security.hash_password(OWNER_PASSWORD) if with_password else None,
                email=None,
                is_admin=True,
            )
        )
        db.commit()
    finally:
        db.close()


def test_app_config_is_public_and_carries_no_secrets(client):
    res = client.get("/api/app-config")
    assert res.status_code == 200  # no auth of any kind sent
    body = res.json()
    assert set(body) == {"login_required", "password_login", "cf_access"}
    assert all(isinstance(v, bool) for v in body.values())


def test_no_credential_path_means_no_gate(client):
    """The "never lock the owner out" clause: a deployment with no account
    and no Cf-Access cannot satisfy a login prompt, so it is not gated."""
    body = client.get("/api/app-config").json()
    assert body == {"login_required": False, "password_login": False, "cf_access": False}


def test_a_local_account_turns_the_gate_on(app, client):
    _add_user(app)
    body = client.get("/api/app-config").json()
    assert body["password_login"] is True
    assert body["login_required"] is True


def test_cf_access_alone_turns_the_gate_on(make_app):
    from fastapi.testclient import TestClient

    app = make_app(cf_access_team_domain="team.cloudflareaccess.com", cf_access_aud="aud-tag")
    body = TestClient(app).get("/api/app-config").json()
    assert body["cf_access"] is True
    assert body["password_login"] is False  # no local account at all
    assert body["login_required"] is True


def test_require_login_false_is_the_explicit_off_switch(make_app):
    from fastapi.testclient import TestClient

    app = make_app(require_login=False)
    _add_user(app)
    body = TestClient(app).get("/api/app-config").json()
    assert body["password_login"] is True  # a credential path exists...
    assert body["login_required"] is False  # ...and the operator still opted out


def test_sso_only_user_without_a_password_is_not_a_password_login(app, client):
    """A Cf-Access-provisioned row has `password_hash IS NULL` and cannot
    satisfy the username+password form, so it must not advertise one."""
    _add_user(app, with_password=False)
    body = client.get("/api/app-config").json()
    assert body["password_login"] is False
    assert body["login_required"] is False  # nothing can satisfy a prompt here


def test_no_cors_headers(client):
    res = client.get("/api/app-config", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in res.headers}

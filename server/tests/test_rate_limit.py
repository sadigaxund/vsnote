"""Rate limiting (slowapi), with a low limit injected via config override so
the test doesn't need to fire hundreds of requests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import models, security
from conftest import publish_share, random_wellformed_slug


def test_share_auth_endpoint_rate_limited(make_app, make_settings):
    settings = make_settings(rate_limit_share_auth="2/minute")
    app = make_app(settings=settings)
    owner_client = TestClient(app)

    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com"))
    db.commit()
    db.close()
    owner_client.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")

    anon = TestClient(app)
    r1 = anon.post(f"/share/{share['slug']}/auth", json={"password": "wrong"})
    r2 = anon.post(f"/share/{share['slug']}/auth", json={"password": "wrong"})
    r3 = anon.post(f"/share/{share['slug']}/auth", json={"password": "wrong"})

    assert r1.status_code == 404
    assert r2.status_code == 404
    assert r3.status_code == 429


def test_rate_limit_response_does_not_leak_existence(make_app, make_settings):
    """A 429 must not distinguish a real slug from a made-up one either."""
    settings = make_settings(rate_limit_share_auth="1/minute")
    app = make_app(settings=settings)
    anon = TestClient(app)

    slug = random_wellformed_slug()
    anon.post(f"/share/{slug}/auth", json={"password": "x"})  # consumes the 1 allowed hit
    r = anon.post(f"/share/{slug}/auth", json={"password": "x"})
    assert r.status_code == 429


def test_login_endpoint_rate_limited(make_app, make_settings):
    settings = make_settings(rate_limit_share_auth="2/minute")
    app = make_app(settings=settings)

    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com"))
    db.commit()
    db.close()

    anon = TestClient(app)
    for _ in range(2):
        r = anon.post("/api/auth/login", json={"username": "owner", "password": "wrong"})
        assert r.status_code == 401
    r = anon.post("/api/auth/login", json={"username": "owner", "password": "wrong"})
    assert r.status_code == 429

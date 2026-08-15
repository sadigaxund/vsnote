"""Fallback login, session cookies, whoami, and Cf-Access JWT verification
(roadmap §2)."""

from __future__ import annotations

import json
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from conftest import OWNER_EMAIL, OWNER_PASSWORD, OWNER_USERNAME


def test_login_success_sets_cookie(client, owner):
    r = client.post("/api/auth/login", json={"username": OWNER_USERNAME, "password": OWNER_PASSWORD})
    assert r.status_code == 200
    assert r.json()["username"] == OWNER_USERNAME
    assert "slate_session" in client.cookies


def test_login_unknown_user_and_wrong_password_are_identical(client, owner):
    unknown = client.post("/api/auth/login", json={"username": "nobody-like-this", "password": "whatever123"})
    wrong = client.post("/api/auth/login", json={"username": OWNER_USERNAME, "password": "definitely-wrong-pw"})

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_whoami_unauthenticated(client):
    r = client.get("/api/auth/whoami")
    assert r.status_code == 200
    assert r.json()["authenticated"] is False


def test_whoami_authenticated(owner_client):
    r = owner_client.get("/api/auth/whoami")
    assert r.status_code == 200
    body = r.json()
    assert body["authenticated"] is True
    assert body["username"] == OWNER_USERNAME
    assert body["source"] == "session"


def test_logout_clears_session(owner_client):
    r = owner_client.post("/api/auth/logout")
    assert r.status_code == 200
    r2 = owner_client.get("/api/auth/whoami")
    assert r2.json()["authenticated"] is False


def test_magic_link_stub_returns_501(client):
    r = client.post("/api/auth/magic-link", json={"email": "x@example.com"})
    assert r.status_code == 501


# --- Cf-Access JWT verification -------------------------------------------


def _make_rsa_keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key, key.public_key()


def _jwk_from_public_key(pub, kid: str) -> dict:
    numbers = pub.public_numbers()

    def b64url_uint(n: int) -> str:
        import base64

        length = (n.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(n.to_bytes(length, "big")).decode("ascii").rstrip("=")

    return {
        "kty": "RSA",
        "kid": kid,
        "use": "sig",
        "alg": "RS256",
        "n": b64url_uint(numbers.n),
        "e": b64url_uint(numbers.e),
    }


def _sign_jwt(private_key, kid: str, claims: dict) -> str:
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": kid})


def test_cf_access_valid_jwt_accepted_and_auto_provisions_user(make_app, make_settings):
    real_key, real_pub = _make_rsa_keypair()
    settings = make_settings(cf_access_team_domain="example.cloudflareaccess.com", cf_access_aud="test-aud")
    app = make_app(settings=settings)
    app.state.cf_jwks_fetcher.override = lambda: {"keys": [_jwk_from_public_key(real_pub, "kid-1")]}

    from fastapi.testclient import TestClient

    client = TestClient(app)
    now = int(time.time())
    token = _sign_jwt(
        real_key,
        "kid-1",
        {
            "email": "sso-user@example.com",
            "iss": "https://example.cloudflareaccess.com",
            "aud": "test-aud",
            "iat": now,
            "exp": now + 300,
        },
    )
    r = client.get("/api/auth/whoami", headers={"Cf-Access-Jwt-Assertion": token})
    assert r.status_code == 200
    body = r.json()
    assert body["authenticated"] is True
    assert body["email"] == "sso-user@example.com"
    assert body["source"] == "cf_access"


def test_cf_access_forged_jwt_rejected(make_app, make_settings):
    real_key, real_pub = _make_rsa_keypair()
    forged_key, _ = _make_rsa_keypair()  # attacker's own keypair, NOT trusted
    settings = make_settings(cf_access_team_domain="example.cloudflareaccess.com", cf_access_aud="test-aud")
    app = make_app(settings=settings)
    # Server only knows about the REAL public key.
    app.state.cf_jwks_fetcher.override = lambda: {"keys": [_jwk_from_public_key(real_pub, "kid-1")]}

    from fastapi.testclient import TestClient

    client = TestClient(app)
    now = int(time.time())
    forged = _sign_jwt(
        forged_key,
        "kid-1",  # same kid, different (attacker) key — signature must not verify
        {
            "email": "attacker@example.com",
            "iss": "https://example.cloudflareaccess.com",
            "aud": "test-aud",
            "iat": now,
            "exp": now + 300,
        },
    )
    r = client.get("/api/auth/whoami", headers={"Cf-Access-Jwt-Assertion": forged})
    assert r.status_code == 200
    assert r.json()["authenticated"] is False  # rejected, not trusted


def test_cf_access_unauthenticated_email_header_alone_is_never_trusted(client):
    # The unsigned "Cf-Access-Authenticated-User-Email" header must never be
    # trusted by itself — only the verified JWT claims count.
    r = client.get("/api/auth/whoami", headers={"Cf-Access-Authenticated-User-Email": "admin@example.com"})
    assert r.status_code == 200
    assert r.json()["authenticated"] is False


def test_cf_access_unconfigured_server_does_not_accept_assertions(client):
    # Default test settings have no CF_ACCESS_TEAM_DOMAIN/AUD configured.
    # A present (even well-formed-looking) assertion must be ignored
    # entirely — "not configured" is NOT an implicit allow.
    fake_jwt = jwt.encode({"email": "whoever@example.com"}, "not-even-checked", algorithm="HS256")
    r = client.get("/api/auth/whoami", headers={"Cf-Access-Jwt-Assertion": fake_jwt})
    assert r.status_code == 200
    assert r.json()["authenticated"] is False

"""API token issuance, hashing-at-rest, listing, and revocation."""

from __future__ import annotations

from app import models, security


def test_token_plaintext_never_stored(owner_client, app):
    r = owner_client.post("/api/auth/tokens", json={"name": "ci-script", "scope": "read"})
    assert r.status_code == 201
    plaintext = r.json()["token"]
    assert plaintext.startswith("slt_")

    db = app.state.SessionLocal()
    try:
        rows = db.query(models.ApiToken).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.token_hash == security.hash_token(plaintext)
        assert row.token_hash != plaintext
        # Defense in depth: the plaintext substring must not appear ANYWHERE
        # in the stored row's own fields.
        assert plaintext not in (row.token_hash, row.prefix, row.name)
    finally:
        db.close()


def test_list_tokens_never_returns_secret(owner_client):
    create = owner_client.post("/api/auth/tokens", json={"name": "ci-script", "scope": "read"})
    plaintext = create.json()["token"]

    listed = owner_client.get("/api/auth/tokens")
    assert listed.status_code == 200
    body = listed.json()
    assert len(body) == 1
    assert "token" not in body[0]
    assert plaintext not in str(body)
    assert body[0]["prefix"] == plaintext[:12]


def test_revoked_token_rejected_on_owner_api(owner_client, anon_client):
    create = owner_client.post("/api/auth/tokens", json={"name": "ci-script", "scope": "share-admin"})
    token_id = create.json()["id"]
    plaintext = create.json()["token"]

    owner_client.delete(f"/api/auth/tokens/{token_id}")

    files = {"file": ("note.md", b"hi", "text/markdown")}
    r = anon_client.post("/api/blobs", files=files, headers={"Authorization": f"Bearer {plaintext}"})
    assert r.status_code == 401  # no valid identity at all once revoked


def test_expired_token_rejected(owner_client, anon_client):
    import time

    create = owner_client.post(
        "/api/auth/tokens", json={"name": "short-lived", "scope": "share-admin", "expires_at": time.time() - 5}
    )
    plaintext = create.json()["token"]

    files = {"file": ("note.md", b"hi", "text/markdown")}
    r = anon_client.post("/api/blobs", files=files, headers={"Authorization": f"Bearer {plaintext}"})
    assert r.status_code == 401

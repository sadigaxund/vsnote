"""R5-6 "Update share": the PATCH blob-swap (`/api/shares/{id}`,
`blob_id`), the owner-only exposure of a share's content hash
(`ShareOut.blob_id`, itself `models.Blob.id` = sha256 hex of the content —
see models.py's docstring), and the negative proof that hash never reaches
a visitor through any public `/share/*` surface.
"""

from __future__ import annotations

import hashlib

from conftest import publish_share


def test_patch_blob_id_swaps_blob_and_preserves_everything_else(owner_client):
    share = publish_share(
        owner_client,
        content=b"original content",
        alias="stays-put",
        auth_mode="none",
        expires_at=4102444800,
        back_link=None,
    )
    original_slug = share["slug"]
    original_alias = share["alias"]
    original_auth_mode = share["auth_mode"]
    original_expires_at = share["expires_at"]
    original_general_access = share["general_access"]

    new_content = b"refreshed content, brand new bytes"
    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", new_content, "text/markdown")}
    ).json()["id"]
    assert new_blob_id == hashlib.sha256(new_content).hexdigest()
    assert new_blob_id != share["blob_id"]

    r = owner_client.patch(f"/api/shares/{share['id']}", json={"blob_id": new_blob_id})
    assert r.status_code == 200
    body = r.json()

    # The one thing that changed.
    assert body["blob_id"] == new_blob_id

    # Everything R5-6 requires untouched.
    assert body["slug"] == original_slug
    assert body["alias"] == original_alias
    assert body["auth_mode"] == original_auth_mode
    assert body["expires_at"] == original_expires_at
    assert body["general_access"] == original_general_access
    assert body["back_link"] is None

    # The public route now serves the NEW content.
    fetched = owner_client.get(f"/share/{original_slug}")
    assert fetched.content == new_content


def test_patch_blob_id_preserves_back_link(owner_client):
    target = publish_share(owner_client, content=b"target doc", alias="link-target")
    share = publish_share(owner_client, content=b"has a back link", back_link="link-target")
    assert share["back_link"] == "link-target"

    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", b"updated body", "text/markdown")}
    ).json()["id"]
    r = owner_client.patch(f"/api/shares/{share['id']}", json={"blob_id": new_blob_id})
    assert r.status_code == 200
    assert r.json()["back_link"] == "link-target"
    assert target["id"] is not None  # keep the fixture referenced/used


def test_patch_blob_id_writes_refresh_audit_event(owner_client, db_session):
    from app import models

    share = publish_share(owner_client, content=b"v1")
    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", b"v2", "text/markdown")}
    ).json()["id"]

    r = owner_client.patch(f"/api/shares/{share['id']}", json={"blob_id": new_blob_id})
    assert r.status_code == 200

    events = (
        db_session.query(models.AuditEvent)
        .filter(models.AuditEvent.event == "share.refresh", models.AuditEvent.slug == share["slug"])
        .all()
    )
    assert len(events) == 1
    # A refresh audit event must never be logged as a generic policy edit.
    assert events[0].reason != "policy_edit"


def test_patch_blob_id_unknown_blob_404s(owner_client):
    share = publish_share(owner_client)
    r = owner_client.patch(f"/api/shares/{share['id']}", json={"blob_id": "f" * 64})
    assert r.status_code == 404


def test_patch_blob_id_rejects_non_owner(owner_client, anon_client, db_session):
    from app import models, security

    other = models.User(username="other", password_hash=security.hash_password("otherpw123"), email="other@example.com")
    db_session.add(other)
    db_session.commit()

    share = publish_share(owner_client, content=b"owner's content")
    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", b"attacker's bytes", "text/markdown")}
    ).json()["id"]

    anon_client.post("/api/auth/login", json={"username": "other", "password": "otherpw123"})
    r = anon_client.patch(f"/api/shares/{share['id']}", json={"blob_id": new_blob_id})
    # Uniform "not yours" 404 — same posture as every other /shares/{id}
    # owner-scoped route (never a 403, which would confirm the row exists).
    assert r.status_code == 404

    unchanged = owner_client.get("/api/shares").json()
    row = next(s for s in unchanged if s["id"] == share["id"])
    assert row["blob_id"] == share["blob_id"]


def test_patch_blob_id_rejects_read_scope_token(owner_client, anon_client):
    tr = owner_client.post("/api/auth/tokens", json={"name": "readonly", "scope": "read"})
    token = tr.json()["token"]
    share = publish_share(owner_client)
    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", b"v2", "text/markdown")}
    ).json()["id"]

    r = anon_client.patch(
        f"/api/shares/{share['id']}",
        json={"blob_id": new_blob_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_patch_blob_id_rejects_write_scope_token(owner_client, anon_client):
    """`patch_share` requires the `share-admin` scope specifically — a
    plain `write`-scoped token (fine for blob uploads/vault-facing writes)
    must not be enough to repoint a share, same as it can't publish one."""
    tr = owner_client.post("/api/auth/tokens", json={"name": "writer", "scope": "write"})
    token = tr.json()["token"]
    share = publish_share(owner_client)
    new_blob_id = owner_client.post(
        "/api/blobs", files={"file": ("note.md", b"v2", "text/markdown")}
    ).json()["id"]

    r = anon_client.patch(
        f"/api/shares/{share['id']}",
        json={"blob_id": new_blob_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


# --- Owner-only hash exposure ------------------------------------------


def test_owner_list_and_patch_response_expose_blob_id(owner_client):
    """The owner surfaces (`GET /api/shares`, and the `ShareOut` any
    create/patch/regenerate response returns) are exactly where R5-6 says
    the content hash SHOULD appear — this is the positive half of the
    hash-exposure contract, the negative half is below."""
    share = publish_share(owner_client)
    assert "blob_id" in share
    assert share["blob_id"] == hashlib.sha256(b"hello world").hexdigest()

    listed = owner_client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share["id"])
    assert row["blob_id"] == share["blob_id"]


def _find_hash_leak(obj, needle: str) -> bool:
    """Recursively hunts a decoded JSON body for the exact hash string,
    anywhere — not just under a `blob_id` key — so this test still catches
    a rename/relocation of the field, not merely its current name."""
    if isinstance(obj, str):
        return needle in obj
    if isinstance(obj, dict):
        return any(_find_hash_leak(v, needle) for v in obj.values())
    if isinstance(obj, list):
        return any(_find_hash_leak(v, needle) for v in obj)
    return False


def test_public_content_and_raw_never_expose_blob_hash(owner_client):
    content = b"content whose hash must never leak to a visitor"
    content_hash = hashlib.sha256(content).hexdigest()
    share = publish_share(owner_client, content=content, render_mode="rendered", auth_mode="none", general_access="link")
    assert share["blob_id"] == content_hash

    # JSON content contract, root route.
    r_json = owner_client.get(f"/share/{share['slug']}", headers={"Accept": "application/json"})
    assert r_json.status_code == 200
    assert not _find_hash_leak(r_json.json(), content_hash)
    assert "blob_id" not in r_json.json()

    # JSON content contract, the /api-mounted CORS twin.
    r_cors = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r_cors.status_code == 200
    assert not _find_hash_leak(r_cors.json(), content_hash)
    assert "blob_id" not in r_cors.json()

    # Raw bytes response — headers only carry the fixed security set, body
    # is the content itself (which legitimately contains the plaintext,
    # but never the hash string, and no header ever names it).
    raw_share = publish_share(owner_client, content=content, render_mode="raw", auth_mode="none", general_access="link")
    r_raw = owner_client.get(f"/share/{raw_share['slug']}")
    assert r_raw.status_code == 200
    for header_value in r_raw.headers.values():
        assert content_hash not in header_value

    # Editor write-back PUT response.
    from conftest import OWNER_EMAIL

    editable = publish_share(
        owner_client,
        content=b"editable original",
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r_put = owner_client.put(f"/share/{editable['slug']}", content=b"editable updated")
    assert r_put.status_code == 200
    new_hash = hashlib.sha256(b"editable updated").hexdigest()
    assert not _find_hash_leak(r_put.json(), new_hash)
    assert "blob_id" not in r_put.json()


def test_uniform_404_deny_paths_unchanged_by_hash_removal(owner_client, anon_client):
    """The R5-6 changes above touch only success-path payload shapes —
    every deny reason must still collapse to the exact same uniform 404
    body (see policy.py's module docstring)."""
    bogus = anon_client.get("/share/does-not-exist-00000000000000")
    assert bogus.status_code == 404
    assert bogus.json() == {"detail": "Not found"}

    share = publish_share(owner_client)
    revoke = owner_client.delete(f"/api/shares/{share['id']}")
    assert revoke.status_code == 200
    revoked_get = anon_client.get(f"/share/{share['slug']}")
    assert revoked_get.status_code == 404
    assert revoked_get.json() == {"detail": "Not found"}

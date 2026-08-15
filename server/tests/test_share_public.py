"""The rendered-mode JSON contract (both delivery paths) and the editor
write-back PUT."""

from __future__ import annotations

from conftest import publish_share


def test_json_contract_via_accept_header(owner_client):
    share = publish_share(owner_client, content=b"# Hello\n\nrendered content", render_mode="rendered")
    r = owner_client.get(f"/share/{share['slug']}", headers={"Accept": "application/json"})
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == share["slug"]
    assert body["content"] == "# Hello\n\nrendered content"
    assert body["content_encoding"] == "utf-8"
    assert body["render_mode"] == "rendered"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_json_contract_via_dedicated_content_route_under_api(owner_client):
    share = publish_share(owner_client, content=b"plain body text", render_mode="rendered")
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "plain body text"

    # This route lives under /api — CORS must apply (unlike raw /share/*).
    r2 = owner_client.get(
        f"/api/share/{share['slug']}/content", headers={"Origin": "http://127.0.0.1:5290"}
    )
    assert r2.headers.get("access-control-allow-origin") == "http://127.0.0.1:5290"


def test_json_contract_binary_content_base64_fallback(owner_client):
    binary = bytes(range(256))
    share = publish_share(owner_client, content=binary, render_mode="rendered")
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    body = r.json()
    assert body["content_encoding"] == "base64"
    import base64

    assert base64.b64decode(body["content"]) == binary


def test_put_editor_writeback_creates_new_blob(owner_client):
    from conftest import OWNER_EMAIL

    share = publish_share(
        owner_client, general_access="link", auth_mode="none", grants=[{"principal": OWNER_EMAIL, "role": "editor"}]
    )
    r = owner_client.put(f"/share/{share['slug']}", content=b"brand new content")
    assert r.status_code == 200
    new_blob_id = r.json()["blob_id"]
    assert new_blob_id != share["blob_id"]

    fetched = owner_client.get(f"/share/{share['slug']}")
    assert fetched.content == b"brand new content"

    # Owner's share record reflects the new pinned blob.
    listed = owner_client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share["id"])
    assert row["blob_id"] == new_blob_id

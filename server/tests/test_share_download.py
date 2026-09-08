"""R5-4 — `?download=1` auth/password/token parity for `GET /share/{id}`.

The download client (R5-4's file-header Download button,
`src/share/api.ts::fetchShareRawBlob`) hits the EXACT same route as every
other raw/JSON GET here; `_wants_download` only flips the response's
`Content-Disposition` header (`inline` -> `attachment`), and only AFTER
`_resolve_get`/`policy.resolve_share` has already succeeded (see
`share_public.py`'s module docstring and `get_share`'s own body — the
`try/except policy.PolicyDenied` block wraps `_resolve_get` alone, with
`?download=1` never even read until after that block returns normally).
These tests prove there is no second, weaker gate hiding behind the query
param: every deny reason produces the SAME uniform 404 with or without
`?download=1`, and a successful download never emits anything but the two
allowed raw Content-Types (never `text/html`)."""

from __future__ import annotations

import time

from conftest import OWNER_EMAIL, publish_share

NOT_FOUND = {"detail": "Not found"}


# --- Deny-parity: every existing test_policy_gate.py deny scenario, ------
# --- replayed with ?download=1 appended -----------------------------------


def test_download_missing_slug_404(anon_client):
    r = anon_client.get("/share/does-not-exist-at-all?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_revoked_404(owner_client):
    share = publish_share(owner_client)
    r = owner_client.delete(f"/api/shares/{share['id']}")
    assert r.status_code == 200
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_expired_404(owner_client):
    share = publish_share(owner_client, expires_at=time.time() - 60)
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_restricted_without_identity_404(owner_client, anon_client):
    share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "friend@example.com", "role": "viewer"}],
    )
    r = anon_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_restricted_with_correct_identity_200(owner_client):
    share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "viewer"}],
    )
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment;")


def test_download_password_get_without_session_is_404(owner_client):
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw", render_mode="rendered")
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_password_right_session_then_download_200(anon_client, owner_client):
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw", render_mode="rendered")
    auth = anon_client.post(f"/share/{share['slug']}/auth", json={"password": "s3cret-pw"})
    assert auth.status_code == 200, auth.text

    r = anon_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 200
    assert r.content == b"hello world"
    assert r.headers["content-disposition"] == 'attachment; filename="x.md"'


def test_download_token_mode_missing_token_404(owner_client):
    share = publish_share(owner_client, auth_mode="token")
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_token_mode_invalid_token_404(owner_client):
    share = publish_share(owner_client, auth_mode="token")
    r = owner_client.get(
        f"/share/{share['slug']}?download=1", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_download_token_mode_valid_token_200_then_revoked_404(owner_client, anon_client):
    share = publish_share(owner_client, auth_mode="token")
    tr = owner_client.post(f"/api/shares/{share['id']}/tokens", json={"label": "script"})
    assert tr.status_code == 201, tr.text
    plaintext = tr.json()["token"]
    token_id = tr.json()["id"]

    r = anon_client.get(
        f"/share/{share['slug']}?download=1", headers={"Authorization": f"Bearer {plaintext}"}
    )
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment;")

    revoke = owner_client.delete(f"/api/shares/{share['id']}/tokens/{token_id}")
    assert revoke.status_code == 200

    r2 = anon_client.get(
        f"/share/{share['slug']}?download=1", headers={"Authorization": f"Bearer {plaintext}"}
    )
    assert r2.status_code == 404
    assert r2.json() == NOT_FOUND


def test_download_viewer_role_200_but_put_still_denied(owner_client):
    """`?download=1` only ever appears on GET — this just confirms a viewer
    (no editor grant) can download exactly like they can read, and the
    read/write role split is completely untouched by the query param."""
    share = publish_share(owner_client, general_access="link", auth_mode="none")
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 200

    put = owner_client.put(f"/share/{share['slug']}?download=1", content=b"new content")
    assert put.status_code == 404
    assert put.json() == NOT_FOUND


# --- Content-type / disposition parity ------------------------------------


def test_download_never_emits_text_html_even_for_html_payload(owner_client):
    malicious = b"<html><body><script>alert(1)</script></body></html>"
    share = publish_share(owner_client, content=malicious, source_path="notes/page.html")
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.status_code == 200
    assert r.headers["content-type"] in ("text/plain; charset=utf-8", "application/octet-stream")
    assert "html" not in r.headers["content-type"]
    assert r.headers["content-disposition"] == 'attachment; filename="page.html"'
    assert r.content == malicious


def test_download_binary_content_type_matches_inline(owner_client):
    """The Content-Type sniff itself is identical whether or not the
    request downloads — only the disposition differs."""
    binary = bytes(range(256))
    share = publish_share(owner_client, content=binary, source_path="notes/image.png")
    inline = owner_client.get(f"/share/{share['slug']}")
    download = owner_client.get(f"/share/{share['slug']}?download=1")
    assert inline.headers["content-type"] == download.headers["content-type"] == "application/octet-stream"
    assert inline.headers["content-disposition"] == 'inline; filename="image.png"'
    assert download.headers["content-disposition"] == 'attachment; filename="image.png"'
    assert inline.content == download.content == binary


def test_download_security_headers_unchanged(owner_client):
    share = publish_share(owner_client, content=b"anything")
    r = owner_client.get(f"/share/{share['slug']}?download=1")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


def test_download_json_accept_still_returns_json_not_raw(owner_client):
    """`?download=1` is meaningless on the JSON contract path — a caller
    that explicitly asks for JSON keeps getting JSON, never raw bytes with
    an attachment disposition, regardless of the query param."""
    share = publish_share(owner_client, content=b"hello world", render_mode="rendered")
    r = owner_client.get(f"/share/{share['slug']}?download=1", headers={"Accept": "application/json"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert body["content"] == "hello world"

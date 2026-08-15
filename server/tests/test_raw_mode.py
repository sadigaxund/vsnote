"""Raw-mode content-type safety (roadmap §1): never text/html, always
nosniff, never any CORS headers."""

from __future__ import annotations

from conftest import publish_share


def test_raw_never_html_even_for_html_payload_with_script_tag(owner_client):
    malicious = b"<html><body><script>alert(1)</script></body></html>"
    share = publish_share(owner_client, content=malicious, media_type_hint="html")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff"
    # The bytes are served verbatim (never executed) — inline, not attached.
    assert r.content == malicious
    assert r.headers["content-disposition"] == "inline"


def test_raw_csp_header_present(owner_client):
    share = publish_share(owner_client, content=b"anything")
    r = owner_client.get(f"/share/{share['slug']}")
    assert "default-src 'none'" in r.headers["content-security-policy"]


def test_no_cors_on_raw(owner_client, anon_client):
    share = publish_share(owner_client, content=b"anything")
    r = anon_client.get(f"/share/{share['slug']}", headers={"Origin": "http://evil.example"})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers.keys()}


def test_no_cors_on_raw_even_for_allowed_spa_origin(owner_client, anon_client):
    # Even the SPA's OWN allowed origin gets no CORS headers on /share/* —
    # CORS is scoped exclusively to /api/* (roadmap §1 + §2).
    share = publish_share(owner_client, content=b"anything")
    r = anon_client.get(f"/share/{share['slug']}", headers={"Origin": "http://127.0.0.1:5290"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers.keys()}


def test_cors_wildcard_is_structurally_impossible(make_app, make_settings):
    # Even a misconfigured SLATE_CORS_ORIGINS="*" must never produce a real
    # wildcard: config.py's cors_origin_list drops a literal "*" before it
    # can reach CORSMiddleware. Prove it by hitting the CORS-enabled /api
    # surface from a totally arbitrary, untrusted Origin and confirming no
    # Access-Control-Allow-Origin is echoed back for it.
    settings = make_settings(cors_origins="*")
    assert settings.cors_origin_list == []
    app = make_app(settings=settings)
    from fastapi.testclient import TestClient

    client = TestClient(app)
    r = client.get("/api/auth/whoami", headers={"Origin": "http://totally-untrusted.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers.keys()}

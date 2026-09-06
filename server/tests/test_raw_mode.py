"""Raw-mode content-type safety (roadmap §1 / §4.1): never text/html,
always nosniff, never any CORS headers. Content-Type is exactly one of
`text/plain; charset=utf-8` or `application/octet-stream`, decided by
sniffing the blob — never `media_type_hint`, never derived from the
extension alone."""

from __future__ import annotations

from conftest import publish_share


def test_raw_binary_content_gets_octet_stream(owner_client):
    binary = bytes(range(256))
    share = publish_share(owner_client, content=binary, source_path="notes/image.png")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.content == binary


def test_raw_text_content_stays_text_plain(owner_client):
    share = publish_share(owner_client, content=b"just plain text\n", source_path="notes/x.md")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"


def test_raw_extension_alone_never_produces_html(owner_client):
    """A `.html` source_path is a pure display label — it must never make
    this endpoint emit `text/html` (the one thing raw mode must never do,
    full stop)."""
    share = publish_share(owner_client, content=b"<b>just text</b>", source_path="notes/page.html")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    assert r.headers["content-type"] in ("text/plain; charset=utf-8", "application/octet-stream")
    assert "html" not in r.headers["content-type"]


def test_raw_disposition_inline_by_default_and_attachment_on_download(owner_client):
    share = publish_share(owner_client, content=b"hi", source_path="notes/report.md")
    inline = owner_client.get(f"/share/{share['slug']}")
    assert inline.headers["content-disposition"] == 'inline; filename="report.md"'

    attach = owner_client.get(f"/share/{share['slug']}?download=1")
    assert attach.headers["content-disposition"] == 'attachment; filename="report.md"'


def test_raw_disposition_filename_is_escaped_and_never_contains_a_slash(owner_client):
    share = publish_share(owner_client, content=b"hi", source_path='notes/weird "na/me\x07.md')
    r = owner_client.get(f"/share/{share['slug']}")
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("inline; filename=")
    # The rendered filename is quote-escaped and slash-free.
    filename_value = disposition.split("filename=", 1)[1]
    assert "/" not in filename_value.strip('"').replace('\\"', "")


def test_raw_disposition_falls_back_to_slug_when_basename_sanitizes_empty(owner_client):
    share = publish_share(owner_client, content=b"hi", source_path="///")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.headers["content-disposition"] == f'inline; filename="{share["slug"]}"'


def test_raw_never_html_even_for_html_payload_with_script_tag(owner_client):
    malicious = b"<html><body><script>alert(1)</script></body></html>"
    share = publish_share(owner_client, content=malicious, media_type_hint="html")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff"
    # The bytes are served verbatim (never executed) — inline, not attached.
    assert r.content == malicious
    assert r.headers["content-disposition"].startswith("inline;")


def test_raw_csp_header_present(owner_client):
    share = publish_share(owner_client, content=b"anything")
    r = owner_client.get(f"/share/{share['slug']}")
    assert "default-src 'none'" in r.headers["content-security-policy"]


def test_no_cors_on_raw(owner_client, anon_client):
    share = publish_share(owner_client, content=b"anything")
    r = anon_client.get(f"/share/{share['slug']}", headers={"Origin": "http://evil.example"})
    assert r.status_code == 200
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


def test_no_cors_on_raw_even_for_allowed_spa_origin(owner_client, anon_client):
    # Single-origin refactor (roadmap §5.4): there is no more "allowed SPA
    # origin" allow-list at all — CORSMiddleware is gone from every route,
    # not just scoped away from /share/*. Even the SPA's own real origin
    # gets zero access-control-* headers here (nor anywhere else — see
    # `test_share_public.py`/`test_git_sync.py`'s equivalent assertions for
    # the former /api and /git surfaces).
    share = publish_share(owner_client, content=b"anything")
    r = anon_client.get(f"/share/{share['slug']}", headers={"Origin": "http://127.0.0.1:5290"})
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


def test_no_cors_headers_anywhere_even_for_arbitrary_origin(make_app, make_settings):
    # Single-origin refactor (roadmap §5.4): CORSMiddleware was removed
    # entirely (no more configurable allow-list to misconfigure into a
    # wildcard — this test used to prove that narrower property; the
    # property it proves now is strictly stronger). Hit the /api surface
    # from a totally arbitrary, untrusted Origin and confirm NO
    # access-control-* header of any kind comes back.
    app = make_app(settings=make_settings())
    from fastapi.testclient import TestClient

    client = TestClient(app)
    r = client.get("/api/auth/whoami", headers={"Origin": "http://totally-untrusted.example"})
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())

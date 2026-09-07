"""feat(share) R4 — `GET`/`PUT /api/reader-prefs` (owner-side "Reader
appearance" settings) and the "included only on a successful share content
fetch, never on shell/deny" rule for `ShareContentOut.reader_prefs`.
"""

from __future__ import annotations

from conftest import publish_share


def test_get_defaults_when_never_saved(owner_client):
    r = owner_client.get("/api/reader-prefs")
    assert r.status_code == 200
    assert r.json() == {"theme": "system", "font_size": "m", "code_wrap": True, "column_width": None}


def test_put_then_get_round_trips(owner_client):
    payload = {"theme": "dark", "font_size": "l", "code_wrap": False, "column_width": "wide"}
    r = owner_client.put("/api/reader-prefs", json=payload)
    assert r.status_code == 200
    assert r.json() == payload

    r2 = owner_client.get("/api/reader-prefs")
    assert r2.status_code == 200
    assert r2.json() == payload


def test_put_rejects_a_value_outside_the_closed_enum(owner_client):
    r = owner_client.put(
        "/api/reader-prefs",
        json={"theme": "purple", "font_size": "m", "code_wrap": True, "column_width": None},
    )
    assert r.status_code == 422


def test_anonymous_get_denied(anon_client):
    r = anon_client.get("/api/reader-prefs")
    assert r.status_code == 401


def test_rendered_share_content_includes_the_owner_prefs(owner_client):
    owner_client.put("/api/reader-prefs", json={"theme": "dark", "font_size": "s", "code_wrap": False, "column_width": "full"})
    share = publish_share(owner_client, content=b"# Hello", render_mode="rendered")

    r = owner_client.get(f"/share/{share['slug']}", headers={"Accept": "application/json"})
    assert r.status_code == 200
    assert r.json()["reader_prefs"] == {"theme": "dark", "font_size": "s", "code_wrap": False, "column_width": "full"}


def test_reader_prefs_absent_from_deny_response(owner_client, anon_client):
    owner_client.put("/api/reader-prefs", json={"theme": "dark", "font_size": "s", "code_wrap": False, "column_width": "full"})
    # A slug that was never published — the uniform-404 deny path never
    # constructs a `ShareContentOut` at all, so nothing about the owner's
    # prefs (or even that such a thing exists) can leak through it.
    r = anon_client.get("/share/does-not-exist", headers={"Accept": "application/json"})
    assert r.status_code == 404
    assert "reader_prefs" not in r.text

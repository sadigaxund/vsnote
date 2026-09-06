"""Phase 10.5a widening (roadmap §5.4, `app/routers/share_public.py`'s
`_deny_response`/`_spa_shell_response`): a real browser navigation
(`Accept: text/html`) to `GET /share/{id}` must get the built SPA's shell
for EVERY deny reason as well as a successful rendered-mode share — never
the JSON 404, never anything content-dependent. The
`Accept: application/json` (and no-`Accept`-header) path must be completely
unaffected: the byte-identical uniform 404 for every deny reason, and the
real content for a success, exactly as `test_policy_gate.py`'s own
equivalence-matrix tests already pin (those tests use httpx's default,
which sends no `Accept` header at all, so they never exercised this file's
new branch either way — this file is the dedicated coverage for the branch
itself).

`app.state.spa_index_html` is set directly on the test app instance rather
than relying on a real `dist/` build being present on disk — this is
deliberate: it makes these tests hermetic (no dependency on `npm run
build` having run before `pytest`) and lets `test_falls_back_to_json_deny_
when_spa_not_built` explicitly exercise the "no dist/" case without
skipping anything.
"""

from __future__ import annotations

import time

from conftest import publish_share, random_wellformed_slug

NOT_FOUND = {"detail": "Not found"}
# A real <head></head> is needed so this file's show_title tests below can
# exercise `_inject_meta_title`'s splice point — every OTHER test in this
# file still just compares full-body equality against this same constant,
# so adding the (empty) head changes nothing about their behavior.
FAKE_SHELL = b"<!doctype html><html><head></head><body>fake spa shell for test_spa_navigation.py</body></html>"
HTML_ACCEPT = {"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
JSON_ACCEPT = {"Accept": "application/json"}


def _build_html_nav_states(owner_client, anon_client) -> dict:
    """Every deny reason (matching `test_policy_gate.py::_build_deny_states`'
    coverage) PLUS a successful rendered-mode file share — all fetched with
    `Accept: text/html`, i.e. as a real browser navigation would."""
    states = {}

    states["malformed"] = anon_client.get("/share/bad slug!!", headers=HTML_ACCEPT)
    states["nonexistent"] = anon_client.get(f"/share/{random_wellformed_slug()}", headers=HTML_ACCEPT)

    revoked_share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{revoked_share['id']}")
    states["revoked"] = anon_client.get(f"/share/{revoked_share['slug']}", headers=HTML_ACCEPT)

    expired_share = publish_share(owner_client, expires_at=time.time() - 60)
    states["expired"] = anon_client.get(f"/share/{expired_share['slug']}", headers=HTML_ACCEPT)

    restricted_share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "someone-else@example.com", "role": "viewer"}],
    )
    states["restricted_no_identity"] = anon_client.get(f"/share/{restricted_share['slug']}", headers=HTML_ACCEPT)

    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw", render_mode="rendered")
    states["password_required"] = anon_client.get(f"/share/{password_share['slug']}", headers=HTML_ACCEPT)

    # §4.4 — folder shares removed; a folder-shaped URL is now just one
    # more deny reason (`share_subpath_removed`), covered the same way.
    live_share = publish_share(owner_client, general_access="link", auth_mode="none")
    states["folder_shaped_url_removed"] = anon_client.get(f"/share/{live_share['slug']}/nope.md", headers=HTML_ACCEPT)

    # --- Success: rendered-mode file share -----------------------------
    rendered_share = publish_share(owner_client, render_mode="rendered", general_access="link", auth_mode="none")
    states["rendered_success"] = anon_client.get(f"/share/{rendered_share['slug']}", headers=HTML_ACCEPT)

    return states


def test_html_navigation_gets_shell_for_every_deny_reason_and_success_alike(app, owner_client, anon_client):
    app.state.spa_index_html = FAKE_SHELL

    states = _build_html_nav_states(owner_client, anon_client)

    for name, r in states.items():
        assert r.status_code == 200, f"{name}: expected 200, got {r.status_code} ({r.text[:200]!r})"
        assert r.content == FAKE_SHELL, f"{name}: shell bytes must be IDENTICAL across every case"
        assert r.headers["content-type"].startswith("text/html"), name

    # Every one of the above collapses to the exact same fingerprint —
    # content-independent, no slug/policy/error detail leaked into it.
    fingerprints = {(r.status_code, r.content) for r in states.values()}
    assert len(fingerprints) == 1, f"HTML-navigation responses are NOT uniform: {fingerprints}"


def test_html_navigation_json_and_default_accept_are_completely_unaffected(app, owner_client, anon_client):
    """The actual authorization decision — and the uniform JSON 404 —
    lives entirely in the Accept: application/json (or no-Accept-header)
    path, untouched by the widening above."""
    app.state.spa_index_html = FAKE_SHELL

    revoked_share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{revoked_share['id']}")
    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw", render_mode="rendered")
    rendered_share = publish_share(owner_client, render_mode="rendered", general_access="link", auth_mode="none")

    for headers in (None, JSON_ACCEPT):
        for slug in (random_wellformed_slug(), revoked_share["slug"], password_share["slug"]):
            r = anon_client.get(f"/share/{slug}", **({"headers": headers} if headers else {}))
            assert r.status_code == 404
            assert r.json() == NOT_FOUND
            assert r.content != FAKE_SHELL

        r = anon_client.get(f"/share/{rendered_share['slug']}", **({"headers": headers} if headers else {}))
        assert r.status_code == 200
        assert r.content != FAKE_SHELL
        if headers == JSON_ACCEPT:
            assert r.json()["content"]  # real ShareContentOut, not the shell
        else:
            assert r.headers["content-type"] == "text/plain; charset=utf-8"  # documented default


def test_raw_mode_success_never_takes_the_html_shell_branch(app, owner_client, anon_client):
    """The ONE, non-negotiable exception (roadmap §1: "a raw share must
    never execute") — a successful RAW-mode share always returns
    text/plain, even for a real browser navigation."""
    app.state.spa_index_html = FAKE_SHELL

    raw_share = publish_share(owner_client, render_mode="raw", general_access="link", auth_mode="none")
    r = anon_client.get(f"/share/{raw_share['slug']}", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.content != FAKE_SHELL


def test_show_title_auth_none_granted_injects_escaped_title_and_og_tags(app, owner_client, anon_client):
    """DESIGN-SPEC round 10 item 67 — the ONLY case that may deviate from
    the byte-identical shell: `show_title=True` AND `auth_mode="none"` AND
    access actually resolved. The H1 is HTML-escaped (attacker-influenced
    text going into a <head>)."""
    app.state.spa_index_html = FAKE_SHELL

    share = publish_share(
        owner_client,
        content=b'# <script>alert(1)</script> & "Quoted" Title\n\nBody.\n',
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        show_title=True,
    )
    r = anon_client.get(f"/share/{share['slug']}", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert r.content != FAKE_SHELL
    assert b"<script>alert(1)</script>" not in r.content
    assert b"&lt;script&gt;alert(1)&lt;/script&gt;" in r.content
    assert b"<title>" in r.content
    assert b'property="og:title"' in r.content


def test_show_title_with_password_mode_stays_byte_identical_to_deny_shell(app, owner_client, anon_client):
    """The negative case: `show_title=True` but `auth_mode="password"` — a
    real, live, show-title-enabled share must STILL produce the exact same
    shell bytes as every deny reason, no title, no OG tags, no hint the
    share even has a title at all."""
    app.state.spa_index_html = FAKE_SHELL

    share = publish_share(
        owner_client,
        content=b"# Secret Title\n\nBody.\n",
        render_mode="rendered",
        general_access="link",
        auth_mode="password",
        password="s3cret-pw",
        show_title=True,
    )
    # No session cookie — this is a live share, but from a bare GET it must
    # be indistinguishable from every other deny reason (policy.py's
    # uniform-404 contract, widened to the HTML shell by this file).
    r = anon_client.get(f"/share/{share['slug']}", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert r.content == FAKE_SHELL


def test_html_navigation_falls_back_to_json_deny_when_spa_not_built(app, anon_client):
    """No `dist/` yet (fresh checkout, `npm run build` never run) — must
    degrade to the exact same JSON 404, never crash, never hang. Explicit
    coverage, not a skip: both shell sources are forced empty —
    `spa_index_html` (the bytes-override hook tests normally use) AND
    `spa_index_path` (production's per-request disk read, added when the
    startup preload was removed so rebuilds go live without a backend
    restart) — regardless of whatever the real filesystem happens to
    have."""
    app.state.spa_index_html = None
    app.state.spa_index_path = None
    r = anon_client.get(f"/share/{random_wellformed_slug()}", headers=HTML_ACCEPT)
    assert r.status_code == 404
    assert r.json() == NOT_FOUND

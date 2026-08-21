"""Phase 10.5a widening (roadmap §5.4, `app/routers/share_public.py`'s
`_deny_response`/`_spa_shell_response`): a real browser navigation
(`Accept: text/html`) to `GET /share/{id}[/{relpath}]` must get the built
SPA's shell for EVERY deny reason as well as a successful rendered-mode/
folder share — never the JSON 404, never anything content-dependent. The
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

from conftest import publish_folder_share, publish_share, random_wellformed_slug

NOT_FOUND = {"detail": "Not found"}
FAKE_SHELL = b"<!doctype html><html><body>fake spa shell for test_spa_navigation.py</body></html>"
HTML_ACCEPT = {"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
JSON_ACCEPT = {"Accept": "application/json"}


def _build_html_nav_states(owner_client, anon_client) -> dict:
    """Every deny reason (matching `test_policy_gate.py::_build_deny_states`'
    coverage) PLUS a successful rendered-mode file share and a successful
    folder share — all fetched with `Accept: text/html`, i.e. as a real
    browser navigation would."""
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

    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
    states["password_required"] = anon_client.get(f"/share/{password_share['slug']}", headers=HTML_ACCEPT)

    folder_share = publish_folder_share(owner_client, files={"a.md": b"file a"})
    states["folder_unknown_relpath"] = anon_client.get(f"/share/{folder_share['slug']}/nope.md", headers=HTML_ACCEPT)

    # --- Successes: rendered-mode file share + folder share -----------------
    rendered_share = publish_share(owner_client, render_mode="rendered", general_access="link", auth_mode="none")
    states["rendered_success"] = anon_client.get(f"/share/{rendered_share['slug']}", headers=HTML_ACCEPT)

    states["folder_success"] = anon_client.get(f"/share/{folder_share['slug']}", headers=HTML_ACCEPT)

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
    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
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

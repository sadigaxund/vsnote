"""§4.4 — folder shares were removed entirely 2026-09-05
(docs/PLAN-2026-09-05-refresh.md §4.4; superseded section in
docs/ARCHITECTURE.md and SUPERSEDED marker in
docs/ROADMAP-SHARING-AUTH.md §5.1).

What this file proves: a folder-shaped URL (`/share/<slug>/anything`) now
404s exactly like any other deny reason — never a distinct shape, never a
500, never reachable at all (see
`app/routers/share_public.py::share_subpath_removed`).

There is deliberately NO migration for databases that predate the removal.
The models simply no longer describe folder shares; a SQLite file carrying
stray legacy columns is not this codebase's problem.
"""

from __future__ import annotations

from conftest import publish_share

NOT_FOUND = {"detail": "Not found"}


def test_folder_shaped_url_is_uniform_404(owner_client, anon_client):
    share = publish_share(owner_client, general_access="link", auth_mode="none")

    for method, kwargs in (
        ("get", {}),
        ("put", {"content": b"x"}),
        ("patch", {"content": b"x"}),
    ):
        r = getattr(anon_client, method)(f"/share/{share['slug']}/some/nested/path", **kwargs)
        assert r.status_code == 404, f"{method}: expected 404, got {r.status_code}"
        assert r.json() == NOT_FOUND

    # The CORS-enabled content-route twin too.
    r = anon_client.get(f"/api/share/{share['slug']}/content/whatever")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND

"""DESIGN-SPEC Amendments round 7 item 59 — a share page open must count as
a real, non-zero, non-inflated number of hits.

Contract (see `app/routers/share_public.py`'s `_render_folder_resolution`
`on_content` doc and `_is_share_followup_request` doc for the full "why"):

- The HTML shell response is NEVER the counted point, for either a file or
  a folder share. It's unreliable as a signal: a dev/preview proxy's
  navigation bypass, or a PWA service worker caching it, both mean this
  backend can legitimately never see that particular request at all — an
  earlier version of this fix anchored counting to the shell (via referer
  dedup at the root route) and broke exactly this way, confirmed live by
  `tests/e2e/share-panel.spec.ts` failing with hits stuck at 0 under the
  e2e stack's proxy.
- The bare `/share/{identifier}` ROOT route (file or folder) counts
  UNCONDITIONALLY on every content-bearing (non-shell) response it
  returns, self-referer or not. This is what actually fixes the proxy/SW
  case: the SPA's own content re-fetch of that same URL is often the ONLY
  request that ever reaches the server, and it must count on its own
  merits. A reload is legitimately another open, so there's no dedup here
  at all — two content fetches are two hits.
- RELPATH-addressed folder GETs (`/share/{identifier}/{relpath}}` — a
  subdirectory listing, or a file inside the folder) DO dedup: a request
  carrying a `Referer` back to this same share's own page (an in-page
  follow-up — `share/ShareApp.tsx`'s tree-building/file-opening) is
  skipped, but a direct deep-link fetch with no such referer still counts.
- The CORS-enabled `/api/share/{id}/content[...]` twins follow the exact
  same root-vs-relpath split.
"""

from __future__ import annotations

from conftest import publish_folder_share, publish_share


def _hit_count(client, share_id: int) -> int:
    listed = client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share_id)
    return row["hit_count"]


# --- file shares -------------------------------------------------------


def test_rendered_share_root_counts_on_content_response_not_shell(owner_client, anon_client):
    """The shell-HTML response must never move hit_count — only fetching
    the actual content does."""
    share = publish_share(owner_client, content=b"# Hello\nworld", render_mode="rendered")
    slug = share["slug"]
    assert _hit_count(owner_client, share["id"]) == 0

    shell = anon_client.get(f"/share/{slug}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert shell.status_code == 200
    assert shell.headers["content-type"].startswith("text/html")
    assert _hit_count(owner_client, share["id"]) == 0  # shell never counts

    content = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json"})
    assert content.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_rendered_share_content_fetch_counts_even_with_self_referer(owner_client, anon_client):
    """Regression guard for the exact bug the e2e run caught: under a dev/
    preview proxy's navigation bypass (or a PWA service worker caching the
    shell), the backend never sees a shell request at all — the SPA's own
    content re-fetch, which always self-refers, is the ONLY request that
    reaches it. That request alone must be enough to move hit_count off 0,
    with no shell request involved anywhere in this test."""
    share = publish_share(owner_client, content=b"# Doc", render_mode="rendered")
    slug = share["slug"]
    page_url = f"http://testserver/share/{slug}"
    content = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    assert content.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_rendered_share_reload_counts_again(owner_client, anon_client):
    """A reload is legitimately another open — the root route never dedups
    between separate content-bearing requests, only shell-vs-content."""
    share = publish_share(owner_client, content=b"# Doc", render_mode="rendered")
    slug = share["slug"]
    page_url = f"http://testserver/share/{slug}"
    anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    assert _hit_count(owner_client, share["id"]) == 2


def test_raw_share_fetch_always_counts_regardless_of_referer(owner_client, anon_client):
    """A raw-mode share never serves a shell at all — every request to it
    is content-bearing and counts, unconditionally."""
    share = publish_share(owner_client, content=b"raw bytes", render_mode="raw")
    assert _hit_count(owner_client, share["id"]) == 0

    r = anon_client.get(f"/share/{share['slug']}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert _hit_count(owner_client, share["id"]) == 1

    r2 = anon_client.get(f"/share/{share['slug']}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert r2.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 2


# --- folder shares -------------------------------------------------------


def test_folder_root_counts_on_listing_response_not_shell(owner_client, anon_client):
    share = publish_folder_share(owner_client)
    slug = share["slug"]
    assert _hit_count(owner_client, share["id"]) == 0

    shell = anon_client.get(f"/share/{slug}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert shell.status_code == 200
    assert shell.headers["content-type"].startswith("text/html")
    assert _hit_count(owner_client, share["id"]) == 0

    listing = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json"})
    assert listing.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_folder_root_counts_even_with_self_referer(owner_client, anon_client):
    """Same proxy/SW-bypass regression guard as the file-share case, for a
    folder share's root listing: no shell request in this test at all, and
    the one content request that does reach the server self-refers."""
    share = publish_folder_share(owner_client)
    slug = share["slug"]
    page_url = f"http://testserver/share/{slug}"
    listing = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    assert listing.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_folder_relpath_followups_do_not_double_count_but_direct_fetch_does(owner_client, anon_client):
    """Once a folder share's root is open, browsing further inside it
    (`share/ShareApp.tsx`'s subdirectory-listing tree build, opening
    another file) must not add more hits for that same visit — but a
    direct deep-link fetch with no self-referer is a real, separate
    access."""
    share = publish_folder_share(owner_client)
    slug = share["slug"]
    page_url = f"http://testserver/share/{slug}"

    root = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json"})
    assert root.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    subdir = anon_client.get(f"/share/{slug}/sub", headers={"Accept": "application/json", "Referer": page_url})
    assert subdir.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1  # in-page follow-up, deduped

    file_fetch = anon_client.get(f"/share/{slug}/a.md", headers={"Accept": "application/json", "Referer": page_url})
    assert file_fetch.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1  # still just the one open

    deep = anon_client.get(f"/share/{slug}/sub/b.md", headers={"Accept": "application/json"})
    assert deep.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 2  # no referer -> a real, distinct access


# --- CORS content-route twins --------------------------------------------


def test_cors_content_route_root_always_counts(owner_client, anon_client):
    """`/api/share/{id}/content` is always JSON, never a shell — it counts
    unconditionally exactly like the root app route's `get_share`."""
    share = publish_share(owner_client, content=b"content", render_mode="rendered")
    slug = share["slug"]
    r1 = anon_client.get(f"/api/share/{slug}/content")
    assert r1.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    page_url = f"http://testserver/share/{slug}"
    r2 = anon_client.get(f"/api/share/{slug}/content", headers={"Referer": page_url})
    assert r2.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 2  # the root twin never dedups


def test_cors_content_route_relpath_dedups_like_the_root_apps_twin(owner_client, anon_client):
    share = publish_folder_share(owner_client)
    slug = share["slug"]
    page_url = f"http://testserver/share/{slug}"

    r1 = anon_client.get(f"/api/share/{slug}/content/a.md", headers={"Referer": page_url})
    assert r1.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 0  # self-referer -> deduped

    r2 = anon_client.get(f"/api/share/{slug}/content/a.md")  # no referer
    assert r2.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

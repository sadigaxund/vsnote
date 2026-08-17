"""DESIGN-SPEC Amendments round 7 item 59 — a share page open must count as
EXACTLY ONE hit, not the shell-HTML request and the SPA's own immediate
content re-fetch (previously two), and not once per folder-listing/manifest
fetch a visitor's already-open share page makes while browsing (previously
one per fetch). See `app/routers/share_public.py`'s
`_is_share_followup_request` for the mechanism this pins: a same-visit
follow-up carries a `Referer` pointing back at this same share's own
`/share/{identifier}...` page (real `fetch()`/navigation behavior, no
client cooperation needed) and is skipped; the one request without that
self-referer is the canonical counted point.
"""

from __future__ import annotations

from conftest import publish_folder_share, publish_share


def _hit_count(client, share_id: int) -> int:
    listed = client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share_id)
    return row["hit_count"]


def test_rendered_share_page_open_counts_once_not_twice(owner_client, anon_client):
    """A real browser open of a rendered-mode share is TWO requests (the
    shell-HTML navigation, then the SPA's own JSON content re-fetch on that
    same page) but must land as ONE hit."""
    share = publish_share(owner_client, content=b"# Hello\nworld", render_mode="rendered")
    slug = share["slug"]
    assert _hit_count(owner_client, share["id"]) == 0

    shell = anon_client.get(f"/share/{slug}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert shell.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    page_url = f"http://testserver/share/{slug}"
    refetch = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    assert refetch.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1  # unchanged — same-visit follow-up


def test_raw_share_fetch_increments(owner_client, anon_client):
    """A raw-mode share never serves the SPA shell at all — its one request
    is the whole visit, and must still count."""
    share = publish_share(owner_client, content=b"raw bytes", render_mode="raw")
    assert _hit_count(owner_client, share["id"]) == 0

    r = anon_client.get(f"/share/{share['slug']}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert _hit_count(owner_client, share["id"]) == 1

    # A second, later, genuinely separate visit (no referer back to this
    # share's own page) is a real new hit, not deduped.
    r2 = anon_client.get(f"/share/{share['slug']}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert r2.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 2


def test_folder_share_open_counts_once_across_shell_and_listing_fetches(owner_client, anon_client):
    """A folder share open involves the shell, the root listing, and
    (`ShareApp.tsx`'s `buildShareTree`) one listing fetch per subdirectory —
    none of the auxiliary listing/manifest fetches from that same open may
    add a second hit."""
    share = publish_folder_share(owner_client)
    slug = share["slug"]
    assert _hit_count(owner_client, share["id"]) == 0

    shell = anon_client.get(f"/share/{slug}", headers={"Accept": "text/html,application/xhtml+xml"})
    assert shell.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    page_url = f"http://testserver/share/{slug}"
    root_listing = anon_client.get(f"/share/{slug}", headers={"Accept": "application/json", "Referer": page_url})
    assert root_listing.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    subdir_listing = anon_client.get(f"/share/{slug}/sub", headers={"Accept": "application/json", "Referer": page_url})
    assert subdir_listing.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    file_fetch = anon_client.get(f"/share/{slug}/a.md", headers={"Accept": "application/json", "Referer": page_url})
    assert file_fetch.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_direct_script_fetch_with_no_referer_still_counts(owner_client, anon_client):
    """A direct API/script hit (curl, an integration) that never touched
    the shell has no self-referer to dedup against — it's a real, distinct
    access and must count, same as before this change."""
    share = publish_share(owner_client, content=b"# Doc", render_mode="rendered")
    r = anon_client.get(f"/share/{share['slug']}", headers={"Accept": "application/json"})
    assert r.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1


def test_cors_content_route_dedup_uses_the_same_mechanism(owner_client, anon_client):
    """The CORS-enabled `/api/share/{id}/content` twin (`build_content_router`)
    shares `_record_access`/the same dedup — a same-page follow-up there is
    skipped exactly like the same-origin route's."""
    share = publish_share(owner_client, content=b"content", render_mode="rendered")
    slug = share["slug"]
    r1 = anon_client.get(f"/api/share/{slug}/content")
    assert r1.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

    page_url = f"http://testserver/share/{slug}"
    r2 = anon_client.get(f"/api/share/{slug}/content", headers={"Referer": page_url})
    assert r2.status_code == 200
    assert _hit_count(owner_client, share["id"]) == 1

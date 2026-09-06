"""DESIGN-SPEC Amendments round 7 item 59 — a share page open must count as
a real, non-zero, non-inflated number of hits.

Contract (see `app/routers/share_public.py`'s `_record_access` doc for the
full "why"):

- The HTML shell response is NEVER the counted point. It's unreliable as a
  signal: a dev/preview proxy's navigation bypass, or a PWA service worker
  caching it, both mean this backend can legitimately never see that
  particular request at all — an earlier version of this fix anchored
  counting to the shell (via referer dedup at the root route) and broke
  exactly this way, confirmed live by `tests/e2e/share-panel.spec.ts`
  failing with hits stuck at 0 under the e2e stack's proxy.
- The bare `/share/{identifier}` route counts UNCONDITIONALLY on every
  content-bearing (non-shell) response it returns, self-referer or not.
  This is what actually fixes the proxy/SW case: the SPA's own content
  re-fetch of that same URL is often the ONLY request that ever reaches
  the server, and it must count on its own merits. A reload is
  legitimately another open, so there's no dedup here at all — two content
  fetches are two hits.
- The CORS-enabled `/api/share/{id}/content` twin follows the same rule.

§4.4 note: this file used to also cover folder-share relpath GETs, which
deduped in-page follow-ups by `Referer` — that whole mechanism
(`_is_share_followup_request`/`_record_relpath_access`) was removed along
with folder shares themselves (2026-09-05); every share is now addressed
only at its bare root route, which never dedups.
"""

from __future__ import annotations

from conftest import publish_share


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



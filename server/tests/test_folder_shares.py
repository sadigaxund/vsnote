"""Phase 10.5 — folder ("group") shares (roadmap §5.1). Two things this
file tests:

1. Ordinary resolution: root listing, subdirectory listing, raw + JSON file
   content, at both the nested-in-manifest and top-level relpaths.
2. THE manifest path-resolution matrix — every deny reason from
   `docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 10.5 section (in-manifest hit,
   excluded entry, unknown relpath, `..` traversal, absolute path,
   URL-encoded and double-encoded traversal, backslash variant, another
   share's relpath) — asserting every deny is BYTE-IDENTICAL to the
   existing Phase 9 404 fingerprint (`policy.py`'s `NOT_FOUND_BODY`, no
   extra headers). See `app/routers/share_public.py`'s module docstring for
   why exact-match manifest lookup makes every one of these fail for the
   SAME reason ("no row"), not a family of different-shaped rejections.

The equivalence-matrix tests in `test_policy_gate.py` are separately
EXTENDED (not duplicated here) to fold these same folder-share deny states
into the existing single-fingerprint assertion across the whole `/share/*`
surface — see that file's `_build_deny_states` / `test_deny_state_equivalence_matrix_content_route`.
"""

from __future__ import annotations

from conftest import publish_folder_share, publish_share
from app.routers.share_public import _resolve_folder_path

NOT_FOUND = {"detail": "Not found"}


# --- Ordinary resolution --------------------------------------------------


def test_folder_root_listing_200(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200
    body = r.json()
    assert body["prefix"] == ""
    names = {(e["name"], e["kind"]) for e in body["entries"]}
    assert ("a.md", "file") in names
    assert ("sub", "dir") in names


def test_folder_top_level_file_raw_200(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/a.md")
    assert r.status_code == 200
    assert r.content == b"file a"
    assert r.headers["content-type"].startswith("text/plain")
    assert r.headers["x-content-type-options"] == "nosniff"


def test_folder_top_level_file_json_200(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/a.md", headers={"Accept": "application/json"})
    assert r.status_code == 200
    body = r.json()
    assert body["source_path"] == "a.md"
    assert body["content"] == "file a"


def test_folder_nested_file_raw_200(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/sub/b.md")
    assert r.status_code == 200
    assert r.content == b"file b"


def test_folder_subdirectory_listing_200(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/sub")
    assert r.status_code == 200
    body = r.json()
    assert body["prefix"] == "sub"
    assert [e["name"] for e in body["entries"]] == ["b.md"]
    assert body["entries"][0]["relpath"] == "sub/b.md"


def test_folder_cors_content_route_root_and_file(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    assert r.json()["prefix"] == ""

    r2 = owner_client.get(f"/api/share/{share['slug']}/content/a.md")
    assert r2.status_code == 200
    assert r2.json()["content"] == "file a"


def test_hit_count_increments_on_folder_access(owner_client):
    share = publish_folder_share(owner_client)
    owner_client.get(f"/share/{share['slug']}/a.md")
    owner_client.get(f"/share/{share['slug']}/sub/b.md")
    listed = owner_client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share["id"])
    assert row["hit_count"] >= 2


def test_manifest_count_reflects_included_files(owner_client):
    share = publish_folder_share(owner_client)
    assert share["manifest_count"] == 2
    assert share["kind"] == "folder"


def test_update_share_republishes_manifest_to_same_slug(owner_client):
    share = publish_folder_share(owner_client)
    slug = share["slug"]

    blob = owner_client.post("/api/blobs", files={"file": ("c.md", b"file c", "text/markdown")})
    assert blob.status_code == 201
    updated = owner_client.put(
        f"/api/shares/{share['id']}/manifest",
        json={"manifest": [{"relpath": "c.md", "blob_id": blob.json()["id"]}]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["slug"] == slug
    assert updated.json()["manifest_count"] == 1

    # The old file is gone (republish REPLACES the manifest)...
    r_old = owner_client.get(f"/share/{slug}/a.md")
    assert r_old.status_code == 404
    # ...the new one resolves, at the SAME slug.
    r_new = owner_client.get(f"/share/{slug}/c.md")
    assert r_new.status_code == 200
    assert r_new.content == b"file c"


def test_file_share_ignores_relpath_route_404(owner_client):
    """A `kind=="file"` share has no manifest — a relpath GET against it is
    a deny, not a lookup into nothing."""
    share = publish_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/whatever")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_folder_share_put_is_404_not_supported(owner_client):
    share = publish_folder_share(owner_client, general_access="link", auth_mode="none")
    r = owner_client.put(f"/share/{share['slug']}", content=b"nope")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


# --- The manifest path-resolution matrix ----------------------------------
#
# Every one of these MUST be denied, and every denial MUST be byte-identical
# to the Phase 9 404 fingerprint (status 404, body {"detail":"Not found"},
# no extra headers, no WWW-Authenticate).


def _fingerprint(resp):
    ignored = {"date", "content-length", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"}
    headers = tuple(sorted((k.lower(), v) for k, v in resp.headers.items() if k.lower() not in ignored))
    return (resp.status_code, resp.content, headers)


PHASE9_FINGERPRINT_STATUS = 404
PHASE9_FINGERPRINT_BODY = b'{"detail":"Not found"}'


def _assert_uniform_404(resp):
    assert resp.status_code == PHASE9_FINGERPRINT_STATUS
    assert resp.content == PHASE9_FINGERPRINT_BODY
    assert "www-authenticate" not in {k.lower() for k in resp.headers}


def test_unknown_relpath_404(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/does/not/exist.md")
    _assert_uniform_404(r)


def test_excluded_entry_404(owner_client):
    # "z.md" is never included in the manifest at all — the same as an
    # owner unchecking it in the publish dialog's checkbox tree.
    share = publish_folder_share(owner_client, files={"a.md": b"file a"})
    r = owner_client.get(f"/share/{share['slug']}/z.md")
    _assert_uniform_404(r)


def test_dotdot_traversal_404(owner_client, db_session):
    """A LITERAL, non-percent-encoded ".." never actually reaches the
    server as such over HTTP from any RFC-3986-conformant client (browsers,
    httpx, requests, curl by default): the client's OWN URL parser removes
    dot-segments before the request line is ever built — confirmed
    empirically: `httpx.URL(path="/share/slug/../../etc/passwd")` resolves
    to `URL('http://testserver/etc/passwd')` before any request is sent, so
    this test's own HTTP client can't even construct the malicious request
    (a real wire-level test of the percent-encoded form is
    `test_url_encoded_traversal_404` below, which DOES survive client-side
    normalization and DOES exercise the real route + manifest lookup).
    The actual security property — "a relpath containing a literal '..'
    segment can never resolve to anything in the manifest" — is therefore
    tested directly against the resolution function below, which is exactly
    where policy.py's uniform-404 wrapping happens in every real route."""
    import app.models as models

    share = publish_folder_share(owner_client)
    row = db_session.query(models.Share).filter(models.Share.slug == share["slug"]).one()
    assert _resolve_folder_path(db_session, row, "../../etc/passwd") is None
    assert _resolve_folder_path(db_session, row, "sub/../../../etc/passwd") is None
    assert _resolve_folder_path(db_session, row, "..") is None


def test_absolute_path_404(owner_client):
    share = publish_folder_share(owner_client)
    # A leading slash after the identifier segment.
    r = owner_client.get(f"/share/{share['slug']}//etc/passwd")
    _assert_uniform_404(r)


def test_url_encoded_traversal_404(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/%2e%2e%2f%2e%2e%2fetc%2fpasswd")
    _assert_uniform_404(r)


def test_double_encoded_traversal_404(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/%252e%252e%252fetc%252fpasswd")
    _assert_uniform_404(r)


def test_backslash_variant_404(owner_client):
    share = publish_folder_share(owner_client)
    r = owner_client.get(f"/share/{share['slug']}/..%5c..%5cetc%5cpasswd")
    _assert_uniform_404(r)


def test_other_shares_relpath_404(owner_client):
    share_a = publish_folder_share(owner_client, files={"only-in-a.md": b"secret a"})
    share_b = publish_folder_share(owner_client, files={"only-in-b.md": b"secret b"})
    # "only-in-b.md" is a REAL relpath — just not in share_a's manifest.
    r = owner_client.get(f"/share/{share_a['slug']}/only-in-b.md")
    _assert_uniform_404(r)
    # And the reverse.
    r2 = owner_client.get(f"/share/{share_b['slug']}/only-in-a.md")
    _assert_uniform_404(r2)


def test_resolution_matrix_all_denies_share_one_fingerprint(owner_client):
    """The matrix itself: every deny state above, fingerprinted together
    with one genuine in-manifest 200 as a sanity control — the 200 must be
    the ONLY outlier, and every deny must collapse to exactly one shape."""
    share = publish_folder_share(owner_client, files={"a.md": b"file a", "sub/b.md": b"file b"})
    other = publish_folder_share(owner_client, files={"only-in-other.md": b"x"})

    deny_states = {
        "unknown": owner_client.get(f"/share/{share['slug']}/nope.md"),
        "excluded": owner_client.get(f"/share/{share['slug']}/excluded.md"),
        # A literal ".." can't be sent as-is over HTTP through any
        # RFC-3986-conformant client (see test_dotdot_traversal_404's
        # docstring) — its wire-reachable equivalent is url_encoded/
        # double_encoded below, which DO reach this route unnormalized.
        "absolute": owner_client.get(f"/share/{share['slug']}//etc/passwd"),
        "url_encoded": owner_client.get(f"/share/{share['slug']}/%2e%2e%2fetc%2fpasswd"),
        "double_encoded": owner_client.get(f"/share/{share['slug']}/%252e%252e%252fetc%252fpasswd"),
        "backslash": owner_client.get(f"/share/{share['slug']}/..%5c..%5cetc%5cpasswd"),
        "other_share": owner_client.get(f"/share/{share['slug']}/only-in-other.md"),
    }

    fingerprints = {name: _fingerprint(resp) for name, resp in deny_states.items()}
    distinct = set(fingerprints.values())
    assert len(distinct) == 1, (
        "Folder-share deny responses are NOT uniform — grouped by fingerprint:\n"
        + "\n".join(f"  {fp}: {[n for n, f in fingerprints.items() if f == fp]}" for fp in distinct)
    )
    only_fp = next(iter(distinct))
    assert only_fp[0] == 404
    assert only_fp[1] == b'{"detail":"Not found"}'

    # Sanity control: the one real, in-manifest relpath must NOT match the
    # deny fingerprint — proves the matrix isn't vacuously true because
    # everything 404s.
    control = owner_client.get(f"/share/{share['slug']}/a.md")
    assert _fingerprint(control) != only_fp
    assert control.status_code == 200

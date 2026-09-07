"""Owner-side `/api/blobs` and `/api/shares*` CRUD, scope enforcement, and
content-addressing / size-cap behavior."""

from __future__ import annotations

import hashlib

from conftest import publish_share


def test_publish_list_patch_regenerate_revoke_lifecycle(owner_client):
    share = publish_share(owner_client)

    listed = owner_client.get("/api/shares")
    assert listed.status_code == 200
    assert any(s["id"] == share["id"] for s in listed.json())

    patched = owner_client.patch(f"/api/shares/{share['id']}", json={"alias": "my-custom-alias"})
    assert patched.status_code == 200
    assert patched.json()["alias"] == "my-custom-alias"

    regen = owner_client.post(f"/api/shares/{share['id']}/regenerate")
    assert regen.status_code == 200
    assert regen.json()["slug"] != share["slug"]

    # Old slug is dead immediately after regeneration — it no longer
    # resolves to anything, so it now looks exactly like any other guessed,
    # well-formed, nonexistent slug. Every deny reason (including plain
    # nonexistence) is a uniform 404 — see policy.py's module docstring and
    # test_policy_gate.py::test_deny_state_equivalence_matrix_raw_route.
    old_get = owner_client.get(f"/share/{share['slug']}")
    assert old_get.status_code == 404
    assert old_get.json() == {"detail": "Not found"}

    revoked = owner_client.delete(f"/api/shares/{share['id']}")
    assert revoked.status_code == 200

    # A REVOKED share's row (and slug) still exists, but that's still just
    # one more deny reason among many, indistinguishable from the rest.
    dead = owner_client.get(f"/share/{regen.json()['slug']}")
    assert dead.status_code == 404


def test_commenter_role_rejected_with_422(owner_client):
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "restricted",
            "auth_mode": "none",
            "grants": [{"principal": "x@example.com", "role": "commenter"}],
        },
    )
    assert r.status_code == 422


def test_alias_must_match_slug_format(owner_client):
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "none",
            "alias": "no spaces allowed!",
        },
    )
    assert r.status_code == 422


def test_blob_content_addressing_same_content_same_id(owner_client):
    content = b"identical bytes twice"
    files1 = {"file": ("a.md", content, "text/markdown")}
    files2 = {"file": ("b.md", content, "text/markdown")}
    r1 = owner_client.post("/api/blobs", files=files1)
    r2 = owner_client.post("/api/blobs", files=files2)
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"] == hashlib.sha256(content).hexdigest()


def test_blob_size_cap_413(make_app, make_settings):
    settings = make_settings(max_blob_bytes=16)
    app = make_app(settings=settings)
    from fastapi.testclient import TestClient
    from app import models, security

    client = TestClient(app)
    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com"))
    db.commit()
    db.close()
    client.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    files = {"file": ("big.md", b"x" * 1000, "text/markdown")}
    r = client.post("/api/blobs", files=files)
    assert r.status_code == 413


def test_unauthenticated_cannot_publish(client, owner):
    files = {"file": ("note.md", b"hi", "text/markdown")}
    r = client.post("/api/blobs", files=files)
    assert r.status_code == 401


def test_read_scope_token_rejected_for_blob_write(owner_client, anon_client):
    # NOTE: owner_client is used only to MINT the token (needs a session).
    # The actual scoped call goes through anon_client — a client that
    # aliased owner_client's cookie jar would carry the owner's own full
    # session alongside the Bearer header and never actually exercise the
    # token's scope restriction at all.
    tr = owner_client.post("/api/auth/tokens", json={"name": "readonly", "scope": "read"})
    assert tr.status_code == 201
    token = tr.json()["token"]

    files = {"file": ("note.md", b"hi", "text/markdown")}
    r = anon_client.post("/api/blobs", files=files, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_write_scope_token_rejected_for_share_publish(owner_client, anon_client):
    tr = owner_client.post("/api/auth/tokens", json={"name": "writer", "scope": "write"})
    assert tr.status_code == 201
    token = tr.json()["token"]

    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = anon_client.post("/api/blobs", files=files, headers={"Authorization": f"Bearer {token}"}).json()["id"]

    r = anon_client.post(
        "/api/shares",
        json={"source_path": "x.md", "blob_id": blob_id, "render_mode": "raw", "general_access": "link", "auth_mode": "none"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_share_admin_scope_token_can_publish(owner_client, anon_client):
    tr = owner_client.post("/api/auth/tokens", json={"name": "admin-script", "scope": "share-admin"})
    assert tr.status_code == 201
    token = tr.json()["token"]

    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = anon_client.post("/api/blobs", files=files, headers={"Authorization": f"Bearer {token}"}).json()["id"]

    r = anon_client.post(
        "/api/shares",
        json={"source_path": "x.md", "blob_id": blob_id, "render_mode": "raw", "general_access": "link", "auth_mode": "none"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201


def test_cannot_patch_someone_elses_share(owner_client, anon_client, db_session):
    from app import models, security

    other = models.User(username="other", password_hash=security.hash_password("otherpw123"), email="other@example.com")
    db_session.add(other)
    db_session.commit()

    share = publish_share(owner_client)

    anon_client.post("/api/auth/login", json={"username": "other", "password": "otherpw123"})
    r = anon_client.patch(f"/api/shares/{share['id']}", json={"alias": "hijacked"})
    assert r.status_code == 404


def test_patch_clear_expiry_and_source_path(owner_client):
    """Round 6 items 5 + 8: `expires_at: null` is indistinguishable from an
    omitted field once parsed, so never-expires travels as the explicit
    `clear_expiry` sentinel; a vault move/rename PATCHes `source_path`."""
    share = publish_share(owner_client)

    with_expiry = owner_client.patch(f"/api/shares/{share['id']}", json={"expires_at": 4102444800})
    assert with_expiry.status_code == 200
    assert with_expiry.json()["expires_at"] == 4102444800

    # A bare null does NOT clear (that is exactly the ambiguity)...
    nulled = owner_client.patch(f"/api/shares/{share['id']}", json={"expires_at": None})
    assert nulled.status_code == 200
    assert nulled.json()["expires_at"] == 4102444800

    # ...the sentinel does.
    cleared = owner_client.patch(f"/api/shares/{share['id']}", json={"clear_expiry": True})
    assert cleared.status_code == 200
    assert cleared.json()["expires_at"] is None

    moved = owner_client.patch(f"/api/shares/{share['id']}", json={"source_path": "vault/renamed/new-home.md"})
    assert moved.status_code == 200
    assert moved.json()["source_path"] == "vault/renamed/new-home.md"

    # Blank/whitespace source_path is ignored, never stored.
    blank = owner_client.patch(f"/api/shares/{share['id']}", json={"source_path": "   "})
    assert blank.status_code == 200
    assert blank.json()["source_path"] == "vault/renamed/new-home.md"


# --- §4.5: reserved aliases + uniqueness pre-check --------------------------


# R3-4's full replacement reserved-word set (`security.RESERVED_ALIASES`):
# the four originals plus every other actually-served top-level path
# (`static`... `raw`) — see that constant's comment for where each entry
# comes from. Every lowercase reserved word must be rejected at BOTH create
# and patch time; the uppercase variants are additionally rejected, but for
# the SEPARATE "uppercase is never allowed" reason (covered by its own
# test below), not because they hit the reserved-word branch specifically.
RESERVED_ALIASES = ("api", "share", "git", "assets", "static", "admin", "login", "logout", "health", "s", "raw")


def test_reserved_alias_rejected_on_create(owner_client):
    for reserved in RESERVED_ALIASES:
        r = owner_client.post(
            "/api/shares",
            json={
                "source_path": "notes/x.md",
                "blob_id": owner_client.post(
                    "/api/blobs", files={"file": ("note.md", b"hi", "text/markdown")}
                ).json()["id"],
                "render_mode": "raw",
                "general_access": "link",
                "auth_mode": "none",
                "alias": reserved,
            },
        )
        assert r.status_code == 422, f"{reserved!r} should be rejected"


def test_reserved_alias_rejected_on_patch(owner_client):
    for reserved in RESERVED_ALIASES:
        share = publish_share(owner_client)
        r = owner_client.patch(f"/api/shares/{share['id']}", json={"alias": reserved})
        assert r.status_code == 422, f"{reserved!r} should be rejected"


def test_uppercase_alias_rejected_with_clear_message_never_downcased(owner_client):
    """R3-4 — an uppercase character is a REJECTED input, never silently
    downcased: silently rewriting the alias would hand the owner a
    different URL than the one they just typed and clicked Publish on."""
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "none",
            "alias": "MyAlias",
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Use lowercase letters, digits, hyphens and underscores"


def test_short_alias_now_accepted(owner_client):
    """R3-4's whole point: 2-7 char aliases like 'get'/'help' are now legal
    (the old minimum was 8), and the published share is reachable at that
    short identifier through the public gate."""
    share = publish_share(owner_client, alias="get")
    assert share["alias"] == "get"
    r = owner_client.get("/share/get")
    assert r.status_code == 200


def test_one_char_alias_still_rejected(owner_client):
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "none",
            "alias": "a",
        },
    )
    assert r.status_code == 422


def test_alias_uniqueness_against_another_alias(owner_client):
    """Two aliases can only ever collide on EXACT equality in practice — an
    alias is always stored lowercase (uppercase input is rejected outright,
    see `test_uppercase_alias_rejected_...` above), so there is no cased
    variant of an existing alias an owner could even submit. The
    `func.lower()` comparison in `_check_alias_available` still covers this
    column defensively (see that function's docstring); this test just
    pins the ordinary collision case."""
    publish_share(owner_client, alias="taken-alias")
    second = publish_share(owner_client)
    r = owner_client.patch(f"/api/shares/{second['id']}", json={"alias": "taken-alias"})
    assert r.status_code == 409


def test_alias_uniqueness_is_case_insensitive_against_an_existing_slug(owner_client):
    """An alias is always stored lowercase (uppercase input is rejected
    outright), but a generated slug is mixed-case — R3-4 requires the
    uniqueness check to case-fold BOTH sides, so an alias that matches an
    existing slug except for case must still collide."""
    existing = publish_share(owner_client)
    mixed_case_slug = existing["slug"]
    assert mixed_case_slug.lower() != mixed_case_slug, "fixture slug should contain at least one uppercase letter"

    other = publish_share(owner_client)
    r = owner_client.patch(f"/api/shares/{other['id']}", json={"alias": mixed_case_slug.lower()})
    assert r.status_code == 409


def test_alias_cannot_collide_with_another_shares_alias(owner_client):
    first = publish_share(owner_client, alias="taken-alias")
    assert first["alias"] == "taken-alias"
    second = publish_share(owner_client)
    r = owner_client.patch(f"/api/shares/{second['id']}", json={"alias": "taken-alias"})
    assert r.status_code == 409


def test_alias_cannot_collide_with_an_existing_slug(owner_client):
    # R3-4: an alias is lowercase-only now (a generated slug is mixed-case),
    # so the exact slug string would 422 on FORMAT before ever reaching the
    # uniqueness check — lower-casing it is what actually exercises the
    # slug-collision branch (see the dedicated case-insensitivity test
    # below for the "differs only by case" version of this same check).
    existing = publish_share(owner_client)
    other = publish_share(owner_client)
    r = owner_client.patch(f"/api/shares/{other['id']}", json={"alias": existing["slug"].lower()})
    assert r.status_code == 409


def test_create_share_alias_collision_is_clean_409_not_500(owner_client):
    first = publish_share(owner_client, alias="my-nice-alias")
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/y.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "none",
            "alias": "my-nice-alias",
        },
    )
    assert r.status_code == 409


# --- §4.6: auth matrix enforced server-side ---------------------------------


def test_raw_with_password_rejected_on_create(owner_client):
    files = {"file": ("note.md", b"hi", "text/markdown")}
    blob_id = owner_client.post("/api/blobs", files=files).json()["id"]
    r = owner_client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "password",
            "password": "s3cret-pw",
        },
    )
    assert r.status_code == 422


def test_raw_with_token_is_allowed(owner_client):
    share = publish_share(owner_client, render_mode="raw", auth_mode="token")
    assert share["auth_mode"] == "token"


def test_patch_to_raw_with_existing_password_auth_rejected(owner_client):
    """A rendered+password share PATCHed to render_mode="raw" while
    auth_mode stays "password" (unset in the patch) must still be caught —
    the check runs against the FULL resulting state, not just the fields
    present in this one request."""
    share = publish_share(
        owner_client, render_mode="rendered", auth_mode="password", password="s3cret-pw"
    )
    r = owner_client.patch(f"/api/shares/{share['id']}", json={"render_mode": "raw"})
    assert r.status_code == 422


def test_patch_to_password_while_raw_rejected(owner_client):
    share = publish_share(owner_client, render_mode="raw", auth_mode="none")
    r = owner_client.patch(f"/api/shares/{share['id']}", json={"auth_mode": "password", "password": "s3cret-pw"})
    assert r.status_code == 422


def test_patch_auth_matrix_rejection_does_not_partially_apply(owner_client):
    """A rejected patch must leave the share entirely unchanged — no
    partial application of the alias/expiry/etc. fields bundled in the
    same request."""
    share = publish_share(owner_client, render_mode="raw", auth_mode="none")
    r = owner_client.patch(
        f"/api/shares/{share['id']}",
        json={"auth_mode": "password", "password": "s3cret-pw", "alias": "should-not-stick"},
    )
    assert r.status_code == 422
    listed = owner_client.get("/api/shares").json()
    row = next(s for s in listed if s["id"] == share["id"])
    assert row["alias"] is None
    assert row["auth_mode"] == "none"

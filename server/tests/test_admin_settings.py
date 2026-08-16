"""DESIGN-SPEC Amendments round 5, item 40 — `GET`/`PUT /api/admin/settings`
(the DB-backed admin-adjustable `max_blob_bytes` runtime setting). Covers:
deny posture for a non-admin/anonymous caller (matches the established
`/api/*` 401/403 pattern, NOT the `/share/*` uniform-404 policy gate — see
`app/auth.py::build_auth_deps`'s `require_admin` docstring), bounds
validation, that enforcement genuinely reads the DB value (not
`Settings.max_blob_bytes`), and env-var seed-once precedence.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import models, security
from app.config import Settings
from app.main import create_app
from app.runtime_settings import MAX_MAX_BLOB_BYTES, MIN_MAX_BLOB_BYTES

NON_ADMIN_USERNAME = "regular-user"
NON_ADMIN_PASSWORD = "not an admin at all 123"


def _create_non_admin(app) -> None:
    db = app.state.SessionLocal()
    try:
        db.add(
            models.User(
                username=NON_ADMIN_USERNAME,
                password_hash=security.hash_password(NON_ADMIN_PASSWORD),
                email="regular@example.com",
                is_admin=False,
            )
        )
        db.commit()
    finally:
        db.close()


def _login_non_admin(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"username": NON_ADMIN_USERNAME, "password": NON_ADMIN_PASSWORD})
    assert r.status_code == 200, r.text


# --- Deny posture ------------------------------------------------------


def test_non_admin_put_denied_with_uniform_403(app, owner_client):
    _create_non_admin(app)
    client = TestClient(app)  # separate cookie jar from owner_client
    _login_non_admin(client)

    r = client.put("/api/admin/settings", json={"max_blob_bytes": 2 * 1024 * 1024})
    assert r.status_code == 403
    assert r.json() == {"detail": "Admin privileges required"}
    # Never leaks the current/would-be value, nor any hint the underlying
    # resource is otherwise fine — same "reason never reaches the client"
    # discipline as policy.py's deny path.
    assert "max_blob_bytes" not in r.text


def test_non_admin_get_denied_with_uniform_403(app):
    _create_non_admin(app)
    client = TestClient(app)
    _login_non_admin(client)

    r = client.get("/api/admin/settings")
    assert r.status_code == 403
    assert r.json() == {"detail": "Admin privileges required"}


def _mint_token(owner_client, scope: str) -> str:
    r = owner_client.post("/api/auth/tokens", json={"name": f"{scope}-tok", "scope": scope})
    assert r.status_code == 201, r.text
    assert r.json()["scope"] == scope
    return r.json()["token"]


def test_api_token_cannot_reach_admin_settings_even_when_owner_is_admin(app, owner_client):
    """Regression: `is_admin` alone is NOT sufficient authority here.

    `models.TokenScope` has no admin tier, so gating only on `User.is_admin`
    let the weakest credential the app can mint — a READ-scoped token, handed
    to a script or a git client — rewrite server runtime settings. Verified
    escalation: before `require_admin` rejected token-derived contexts, the
    PUT below returned 200 and really changed the stored limit. Admin routes
    require an interactive identity (session / Cf-Access) instead.
    """
    for scope in ("read", "write"):
        token = _mint_token(owner_client, scope)
        anon = TestClient(app)  # no session cookie whatsoever
        hdr = {"Authorization": f"Bearer {token}"}

        put = anon.put("/api/admin/settings", json={"max_blob_bytes": 77 * 1024 * 1024}, headers=hdr)
        assert put.status_code == 403, f"{scope}-scoped token escalated: HTTP {put.status_code}"
        # Byte-identical to the non-admin human's denial, so the response
        # never distinguishes "wrong credential type" from "not an admin".
        assert put.json() == {"detail": "Admin privileges required"}

        get = anon.get("/api/admin/settings", headers=hdr)
        assert get.status_code == 403
        assert get.json() == {"detail": "Admin privileges required"}

    # And the limit really is untouched by all of the above.
    still = owner_client.get("/api/admin/settings")
    assert still.status_code == 200
    assert still.json()["max_blob_bytes"] != 77 * 1024 * 1024


def test_anonymous_put_denied_with_uniform_401(anon_client):
    r = anon_client.put("/api/admin/settings", json={"max_blob_bytes": 2 * 1024 * 1024})
    assert r.status_code == 401
    assert r.json() == {"detail": "Authentication required"}
    assert "max_blob_bytes" not in r.text


def test_anonymous_get_denied_with_uniform_401(anon_client):
    r = anon_client.get("/api/admin/settings")
    assert r.status_code == 401
    assert r.json() == {"detail": "Authentication required"}


def test_admin_can_get_and_put(owner_client):
    r = owner_client.get("/api/admin/settings")
    assert r.status_code == 200
    assert "max_blob_bytes" in r.json()

    put = owner_client.put("/api/admin/settings", json={"max_blob_bytes": 10 * 1024 * 1024})
    assert put.status_code == 200
    assert put.json()["max_blob_bytes"] == 10 * 1024 * 1024

    again = owner_client.get("/api/admin/settings")
    assert again.json()["max_blob_bytes"] == 10 * 1024 * 1024


# --- Bounds validation ---------------------------------------------------


def test_below_minimum_rejected(owner_client):
    r = owner_client.put("/api/admin/settings", json={"max_blob_bytes": MIN_MAX_BLOB_BYTES - 1})
    assert r.status_code == 422


def test_above_maximum_rejected(owner_client):
    r = owner_client.put("/api/admin/settings", json={"max_blob_bytes": MAX_MAX_BLOB_BYTES + 1})
    assert r.status_code == 422


def test_minimum_boundary_accepted(owner_client):
    r = owner_client.put("/api/admin/settings", json={"max_blob_bytes": MIN_MAX_BLOB_BYTES})
    assert r.status_code == 200
    assert r.json()["max_blob_bytes"] == MIN_MAX_BLOB_BYTES


def test_maximum_boundary_accepted(owner_client):
    r = owner_client.put("/api/admin/settings", json={"max_blob_bytes": MAX_MAX_BLOB_BYTES})
    assert r.status_code == 200
    assert r.json()["max_blob_bytes"] == MAX_MAX_BLOB_BYTES


# --- Enforcement genuinely reads the DB value, not Settings.max_blob_bytes -


def test_admin_lowered_limit_rejects_a_blob_the_old_config_limit_would_accept(make_app, make_settings):
    # Config/env default is 5 MB (config.py) — a 2 MB blob would have been
    # accepted under it.
    settings = make_settings(max_blob_bytes=5 * 1024 * 1024)
    app = make_app(settings=settings)
    client = TestClient(app)
    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com", is_admin=True))
    db.commit()
    db.close()
    client.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    two_mb = b"x" * (2 * 1024 * 1024)
    before = client.post("/api/blobs", files={"file": ("a.md", two_mb, "text/markdown")})
    assert before.status_code == 201, before.text  # accepted under the 5 MB config default

    lowered = client.put("/api/admin/settings", json={"max_blob_bytes": MIN_MAX_BLOB_BYTES})
    assert lowered.status_code == 200

    after = client.post("/api/blobs", files={"file": ("b.md", two_mb, "text/markdown")})
    assert after.status_code == 413, after.text  # same content, now rejected under the DB-set 1 MB limit


def test_admin_raised_limit_accepts_a_blob_the_old_config_limit_would_reject(make_app, make_settings):
    # Config/env default is tiny (1 MB) — a 2 MB blob would have been
    # rejected under it.
    settings = make_settings(max_blob_bytes=MIN_MAX_BLOB_BYTES)
    app = make_app(settings=settings)
    client = TestClient(app)
    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com", is_admin=True))
    db.commit()
    db.close()
    client.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    two_mb = b"x" * (2 * 1024 * 1024)
    before = client.post("/api/blobs", files={"file": ("a.md", two_mb, "text/markdown")})
    assert before.status_code == 413, before.text  # rejected under the 1 MB config default

    raised = client.put("/api/admin/settings", json={"max_blob_bytes": 10 * 1024 * 1024})
    assert raised.status_code == 200

    after = client.post("/api/blobs", files={"file": ("b.md", two_mb, "text/markdown")})
    assert after.status_code == 201, after.text  # same content, now accepted under the DB-set 10 MB limit


def test_share_editor_put_also_enforces_db_value(make_app, make_settings):
    """`PUT /share/{id}` (the editor write-back path, share_public.py) reads
    the same DB-backed value as `POST /api/blobs` — not a second,
    independently-wired copy of the config default."""
    settings = make_settings(max_blob_bytes=5 * 1024 * 1024)
    app = make_app(settings=settings)
    client = TestClient(app)
    db = app.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com", is_admin=True))
    db.commit()
    db.close()
    client.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    blob = client.post("/api/blobs", files={"file": ("a.md", b"hello", "text/markdown")})
    blob_id = blob.json()["id"]
    share = client.post(
        "/api/shares",
        json={
            "source_path": "notes/x.md",
            "blob_id": blob_id,
            "render_mode": "raw",
            "general_access": "link",
            "auth_mode": "none",
            "grants": [{"principal": "o@x.com", "role": "editor"}],
        },
    )
    assert share.status_code == 201, share.text
    slug = share.json()["slug"]

    lowered = client.put("/api/admin/settings", json={"max_blob_bytes": MIN_MAX_BLOB_BYTES})
    assert lowered.status_code == 200

    two_mb = b"x" * (2 * 1024 * 1024)
    put = client.put(f"/share/{slug}", content=two_mb)
    assert put.status_code == 413, put.text


# --- Env-seeding precedence -----------------------------------------------


def test_env_var_seeds_first_boot_only(make_settings):
    base = make_settings(max_blob_bytes=3 * 1024 * 1024)
    app1 = create_app(base)

    db = app1.state.SessionLocal()
    try:
        row = db.query(models.RuntimeSettings).one()
        assert row.max_blob_bytes == 3 * 1024 * 1024
    finally:
        db.close()


def test_env_var_does_not_override_admin_set_value_on_restart(make_settings):
    base = make_settings(max_blob_bytes=3 * 1024 * 1024)
    app1 = create_app(base)
    client1 = TestClient(app1)
    db = app1.state.SessionLocal()
    db.add(models.User(username="owner", password_hash=security.hash_password("pw1234567"), email="o@x.com", is_admin=True))
    db.commit()
    db.close()
    client1.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    put = client1.put("/api/admin/settings", json={"max_blob_bytes": 42 * 1024 * 1024})
    assert put.status_code == 200

    # "Restart": a NEW app instance, same db_url/git_root, a DIFFERENT
    # VSNOTE_MAX_BLOB_BYTES value. The admin-set value must survive
    # untouched — the env var only ever seeds an EMPTY table.
    restarted_settings = Settings(**{**base.model_dump(), "max_blob_bytes": 7 * 1024 * 1024})
    app2 = create_app(restarted_settings)
    client2 = TestClient(app2)
    client2.post("/api/auth/login", json={"username": "owner", "password": "pw1234567"})

    r = client2.get("/api/admin/settings")
    assert r.status_code == 200
    assert r.json()["max_blob_bytes"] == 42 * 1024 * 1024  # NOT 7 MB, NOT the original 3 MB seed


# --- Audit ------------------------------------------------------------


def _audit_events(app):
    db = app.state.SessionLocal()
    try:
        return db.query(models.AuditEvent).order_by(models.AuditEvent.id).all()
    finally:
        db.close()


def test_settings_update_writes_audit_event(app, owner_client):
    """Item 40: "Audit-log the change like other admin actions." The route
    writes the event; without this test the call could be deleted and every
    other admin-settings test would still pass."""
    r = owner_client.put("/api/admin/settings", json={"max_blob_bytes": 9 * 1024 * 1024})
    assert r.status_code == 200

    events = [e for e in _audit_events(app) if e.event == "admin.settings_update"]
    assert len(events) == 1, "the admin settings change was not audit-logged"
    assert events[0].principal == "owner@example.com"
    # The new value belongs in the audit trail (that IS the point of the
    # record), but the internal reason string must not reach the client —
    # same discipline test_audit.py pins for policy denials.
    assert "9437184" in (events[0].reason or "")
    assert "reason" not in r.text


def test_denied_settings_update_writes_no_audit_event_and_changes_nothing(app, owner_client):
    _create_non_admin(app)
    client = TestClient(app)
    _login_non_admin(client)
    before = owner_client.get("/api/admin/settings").json()["max_blob_bytes"]

    assert client.put("/api/admin/settings", json={"max_blob_bytes": 50 * 1024 * 1024}).status_code == 403

    assert [e for e in _audit_events(app) if e.event == "admin.settings_update"] == []
    assert owner_client.get("/api/admin/settings").json()["max_blob_bytes"] == before

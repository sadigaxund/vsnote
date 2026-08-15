"""Audit log coverage: every deny + auth failure writes a row, and the
INTERNAL reason string never leaks into a client-facing response body."""

from __future__ import annotations

from app import models
from conftest import publish_share, random_wellformed_slug


def _events(app):
    db = app.state.SessionLocal()
    try:
        return db.query(models.AuditEvent).order_by(models.AuditEvent.id).all()
    finally:
        db.close()


def test_policy_deny_writes_audit_event(anon_client, app):
    anon_client.get("/share/bad slug!!")
    events = _events(app)
    assert any(e.event == "policy.deny" and e.reason == "malformed_slug" for e in events)


def test_nonexistent_slug_writes_audit_event(anon_client, app):
    anon_client.get(f"/share/{random_wellformed_slug()}")
    events = _events(app)
    assert any(e.event == "policy.deny" and e.reason == "nonexistent" for e in events)


def test_revoked_share_deny_writes_audit_event(owner_client, app):
    share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{share['id']}")
    owner_client.get(f"/share/{share['slug']}")
    events = _events(app)
    assert any(e.event == "policy.deny" and e.reason == "revoked" and e.slug == share["slug"] for e in events)


def test_login_success_and_failure_audit_events(owner_client, app):
    events = _events(app)
    assert any(e.event == "login.success" for e in events)

    owner_client.post("/api/auth/login", json={"username": "owner", "password": "wrong"})
    events = _events(app)
    assert any(e.event == "login.failure" for e in events)


def test_audit_reason_never_leaks_into_response_body(owner_client, anon_client):
    reason_substrings = ("malformed_slug", "nonexistent", "revoked", "expired", "password_required", "restricted_")

    share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{share['id']}")

    responses = [
        anon_client.get("/share/bad slug!!"),
        anon_client.get(f"/share/{random_wellformed_slug()}"),
        anon_client.get(f"/share/{share['slug']}"),  # revoked
    ]
    for r in responses:
        for reason_substring in reason_substrings:
            assert reason_substring not in r.text

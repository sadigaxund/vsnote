"""Every deny path of the policy gate (policy.py), named 1:1 against
docs/ROADMAP-SHARING-AUTH.md §1's security posture checklist, plus the
uniform-deny equivalence matrix (see policy.py's module docstring for the
full "why every reason collapses to the same 404" rationale — a prior
version of this gate only equated ONE pair of deny reasons, which left a
real, exploitable oracle between e.g. "revoked" (404) and "missing" (401);
this file's test_deny_state_equivalence_matrix is written specifically so
that bug class can't sneak back in unnoticed)."""

from __future__ import annotations

import time

from conftest import OWNER_EMAIL, publish_share, random_wellformed_slug

NOT_FOUND = {"detail": "Not found"}


def test_malformed_slug_404(client):
    r = client.get("/share/bad slug!!")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_nonexistent_slug_put_404(client):
    r = client.put(f"/share/{random_wellformed_slug()}", content=b"x")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_nonexistent_slug_auth_endpoint_404(client):
    r = client.post(f"/share/{random_wellformed_slug()}/auth", json={"password": "whatever"})
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_revoked_404(owner_client):
    share = publish_share(owner_client)
    r = owner_client.delete(f"/api/shares/{share['id']}")
    assert r.status_code == 200

    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_expired_404(owner_client):
    share = publish_share(owner_client, expires_at=time.time() - 60)
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_restricted_without_identity_404(owner_client, anon_client):
    share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "friend@example.com", "role": "viewer"}],
    )
    # anon_client is a genuinely separate, unauthenticated caller.
    r = anon_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_restricted_wrong_identity_404(owner_client):
    # owner_client IS authenticated (as the owner) but the owner is not on
    # the grant list — a real, logged-in identity that's simply not allowed.
    share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "someone-else@example.com", "role": "viewer"}],
    )
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_restricted_with_correct_identity_200(owner_client):
    share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "viewer"}],
    )
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 200


def test_viewer_attempting_put_404(owner_client):
    # general_access="link" defaults to viewer for anyone without an
    # explicit editor grant — including the owner themselves here.
    share = publish_share(owner_client, general_access="link", auth_mode="none")
    r = owner_client.put(f"/share/{share['slug']}", content=b"new content")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_editor_put_200(owner_client):
    share = publish_share(
        owner_client,
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.put(f"/share/{share['slug']}", content=b"new content")
    assert r.status_code == 200, r.text

    r2 = owner_client.get(f"/share/{share['slug']}")
    assert r2.status_code == 200
    assert r2.content == b"new content"


def test_password_wrong_404(owner_client):
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
    r = owner_client.post(f"/share/{share['slug']}/auth", json={"password": "definitely-wrong"})
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_password_get_without_session_is_404(owner_client):
    # NOT a 401 challenge — see policy.py's module docstring. A live,
    # password-protected share must be indistinguishable, from a bare GET
    # with no session, from every other deny reason (including "doesn't
    # exist at all"). The client's only recourse is to always offer a
    # password field on 404 and blindly POST it to .../auth.
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_password_right_sets_cookie_then_get_200(anon_client, owner_client):
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")

    r = anon_client.post(f"/share/{share['slug']}/auth", json={"password": "s3cret-pw"})
    assert r.status_code == 200, r.text
    assert any(c.name.startswith("slate_share_") for c in anon_client.cookies.jar)

    r2 = anon_client.get(f"/share/{share['slug']}")
    assert r2.status_code == 200
    assert r2.content == b"hello world"


def test_token_mode_missing_token_404(owner_client):
    share = publish_share(owner_client, auth_mode="token")
    r = owner_client.get(f"/share/{share['slug']}")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_token_mode_invalid_token_404(owner_client):
    share = publish_share(owner_client, auth_mode="token")
    r = owner_client.get(f"/share/{share['slug']}", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_token_mode_revoked_token_rejected(owner_client, anon_client):
    share = publish_share(owner_client, auth_mode="token")
    tr = owner_client.post("/api/auth/tokens", json={"name": "script", "scope": "read"})
    assert tr.status_code == 201, tr.text
    plaintext = tr.json()["token"]
    token_id = tr.json()["id"]

    # Works while live.
    r = anon_client.get(f"/share/{share['slug']}", headers={"Authorization": f"Bearer {plaintext}"})
    assert r.status_code == 200

    revoke = owner_client.delete(f"/api/auth/tokens/{token_id}")
    assert revoke.status_code == 200

    r2 = anon_client.get(f"/share/{share['slug']}", headers={"Authorization": f"Bearer {plaintext}"})
    assert r2.status_code == 404
    assert r2.json() == NOT_FOUND


def test_no_existence_oracle_on_auth_endpoint(owner_client, anon_client):
    """POST .../auth: wrong password on a real share vs. a nonexistent slug
    must also be indistinguishable (both plain 404s here — no other shape
    at all on this endpoint, by design)."""
    share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")

    wrong_pw_resp = anon_client.post(f"/share/{share['slug']}/auth", json={"password": "nope"})
    fake_resp = anon_client.post(f"/share/{random_wellformed_slug()}/auth", json={"password": "nope"})

    assert wrong_pw_resp.status_code == fake_resp.status_code == 404
    assert wrong_pw_resp.json() == fake_resp.json() == NOT_FOUND


# --- The equivalence matrix -------------------------------------------
#
# Every state below is a DIFFERENT reason for the SAME outward observation
# ("I have a slug/identifier and no valid credentials") to be denied. If
# the gate is really uniform, fingerprinting every one of these responses
# must produce exactly ONE distinct value — not "these two happen to
# match", every pairwise comparison across the whole set.

_IGNORED_HEADERS = {
    "date",
    "content-length",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "retry-after",
}


def _fingerprint(resp):
    headers = tuple(sorted((k.lower(), v) for k, v in resp.headers.items() if k.lower() not in _IGNORED_HEADERS))
    return (resp.status_code, resp.content, headers)


def _build_deny_states(owner_client, anon_client):
    """Returns {state_name: response} for GET /share/{id} across every
    documented deny reason. Each state is deliberately constructed so the
    ONLY difference between it and the others is the reason for denial."""
    states = {}

    states["malformed"] = anon_client.get("/share/bad slug!!")
    states["nonexistent"] = anon_client.get(f"/share/{random_wellformed_slug()}")

    revoked_share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{revoked_share['id']}")
    states["revoked"] = anon_client.get(f"/share/{revoked_share['slug']}")

    expired_share = publish_share(owner_client, expires_at=time.time() - 60)
    states["expired"] = anon_client.get(f"/share/{expired_share['slug']}")

    restricted_share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "someone-else@example.com", "role": "viewer"}],
    )
    states["restricted_no_identity"] = anon_client.get(f"/share/{restricted_share['slug']}")
    # owner_client IS authenticated, just not on the grant list.
    states["restricted_wrong_identity"] = owner_client.get(f"/share/{restricted_share['slug']}")

    token_share = publish_share(owner_client, auth_mode="token")
    states["token_required"] = anon_client.get(f"/share/{token_share['slug']}")
    states["invalid_token"] = anon_client.get(
        f"/share/{token_share['slug']}", headers={"Authorization": "Bearer not-a-real-token"}
    )

    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
    states["password_required"] = anon_client.get(f"/share/{password_share['slug']}")

    return states


def test_deny_state_equivalence_matrix_raw_route(owner_client, anon_client):
    states = _build_deny_states(owner_client, anon_client)
    fingerprints = {name: _fingerprint(resp) for name, resp in states.items()}
    distinct = set(fingerprints.values())
    assert len(distinct) == 1, (
        "GET /share/{id} deny responses are NOT uniform — grouped by fingerprint:\n"
        + "\n".join(f"  {fp}: {[n for n, f in fingerprints.items() if f == fp]}" for fp in distinct)
    )
    # And explicitly the expected shape, not just "internally consistent".
    only_fp = next(iter(distinct))
    assert only_fp[0] == 404
    assert only_fp[1] == b'{"detail":"Not found"}'


def test_deny_state_equivalence_matrix_content_route(owner_client, anon_client):
    """Same matrix, against GET /api/share/{id}/content (the CORS-enabled
    twin route) — must be equally uniform."""
    states = {}

    states["malformed"] = anon_client.get("/api/share/bad slug!!/content")
    states["nonexistent"] = anon_client.get(f"/api/share/{random_wellformed_slug()}/content")

    revoked_share = publish_share(owner_client)
    owner_client.delete(f"/api/shares/{revoked_share['id']}")
    states["revoked"] = anon_client.get(f"/api/share/{revoked_share['slug']}/content")

    expired_share = publish_share(owner_client, expires_at=time.time() - 60)
    states["expired"] = anon_client.get(f"/api/share/{expired_share['slug']}/content")

    restricted_share = publish_share(
        owner_client,
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": "someone-else@example.com", "role": "viewer"}],
    )
    states["restricted_no_identity"] = anon_client.get(f"/api/share/{restricted_share['slug']}/content")

    password_share = publish_share(owner_client, auth_mode="password", password="s3cret-pw")
    states["password_required"] = anon_client.get(f"/api/share/{password_share['slug']}/content")

    fingerprints = {name: _fingerprint(resp) for name, resp in states.items()}
    distinct = set(fingerprints.values())
    assert len(distinct) == 1, (
        "GET /api/share/{id}/content deny responses are NOT uniform — grouped by fingerprint:\n"
        + "\n".join(f"  {fp}: {[n for n, f in fingerprints.items() if f == fp]}" for fp in distinct)
    )

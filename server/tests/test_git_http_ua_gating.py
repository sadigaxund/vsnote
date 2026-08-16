"""Phase 12 (DESIGN-SPEC Amendments round 4, item 26a) — the `/git`
`WWW-Authenticate: Basic` challenge is gated to git-shaped `User-Agent`s only.

Why this matters (the headline user-visible bug this fixes): a browser
`fetch()` that receives ANY 401 carrying `WWW-Authenticate: Basic` pops the
browser's own NATIVE credential dialog — the user saw this roughly every 60s
from `App.tsx`'s background `/git` poll while signed out. Real git clients,
conversely, NEED that header — it's the signal git's own credential-helper
machinery watches for. `git_http.py::_is_git_client`/`_unauthenticated_response`
make the header's presence conditional on `User-Agent` starting with `git/`
(case-insensitive; a missing UA is NOT treated as a git client), while
leaving the status code, body, and authorization decision itself completely
unchanged — proven below by comparing the two response bodies/statuses
byte-for-byte, not just asserting each independently.

`test_git_sync.py`'s existing anonymous-git-request test (now sending an
explicit `git/2.43.0` UA) and its live-`uvicorn` + real system-git round-trip
tests (system git always sends a real `git/…` UA on its own) are the
regression backstop that this change never breaks the actual git-client
flow — this file only adds the NEW browser/missing-UA coverage.
"""

from __future__ import annotations

GIT_PATH = "/git/somerepo.git/info/refs?service=git-upload-pack"

# A realistic Chrome UA + Accept header shape, matching what a real browser
# fetch (e.g. isomorphic-git's http/web transport, which cannot override
# User-Agent at all — it's a forbidden header per the Fetch spec, so the
# browser's own UA always goes out unmodified) would actually send.
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)
BROWSER_ACCEPT = "*/*"

GIT_UA = "git/2.43.0"


def _get(client, *, user_agent) -> "httpx.Response":  # noqa: F821 - typing only, not imported
    headers = {"Accept": BROWSER_ACCEPT}
    if user_agent is not None:
        headers["User-Agent"] = user_agent
        return client.get(GIT_PATH, headers=headers)
    # A truly ABSENT User-Agent header (not merely empty) — TestClient's
    # underlying httpx Client stamps a default "testclient" UA onto every
    # request via `client.headers`, so removing it there (rather than
    # passing an empty string, which is still a present-but-empty header) is
    # the only way to reproduce a real "no UA at all" request.
    if "user-agent" in client.headers:
        del client.headers["user-agent"]
    return client.get(GIT_PATH, headers=headers)


def test_browser_shaped_request_gets_401_without_challenge(client, owner):
    r = _get(client, user_agent=BROWSER_UA)
    assert r.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in r.headers.keys()}


def test_git_shaped_request_gets_401_with_challenge(client, owner):
    r = _get(client, user_agent=GIT_UA)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == 'Basic realm="vsnote-git"'


def test_missing_user_agent_gets_401_without_challenge(client, owner):
    r = _get(client, user_agent=None)
    assert r.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in r.headers.keys()}


def test_git_ua_matching_is_case_insensitive(client, owner):
    r = _get(client, user_agent="GIT/2.43.0")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == 'Basic realm="vsnote-git"'


def test_browser_and_git_responses_are_otherwise_byte_identical(client, owner):
    """The ONLY difference between the two response classes must be the
    presence of `WWW-Authenticate` — same status, same body. A regression
    that (for example) also changed the body text for one UA class but not
    the other would slip past the two tests above in isolation; this
    comparison catches that."""
    browser_resp = _get(client, user_agent=BROWSER_UA)
    git_resp = _get(client, user_agent=GIT_UA)

    assert browser_resp.status_code == git_resp.status_code == 401
    assert browser_resp.content == git_resp.content

    browser_headers = {k.lower(): v for k, v in browser_resp.headers.items()}
    git_headers = {k.lower(): v for k, v in git_resp.headers.items()}
    assert "www-authenticate" not in browser_headers
    assert git_headers["www-authenticate"] == 'Basic realm="vsnote-git"'
    # Every OTHER header matches between the two classes.
    only_www_authenticate_differs = {k: v for k, v in git_headers.items() if k != "www-authenticate"}
    assert browser_headers == only_www_authenticate_differs


def test_authorized_request_unaffected_by_ua(client, owner, db_session):
    """The UA gate touches ONLY the anonymous/unauthenticated 401 path —
    an authenticated (even git-shaped) request's outcome must be identical
    to what it always was, proving this change never touched the
    authorization decision itself."""
    from app import models, security

    token = "ua-gating-read-token"
    db_session.add(
        models.ApiToken(
            user_id=owner.id,
            name="r",
            token_hash=security.hash_token(token),
            prefix=token[:12],
            scope=models.TokenScope.read,
        )
    )
    db_session.commit()

    for ua in (BROWSER_UA, GIT_UA, None):
        headers = {"Authorization": f"Bearer {token}"}
        if ua is not None:
            headers["User-Agent"] = ua
            r = client.get("/git/never-created.git/info/refs?service=git-upload-pack", headers=headers)
        else:
            if "user-agent" in client.headers:
                del client.headers["user-agent"]
            r = client.get("/git/never-created.git/info/refs?service=git-upload-pack", headers=headers)
        # authenticated fine, repo just doesn't exist yet — same regardless
        # of what UA the caller presented.
        assert r.status_code == 404

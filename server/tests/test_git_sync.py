"""Phase 11 (real sync) — `/git/{repo}.git/...` smart-HTTP server.

Two tiers, matching the module docstrings this suite is pinning:
  - `TestClient` (httpx-over-ASGI, no real socket) for everything that's a
    single request/response: repo-name validation, anonymous rejection,
    scope enforcement. Fast, no subprocess.
  - A REAL `uvicorn` server on an OS-assigned loopback port
    (`live_server` fixture below) for the actual round-trip, because that
    needs a real git smart-HTTP client talking real HTTP framing — `git`
    itself (system git, confirmed 2.43.0 in this environment) via
    `subprocess`, not something `TestClient`'s ASGI transport can drive.
"""

from __future__ import annotations

import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn

from app import models, security
from app.gitrepo import InvalidRepoName, resolve_repo_path
from app.main import create_app


# --- resolve_repo_path: pure unit tests, no app/server needed --------------


def test_repo_name_validation_rejects_traversal(tmp_path):
    root = tmp_path / "gitroot"
    root.mkdir()
    with pytest.raises(InvalidRepoName):
        resolve_repo_path(root, "/../etc.git")
    with pytest.raises(InvalidRepoName):
        resolve_repo_path(root, "/../../etc/passwd.git")
    with pytest.raises(InvalidRepoName):
        resolve_repo_path(root, "/foo/bar.git")  # '/' inside the name
    with pytest.raises(InvalidRepoName):
        resolve_repo_path(root, "/.git")  # empty name
    with pytest.raises(InvalidRepoName):
        resolve_repo_path(root, "/no-dot-git-suffix")


def test_repo_name_validation_rejects_bad_characters(tmp_path):
    root = tmp_path / "gitroot"
    root.mkdir()
    for bad in ["/weird name.git", "/semi;colon.git", "/percent%2e%2e.git", "/dot.dot..git"]:
        with pytest.raises(InvalidRepoName):
            resolve_repo_path(root, bad)


def test_repo_name_validation_accepts_wellformed_and_stays_inside_root(tmp_path):
    root = tmp_path / "gitroot"
    root.mkdir()
    resolved = resolve_repo_path(root, "/my-vault_01.git")
    assert resolved == (root / "my-vault_01.git").resolve()
    assert root.resolve() in resolved.parents


# --- Auth/scope enforcement over TestClient (no real socket needed) --------


def _write_token(db_session) -> str:
    plaintext = "write-scope-token"
    db_session.add(
        models.ApiToken(
            user_id=1,
            name="w",
            token_hash=security.hash_token(plaintext),
            prefix=plaintext[:12],
            scope=models.TokenScope.write,
        )
    )
    db_session.commit()
    return plaintext


def _read_token(db_session) -> str:
    plaintext = "read-scope-token"
    db_session.add(
        models.ApiToken(
            user_id=1,
            name="r",
            token_hash=security.hash_token(plaintext),
            prefix=plaintext[:12],
            scope=models.TokenScope.read,
        )
    )
    db_session.commit()
    return plaintext


def test_anonymous_git_request_rejected_with_basic_challenge(client, owner):
    r = client.get("/git/somerepo.git/info/refs?service=git-upload-pack")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == 'Basic realm="slate-git"'


def test_bad_token_rejected(client, owner):
    r = client.get(
        "/git/somerepo.git/info/refs?service=git-upload-pack",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 401


def test_malformed_repo_path_rejected(client, owner, db_session):
    token = _write_token(db_session)
    # No '.git' suffix at all — never reaches the backend/regex ambiguity,
    # the auth middleware's own routing regex rejects it outright.
    r = client.get(
        "/git/somerepo/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_read_scope_sufficient_for_fetch_of_missing_repo_is_still_404_not_401(client, owner, db_session):
    # A valid READ token against a repo that doesn't exist yet must be
    # distinguishable from "not authenticated at all" — dulwich itself
    # returns 404 for a missing repo once auth has already passed.
    token = _read_token(db_session)
    r = client.get(
        "/git/never-created.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_read_scope_push_refused(client, owner, db_session):
    token = _read_token(db_session)
    r = client.post(
        "/git/somerepo.git/git-receive-pack",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-git-receive-pack-request"},
        content=b"0000",
    )
    assert r.status_code == 403


def test_write_scope_push_advertise_refused_for_read_scope_via_info_refs(client, owner, db_session):
    # The pre-push `info/refs?service=git-receive-pack` advertisement is
    # ALSO gated on write scope — a read-only token must never learn it
    # could push (or trigger bare-repo auto-creation) via that route either.
    token = _read_token(db_session)
    r = client.get(
        "/git/somerepo.git/info/refs?service=git-receive-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_basic_auth_with_token_as_password_accepted(client, owner, db_session):
    import base64

    token = _read_token(db_session)
    basic = base64.b64encode(f"anyuser:{token}".encode()).decode()
    r = client.get(
        "/git/never-created.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Basic {basic}"},
    )
    assert r.status_code == 404  # authenticated fine, repo just doesn't exist


def test_basic_auth_with_token_as_username_accepted(client, owner, db_session):
    import base64

    token = _read_token(db_session)
    basic = base64.b64encode(f"{token}:".encode()).decode()
    r = client.get(
        "/git/never-created.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Basic {basic}"},
    )
    assert r.status_code == 404


def test_git_routes_have_no_cors_headers_for_spa_origin(client, owner, db_session):
    # Single-origin refactor (roadmap §5.4): `/git/*` is same-origin from the
    # browser now (the sync remote is implicitly `<origin>/git/vault.git`),
    # so it carries NO CORS headers at all — not even for the SPA's own
    # origin. Mirrors `test_raw_mode.py::test_no_cors_on_raw_even_for_
    # allowed_spa_origin`'s reasoning for `/share/*`.
    token = _read_token(db_session)
    r = client.get(
        "/git/never-created.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {token}", "Origin": "http://127.0.0.1:5290"},
    )
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


def test_git_routes_deny_cors_for_unconfigured_origin(client, owner, db_session):
    token = _read_token(db_session)
    r = client.get(
        "/git/never-created.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {token}", "Origin": "http://evil.example.com"},
    )
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


# --- Real round-trip: a live uvicorn server + real system git --------------


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def live_server(make_settings, tmp_path):
    """Spins up a REAL uvicorn instance (its own isolated sqlite db + git
    root, `tmp_path`-scoped) on an OS-assigned loopback port, bootstraps one
    owner with a write-scoped token, and tears the server down afterward.
    Never binds a fixed port — this suite has no reserved port of its own
    (see CLAUDE.md's port table; 8787/8788 belong to other things), so an
    OS-assigned ephemeral port is the only collision-free choice for a suite
    that may run concurrently with other pytest workers.
    """
    settings = make_settings(git_root=str(tmp_path / "gitroot"))
    app = create_app(settings)

    SessionLocal = app.state.SessionLocal
    db = SessionLocal()
    user = models.User(username="live-owner", password_hash=None, email="live@example.com", is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    write_token = "live-write-token"
    read_token = "live-read-token"
    db.add(
        models.ApiToken(
            user_id=user.id, name="w", token_hash=security.hash_token(write_token), prefix=write_token[:12], scope=models.TokenScope.write
        )
    )
    db.add(
        models.ApiToken(
            user_id=user.id, name="r", token_hash=security.hash_token(read_token), prefix=read_token[:12], scope=models.TokenScope.read
        )
    )
    db.commit()
    db.close()

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "live uvicorn server did not start in time"

    yield {
        "base_url": f"http://127.0.0.1:{port}",
        "port": port,
        "write_token": write_token,
        "read_token": read_token,
    }

    server.should_exit = True
    thread.join(timeout=10)


def _run_git(args: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    import os

    full_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})}
    return subprocess.run(["git", *args], cwd=str(cwd), env=full_env, capture_output=True, text=True, timeout=30)


def test_live_round_trip_init_push_ref_exists_in_bare_repo(live_server, tmp_path):
    """The headline server-side proof: a real `git push` (system git,
    smart-HTTP, real TCP) against a repo that doesn't exist yet creates it
    (bare, on demand) and the pushed ref/commit is really there afterward —
    verified by opening the bare repo directly with dulwich, not just by
    asking the server back (that would only prove the server's own view is
    self-consistent, not that real bytes landed on disk)."""
    src = tmp_path / "src"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("hello from pytest\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "initial commit"], cwd=src)

    push_url = f"http://x:{live_server['write_token']}@127.0.0.1:{live_server['port']}/git/pytest-repo.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode == 0, f"push failed: {result.stderr}"

    # Verify directly on disk with dulwich — independent of the server's
    # own read path.
    from dulwich.repo import Repo as DulwichRepo

    bare_path = tmp_path / "gitroot" / "pytest-repo.git"
    assert bare_path.is_dir()
    repo = DulwichRepo(str(bare_path))
    ref = repo.refs[b"refs/heads/main"]
    commit = repo[ref]
    assert commit.message.decode().strip() == "initial commit"
    tree = repo[commit.tree]
    blob = repo[tree[b"note.md"][1]]
    assert blob.data == b"hello from pytest\n"
    repo.close()


def test_live_fetch_without_thin_pack_capability_returns_real_objects(live_server, tmp_path):
    """Regression test for a real interop bug found verifying this phase
    against a real browser client: dulwich's default `UploadPackHandler`
    REQUIRES the `thin-pack` capability and, when a client omits it (as
    isomorphic-git's `fetch()` always does — confirmed by logging its
    actual request), raises `GitProtocolError` from deep inside pack
    generation — AFTER the HTTP response has already started, so the
    failure is invisible on the wire: `200 OK` with real headers, then a
    silently-truncated EMPTY body. `git_http.py`'s
    `BrowserCompatibleUploadPackHandler` drops `thin-pack` from the
    required set to fix this. This test replays the exact byte-for-byte
    negotiation shape isomorphic-git sends (want/have/done, NO thin-pack in
    the capability string) directly over HTTP — not via isomorphic-git
    itself, so this suite doesn't need a JS runtime — and asserts the
    response body is non-empty and contains real pack bytes ("PACK" magic,
    once unwrapped from the side-band-64k pkt-line framing dulwich uses).
    """
    import httpx

    src = tmp_path / "src_thinpack"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("v1\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "v1"], cwd=src)
    base_oid = _run_git(["rev-parse", "HEAD"], cwd=src).stdout.strip()

    push_url = f"http://x:{live_server['write_token']}@127.0.0.1:{live_server['port']}/git/pytest-thinpack.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode == 0, f"push failed: {result.stderr}"

    # A second commit — the "have" line below advertises `base_oid` (what a
    # client that only has v1 already possesses), so the server MUST
    # generate a real, non-empty pack for the objects introduced by this
    # second commit to satisfy the "want". A `want == have` request
    # (nothing missing) wouldn't exercise the actual bug: dulwich would
    # legitimately return an empty-but-valid pack either way.
    (src / "note.md").write_text("v2\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "v2"], cwd=src)
    tip_oid = _run_git(["rev-parse", "HEAD"], cwd=src).stdout.strip()
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode == 0, f"second push failed: {result.stderr}"

    def pkt_line(data: bytes) -> bytes:
        return f"{len(data) + 4:04x}".encode() + data

    # Deliberately mirrors isomorphic-git's actual capability string
    # (logged during manual verification): multi_ack_detailed, no-done,
    # side-band-64k, ofs-delta — NEVER thin-pack.
    body = (
        pkt_line(f"want {tip_oid} multi_ack_detailed no-done side-band-64k ofs-delta\n".encode())
        + b"0000"
        + pkt_line(f"have {base_oid}\n".encode())
        + b"0009done\n"
    )

    base_url = f"http://127.0.0.1:{live_server['port']}"
    resp = httpx.post(
        f"{base_url}/git/pytest-thinpack.git/git-upload-pack",
        headers={
            "Authorization": f"Bearer {live_server['write_token']}",
            "Content-Type": "application/x-git-upload-pack-request",
            "Accept": "application/x-git-upload-pack-result",
        },
        content=body,
        timeout=10,
    )
    assert resp.status_code == 200
    assert len(resp.content) > 0, "regression: empty body means the thin-pack bug is back"
    assert b"PACK" in resp.content, "response should contain real pack data (PACK magic), not just protocol chatter"


def test_live_tokenless_push_rejected(live_server, tmp_path):
    src = tmp_path / "src2"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("no token here\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "c"], cwd=src)

    # Explicit empty credentials so git actually sends the request instead
    # of hanging on an interactive username prompt.
    push_url = f"http://x:@127.0.0.1:{live_server['port']}/git/pytest-repo-2.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode != 0
    assert "401" in result.stderr or "Authentication" in result.stderr or "authentication" in result.stderr.lower()

    bare_path = tmp_path / "gitroot" / "pytest-repo-2.git"
    assert not bare_path.exists()  # never auto-created for a rejected request


def test_live_read_scope_push_refused_over_real_git(live_server, tmp_path):
    src = tmp_path / "src3"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("read only\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "c"], cwd=src)

    push_url = f"http://x:{live_server['read_token']}@127.0.0.1:{live_server['port']}/git/pytest-repo-3.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode != 0
    assert "403" in result.stderr

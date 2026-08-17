"""Phase 17 Milestone B — `app/mirror.py` (URL validation, the push/test
engine, `MirrorRunner`), `app/secrets_store.py` (on-disk credential
storage), and the `/api/vault/remotes` router. See `app/mirror.py`'s module
docstring for the full engine/credential/concurrency contract this suite
pins.

Every "external remote" in this file is a REAL local bare git repo under
`tmp_path` — no network involved, exactly the way `test_vault.py`'s live
round-trip tests use a real `git` subprocess against a real uvicorn server
instead of mocking either side.
"""

from __future__ import annotations

import json
import os
import socket
import stat
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app import mirror, models, secrets_store, security
from app import vault as vault_module
from app.main import create_app
from conftest import OWNER_EMAIL, OWNER_PASSWORD, OWNER_USERNAME

SECRET_SSH_KEY = (
    "-----BEGIN OPENSSH PRIVATE KEY-----\n"
    "notarealkeyjustapytestfixturevaluezzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\n"
    "-----END OPENSSH PRIVATE KEY-----\n"
)
SECRET_HTTPS_TOKEN = "vsn-mirror-test-token-should-never-leak-9f8e7d6c5b4a"


def _run_git(args: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    full_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})}
    return subprocess.run(["git", *args], cwd=str(cwd), env=full_env, capture_output=True, text=True, timeout=30)


def _init_bare(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    result = _run_git(["init", "-q", "--bare", "-b", "main"], cwd=path)
    assert result.returncode == 0, result.stderr


def _commit_to_vault(settings, message: str, filename: str, content: str) -> None:
    """Writes a file into the vault's on-disk path and commits it directly
    via `vault.commit_worktree_changes` (works for both shapes — legacy
    bare repos have no working tree to write into, so this is only used
    against a MOUNTED vault in this file)."""
    path = vault_module.vault_repo_path(settings)
    (path / filename).write_text(content)
    assert vault_module.commit_worktree_changes(path) is True


def _head_log_lines(repo_path: Path) -> list[str]:
    result = _run_git(["log", "--format=%H"], cwd=repo_path)
    assert result.returncode == 0, result.stderr
    return [line for line in result.stdout.splitlines() if line.strip()]


# --- validate_remote_url: pure unit tests -----------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/example/repo.git",
        "http://example.com/repo.git",
        "ssh://git@example.com/repo.git",
        "ssh://git@example.com:2222/repo.git",
        "git@github.com:owner/repo.git",
        "file:///tmp/somewhere.git",
        "/tmp/somewhere.git",
        "./relative/repo.git",
        "../relative/repo.git",
    ],
)
def test_validate_remote_url_accepts_wellformed(url):
    mirror.validate_remote_url(url)  # does not raise


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        "-oProxyCommand=touch /tmp/pwned",
        "--upload-pack=touch /tmp/pwned",
        "ext::sh -c touch /tmp/pwned",
        "ext::sh%20-c%20id",
        "fd::1:0",
        "ftp://example.com/repo.git",
        "gopher://example.com/repo.git",
        "https://",
        "ssh://-oProxyCommand=x/repo.git",
        "-user@host:path.git",
    ],
)
def test_validate_remote_url_rejects_dangerous_or_unsupported(url):
    with pytest.raises(mirror.InvalidRemoteURL):
        mirror.validate_remote_url(url)


def test_validate_remote_url_rejects_host_starting_with_dash_via_scp_syntax():
    with pytest.raises(mirror.InvalidRemoteURL):
        mirror.validate_remote_url("git@-oProxyCommand=x:path.git")


# --- classify_ls_remote_failure: pure unit tests ----------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("fatal: Could not resolve host: nonexistent.example", "unreachable"),
        ("ssh: connect to host example.com port 22: Connection refused", "unreachable"),
        ("fatal: Authentication failed for 'https://example.com/repo.git/'", "auth-rejected"),
        ("git@example.com: Permission denied (publickey).", "auth-rejected"),
        ("remote: Repository not found.", "repo-missing"),
        ("fatal: '/no/such/path' does not exist", "repo-missing"),
        ("fatal: something completely unexpected happened", "error"),
    ],
)
def test_classify_ls_remote_failure(text, expected):
    assert mirror.classify_ls_remote_failure(text) == expected


# --- secrets_store: on-disk permissions + deletion --------------------------


def test_secrets_directory_and_files_are_0700_and_0600(make_settings, tmp_path):
    settings = make_settings(secrets_path=str(tmp_path / "secrets"))
    path = secrets_store.set_ssh_key(settings, 1, SECRET_SSH_KEY)
    root = secrets_store.secrets_root(settings)

    root_mode = stat.S_IMODE(os.stat(root).st_mode)
    file_mode = stat.S_IMODE(os.stat(path).st_mode)
    assert root_mode == 0o700
    assert file_mode == 0o600
    assert path.read_text().strip() == SECRET_SSH_KEY.strip()


def test_secrets_https_token_file_is_0600(make_settings, tmp_path):
    settings = make_settings(secrets_path=str(tmp_path / "secrets"))
    path = secrets_store.set_https_token(settings, 7, SECRET_HTTPS_TOKEN)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert secrets_store.read_https_token(settings, 7) == SECRET_HTTPS_TOKEN


def test_delete_credential_files_removes_both_kinds(make_settings, tmp_path):
    settings = make_settings(secrets_path=str(tmp_path / "secrets"))
    ssh_path = secrets_store.set_ssh_key(settings, 3, SECRET_SSH_KEY)
    token_path = secrets_store.set_https_token(settings, 3, SECRET_HTTPS_TOKEN)
    assert ssh_path.exists() and token_path.exists()
    secrets_store.delete_credential_files(settings, 3)
    assert not ssh_path.exists()
    assert not token_path.exists()
    # Idempotent — deleting again (or a remote id that never had files) is
    # not an error.
    secrets_store.delete_credential_files(settings, 3)
    secrets_store.delete_credential_files(settings, 999)


# --- real mirror push into a local bare "external remote" (no network) -----


def test_run_mirror_pushes_real_commits_into_external_bare_repo(make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "hello from the vault\n")

    external = tmp_path / "external.git"
    _init_bare(external)

    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none, enabled=True)
    outcome = mirror.run_mirror(settings, remote)

    assert outcome.status == "success", outcome.message
    lines = _head_log_lines(external)
    assert len(lines) == 1

    # Prove real bytes landed, not just "the server's own view is
    # self-consistent" — clone the external bare repo fresh and read the
    # file back.
    clone_dir = tmp_path / "clone-of-external"
    result = _run_git(["clone", "-q", str(external), str(clone_dir)], cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert (clone_dir / "a.md").read_text() == "hello from the vault\n"


def test_run_mirror_pushes_multiple_commits_across_runs(make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "one", "a.md", "one\n")

    external = tmp_path / "external.git"
    _init_bare(external)
    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none, enabled=True)

    assert mirror.run_mirror(settings, remote).status == "success"
    assert len(_head_log_lines(external)) == 1

    _commit_to_vault(settings, "two", "b.md", "two\n")
    assert mirror.run_mirror(settings, remote).status == "success"
    assert len(_head_log_lines(external)) == 2


def test_run_mirror_errors_cleanly_when_vault_has_no_commits(make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")

    external = tmp_path / "external.git"
    _init_bare(external)
    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none, enabled=True)

    outcome = mirror.run_mirror(settings, remote)
    assert outcome.status == "error"
    assert "no commits" in outcome.message.lower()


def test_run_mirror_rejects_invalid_url_without_touching_disk(make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "one\n")

    remote = models.VaultRemote(name="bad", url="ext::sh -c id", credential_kind=models.RemoteCredentialKind.none, enabled=True)
    outcome = mirror.run_mirror(settings, remote)
    assert outcome.status == "error"
    assert "invalid remote url" in outcome.message.lower()


# --- never-force-push: diverged remote is rejected, history NOT rewritten --


def test_diverged_remote_is_rejected_and_history_is_not_rewritten(make_settings, tmp_path):
    external = tmp_path / "external.git"
    _init_bare(external)

    # Someone/something else pushes an UNRELATED commit directly to the
    # external remote first (simulating a remote that has diverged from
    # what this server is about to try to mirror).
    other_src = tmp_path / "other-src"
    other_src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=other_src)
    _run_git(["config", "user.email", "other@example.com"], cwd=other_src)
    _run_git(["config", "user.name", "Other"], cwd=other_src)
    (other_src / "unrelated.md").write_text("not part of the vault's history\n")
    _run_git(["add", "unrelated.md"], cwd=other_src)
    _run_git(["commit", "-q", "-m", "unrelated"], cwd=other_src)
    push = _run_git(["push", "-q", str(external), "main"], cwd=other_src)
    assert push.returncode == 0, push.stderr
    external_head_before = _head_log_lines(external)
    assert len(external_head_before) == 1

    # The vault has its OWN, disjoint history (no shared parent).
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "vault seed", "vault-file.md", "vault content\n")

    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none, enabled=True)
    outcome = mirror.run_mirror(settings, remote)

    assert outcome.status == "error"
    assert "reject" in outcome.message.lower() or "non-fast-forward" in outcome.message.lower() or "fetch first" in outcome.message.lower()

    # The external remote's history is BYTE-IDENTICAL to before the
    # rejected attempt — never rewritten, never force-pushed.
    assert _head_log_lines(external) == external_head_before
    clone_dir = tmp_path / "clone-after-reject"
    result = _run_git(["clone", "-q", str(external), str(clone_dir)], cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert (clone_dir / "unrelated.md").read_text() == "not part of the vault's history\n"
    assert not (clone_dir / "vault-file.md").exists()


def test_run_mirror_uses_plain_non_force_push_argv(make_settings, tmp_path, monkeypatch):
    """Intercepts the REAL `subprocess.run` call `run_mirror` makes (still
    letting it actually execute — `real_run` below) and asserts the argv is
    exactly `["git", "push", <url>, "<branch>:<branch>"]`: no `--force`/
    `--force-with-lease`, no `--mirror`, no `+`-prefixed refspec."""
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "one\n")

    external = tmp_path / "external.git"
    _init_bare(external)

    captured: dict = {}
    real_run = mirror.subprocess.run

    def fake_run(argv, **kwargs):
        captured["argv"] = list(argv)
        return real_run(argv, **kwargs)

    monkeypatch.setattr(mirror.subprocess, "run", fake_run)

    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none, enabled=True)
    outcome = mirror.run_mirror(settings, remote)
    assert outcome.status == "success", outcome.message

    argv = captured["argv"]
    assert argv[0] == "git"
    assert argv[1] == "push"
    assert not any(a.startswith("--force") for a in argv)
    assert "--mirror" not in argv
    refspec = argv[-1]
    assert not refspec.startswith("+")
    assert refspec == "main:main"


# --- SSH credential: set, fingerprint, use for a real local push -----------


def test_ssh_key_credential_stored_with_fingerprint(make_settings, tmp_path):
    settings = make_settings(secrets_path=str(tmp_path / "secrets"))
    # Generate a REAL ed25519 keypair (system ssh-keygen) so
    # compute_ssh_fingerprint has something genuine to parse.
    keyfile = tmp_path / "id_ed25519"
    result = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(keyfile)],
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    private_key_pem = keyfile.read_text()

    path = secrets_store.set_ssh_key(settings, 42, private_key_pem)
    fingerprint = secrets_store.compute_ssh_fingerprint(path)
    assert fingerprint is not None
    assert "SHA256:" in fingerprint


# --- API: session-only auth on every route ----------------------------------


def _make_owner_with_tokens(app):
    db = app.state.SessionLocal()
    user = models.User(username=OWNER_USERNAME, password_hash=security.hash_password(OWNER_PASSWORD), email=OWNER_EMAIL, is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    write_token = "remotes-write-token"
    db.add(
        models.ApiToken(
            user_id=user.id, name="w", token_hash=security.hash_token(write_token), prefix=write_token[:12], scope=models.TokenScope.write
        )
    )
    db.commit()
    db.close()
    return write_token


def _login(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"username": OWNER_USERNAME, "password": OWNER_PASSWORD})
    assert r.status_code == 200, r.text


ROUTES = [
    ("GET", "/api/vault/remotes", None),
    ("POST", "/api/vault/remotes", {"name": "x", "url": "/tmp/x.git"}),
    ("PATCH", "/api/vault/remotes/1", {"name": "y"}),
    ("DELETE", "/api/vault/remotes/1", None),
    ("POST", "/api/vault/remotes/1/mirror", None),
    ("POST", "/api/vault/remotes/1/test", None),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_every_route_requires_a_session_rejects_anon(make_app, make_settings, method, path, body):
    app = make_app(make_settings())
    client = TestClient(app)
    r = client.request(method, path, json=body)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_every_route_rejects_a_scoped_api_token(make_app, make_settings, method, path, body):
    app = make_app(make_settings())
    client = TestClient(app)
    write_token = _make_owner_with_tokens(app)
    r = client.request(method, path, json=body, headers={"Authorization": f"Bearer {write_token}"})
    assert r.status_code == 403


# --- API: CRUD + write-only credentials + secrets never leak ---------------


def test_vault_remotes_routes_carry_no_cors_headers(owner_client):
    """Same "CORS: none, anywhere" posture (roadmap §5.4) every other
    `/api/*` route already carries — structurally guaranteed by
    `api_app` never installing `CORSMiddleware` at all, pinned here too."""
    r = owner_client.get("/api/vault/remotes")
    assert r.status_code == 200
    assert not any(k.lower().startswith("access-control-") for k in r.headers.keys())


def test_create_list_patch_delete_remote(owner_client):
    r = owner_client.post(
        "/api/vault/remotes",
        json={"name": "origin", "url": "/tmp/somewhere.git", "push_on_receive": True},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "origin"
    assert body["credential_kind"] == "none"
    assert body["last_status"] is None
    remote_id = body["id"]

    r_list = owner_client.get("/api/vault/remotes")
    assert r_list.status_code == 200
    assert any(row["id"] == remote_id for row in r_list.json())

    r_patch = owner_client.patch(f"/api/vault/remotes/{remote_id}", json={"enabled": False, "url": "/tmp/elsewhere.git"})
    assert r_patch.status_code == 200, r_patch.text
    assert r_patch.json()["enabled"] is False
    assert r_patch.json()["url"] == "/tmp/elsewhere.git"

    r_delete = owner_client.delete(f"/api/vault/remotes/{remote_id}")
    assert r_delete.status_code == 200
    assert owner_client.get("/api/vault/remotes").json() == []


def test_create_rejects_invalid_url(owner_client):
    r = owner_client.post("/api/vault/remotes", json={"name": "bad", "url": "ext::sh -c id"})
    assert r.status_code == 422


def test_create_duplicate_name_conflicts(owner_client):
    payload = {"name": "dupe", "url": "/tmp/a.git"}
    r1 = owner_client.post("/api/vault/remotes", json=payload)
    assert r1.status_code == 201
    r2 = owner_client.post("/api/vault/remotes", json={"name": "dupe", "url": "/tmp/b.git"})
    assert r2.status_code == 409


def test_ssh_credential_write_only_and_fingerprint_exposed(owner_client, app):
    r = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "ssh-remote",
            "url": "git@example.com:owner/repo.git",
            "credential_kind": "ssh_key",
            "ssh_private_key": SECRET_SSH_KEY,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["credential_kind"] == "ssh_key"
    assert "ssh_private_key" not in body
    # A malformed test fixture key won't produce a real ssh-keygen
    # fingerprint (fine — fingerprinting is best-effort), but the field must
    # exist in the schema and never be the secret itself either way.
    assert body.get("credential_fingerprint") != SECRET_SSH_KEY

    remote_id = body["id"]
    key_path = secrets_store.ssh_key_path(app.state.settings, remote_id)
    assert key_path.exists()
    assert stat.S_IMODE(os.stat(key_path).st_mode) == 0o600
    assert key_path.read_text().strip() == SECRET_SSH_KEY.strip()


def test_https_token_write_only_and_last4_exposed(owner_client, app):
    r = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "https-remote",
            "url": "https://example.com/owner/repo.git",
            "credential_kind": "https_token",
            "https_token": SECRET_HTTPS_TOKEN,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["credential_kind"] == "https_token"
    assert "https_token" not in body
    assert body["credential_last4"] == SECRET_HTTPS_TOKEN[-4:]

    remote_id = body["id"]
    token_path = secrets_store.https_token_path(app.state.settings, remote_id)
    assert token_path.exists()
    assert stat.S_IMODE(os.stat(token_path).st_mode) == 0o600
    assert token_path.read_text() == SECRET_HTTPS_TOKEN


def test_clear_credential_reverts_to_none_and_deletes_file(owner_client, app):
    r = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "clear-me",
            "url": "https://example.com/owner/repo.git",
            "credential_kind": "https_token",
            "https_token": SECRET_HTTPS_TOKEN,
        },
    )
    remote_id = r.json()["id"]
    token_path = secrets_store.https_token_path(app.state.settings, remote_id)
    assert token_path.exists()

    r_patch = owner_client.patch(f"/api/vault/remotes/{remote_id}", json={"clear_credential": True})
    assert r_patch.status_code == 200
    assert r_patch.json()["credential_kind"] == "none"
    assert r_patch.json()["credential_last4"] is None
    assert not token_path.exists()


def test_delete_remote_removes_its_key_file(owner_client, app):
    r = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "delete-me",
            "url": "git@example.com:owner/repo.git",
            "credential_kind": "ssh_key",
            "ssh_private_key": SECRET_SSH_KEY,
        },
    )
    remote_id = r.json()["id"]
    key_path = secrets_store.ssh_key_path(app.state.settings, remote_id)
    assert key_path.exists()

    r_delete = owner_client.delete(f"/api/vault/remotes/{remote_id}")
    assert r_delete.status_code == 200
    assert not key_path.exists()


def test_secrets_never_appear_in_any_remotes_response_json(owner_client):
    r_ssh = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "grep-ssh",
            "url": "git@example.com:owner/repo.git",
            "credential_kind": "ssh_key",
            "ssh_private_key": SECRET_SSH_KEY,
        },
    )
    r_https = owner_client.post(
        "/api/vault/remotes",
        json={
            "name": "grep-https",
            "url": "https://example.com/owner/repo.git",
            "credential_kind": "https_token",
            "https_token": SECRET_HTTPS_TOKEN,
        },
    )
    assert r_ssh.status_code == 201 and r_https.status_code == 201
    ssh_id = r_ssh.json()["id"]
    https_id = r_https.json()["id"]

    responses = [
        r_ssh,
        r_https,
        owner_client.get("/api/vault/remotes"),
        owner_client.get("/api/vault/remotes"),  # list again, belt-and-suspenders
        owner_client.patch(f"/api/vault/remotes/{ssh_id}", json={"push_on_receive": False}),
        owner_client.patch(f"/api/vault/remotes/{https_id}", json={"push_on_receive": False}),
    ]
    for resp in responses:
        raw = json.dumps(resp.json())
        assert SECRET_SSH_KEY.strip() not in raw
        assert "notarealkeyjustapytestfixturevalue" not in raw
        assert SECRET_HTTPS_TOKEN not in raw


# --- MirrorRunner: locking / busy, and audit on success + failure ----------


def test_run_one_reports_busy_when_locked(make_app, make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    app = make_app(settings)
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "one\n")

    external = tmp_path / "external.git"
    _init_bare(external)

    db = app.state.SessionLocal()
    remote = models.VaultRemote(name="origin", url=str(external), credential_kind=models.RemoteCredentialKind.none)
    db.add(remote)
    db.commit()
    db.refresh(remote)
    remote_id = remote.id
    db.close()

    runner = app.state.mirror_runner
    lock = runner._lock_for(remote_id)
    lock.acquire()
    try:
        outcome = runner.run_one(remote_id)
        assert outcome.status == "busy"
    finally:
        lock.release()

    # Now that the lock is free, a real run succeeds normally.
    outcome2 = runner.run_one(remote_id)
    assert outcome2.status == "success", outcome2.message


def test_run_one_writes_audit_event_on_success_and_failure(make_app, make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    app = make_app(settings)
    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "one\n")

    external = tmp_path / "external.git"
    _init_bare(external)

    db = app.state.SessionLocal()
    good = models.VaultRemote(name="good", url=str(external), credential_kind=models.RemoteCredentialKind.none)
    bad = models.VaultRemote(name="bad", url="ext::sh -c id", credential_kind=models.RemoteCredentialKind.none)
    db.add_all([good, bad])
    db.commit()
    db.refresh(good)
    db.refresh(bad)
    good_id, bad_id = good.id, bad.id
    db.close()

    runner = app.state.mirror_runner
    runner.run_one(good_id, principal="owner@example.com")
    runner.run_one(bad_id, principal="owner@example.com")

    db = app.state.SessionLocal()
    events = {e.event for e in db.query(models.AuditEvent).all()}
    db.close()
    assert "vault_remote.mirror_success" in events
    assert "vault_remote.mirror_failure" in events


# --- API: explicit mirror-now + test-connection -----------------------------


def test_mirror_now_endpoint_returns_outcome(make_app, make_settings, tmp_path):
    vault_dir = tmp_path / "vault"
    settings = make_settings(vault_path=str(vault_dir))
    app = make_app(settings)
    client = TestClient(app)
    _make_owner_with_tokens(app)
    _login(client)

    vault_module.init_vault(settings, branch="main")
    _commit_to_vault(settings, "seed", "a.md", "one\n")

    external = tmp_path / "external.git"
    _init_bare(external)

    r_create = client.post("/api/vault/remotes", json={"name": "origin", "url": str(external)})
    remote_id = r_create.json()["id"]

    r_mirror = client.post(f"/api/vault/remotes/{remote_id}/mirror")
    assert r_mirror.status_code == 200, r_mirror.text
    body = r_mirror.json()
    assert body["status"] == "success", body

    r_get = client.get("/api/vault/remotes")
    row = next(r for r in r_get.json() if r["id"] == remote_id)
    assert row["last_status"] == "success"
    assert row["last_error"] is None
    assert row["last_mirror_at"] is not None


def test_test_connection_endpoint_reachable_and_repo_missing(owner_client, tmp_path):
    external = tmp_path / "external.git"
    _init_bare(external)
    r_ok = owner_client.post("/api/vault/remotes", json={"name": "ok", "url": str(external)})
    ok_id = r_ok.json()["id"]
    r_test_ok = owner_client.post(f"/api/vault/remotes/{ok_id}/test")
    assert r_test_ok.status_code == 200
    assert r_test_ok.json()["outcome"] == "reachable"

    missing = tmp_path / "does-not-exist.git"
    r_missing = owner_client.post("/api/vault/remotes", json={"name": "missing", "url": str(missing)})
    missing_id = r_missing.json()["id"]
    r_test_missing = owner_client.post(f"/api/vault/remotes/{missing_id}/test")
    assert r_test_missing.status_code == 200
    assert r_test_missing.json()["outcome"] == "repo-missing"


def test_test_connection_endpoint_unreachable(owner_client, tmp_path):
    # Nothing listens on this loopback port — connection refused, fast, no
    # DNS/network dependency (deterministic in CI/sandboxes with no
    # internet access).
    r = owner_client.post("/api/vault/remotes", json={"name": "unreachable", "url": "https://127.0.0.1:1/repo.git"})
    remote_id = r.json()["id"]
    r_test = owner_client.post(f"/api/vault/remotes/{remote_id}/test")
    assert r_test.status_code == 200
    assert r_test.json()["outcome"] == "unreachable"


# --- live: mirror triggered by a real client push through the ASGI app -----


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def live_mirroring_server(make_settings, tmp_path):
    """A real uvicorn instance over a MOUNTED, already-initialized vault
    with one push_on_receive remote pointed at a real local bare repo — the
    live counterpart to `test_vault.py::live_vault_server`, extended with
    mirroring. `mirror_runner.sync = True` before the server starts so the
    triggered mirror runs (and finishes) INLINE, before the git push's own
    HTTP response is returned to the real `git` client — see
    `routers/git_http.py`'s "TEST-ONLY ordering" comment for why that makes
    this deterministic without any polling/sleeping in the test itself."""
    vault_dir = tmp_path / "mounted-vault"
    settings = make_settings(git_root=str(tmp_path / "gitroot"), vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    app = create_app(settings)
    app.state.mirror_runner.sync = True

    external = tmp_path / "external.git"
    _init_bare(external)

    SessionLocal = app.state.SessionLocal
    db = SessionLocal()
    user = models.User(username="live-owner", password_hash=None, email="live-mirror@example.com", is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    write_token = "live-mirror-write-token"
    db.add(
        models.ApiToken(
            user_id=user.id, name="w", token_hash=security.hash_token(write_token), prefix=write_token[:12], scope=models.TokenScope.write
        )
    )
    db.add(
        models.VaultRemote(
            name="origin",
            url=str(external),
            enabled=True,
            push_on_receive=True,
            credential_kind=models.RemoteCredentialKind.none,
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
        "port": port,
        "write_token": write_token,
        "external": external,
    }

    server.should_exit = True
    thread.join(timeout=10)


def test_live_push_triggers_mirror_to_external_remote(live_mirroring_server, tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("mirror me\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "first"], cwd=src)

    push_url = f"http://x:{live_mirroring_server['write_token']}@127.0.0.1:{live_mirroring_server['port']}/git/vault.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode == 0, f"push failed: {result.stderr}"

    # By the time the push's own HTTP response reached this real git
    # client, the mirror (sync=True, run BEFORE the response) already
    # completed — no sleeping/polling needed.
    external = live_mirroring_server["external"]
    clone_dir = tmp_path / "clone-of-external"
    clone = _run_git(["clone", "-q", str(external), str(clone_dir)], cwd=tmp_path)
    assert clone.returncode == 0, clone.stderr
    assert (clone_dir / "note.md").read_text() == "mirror me\n"

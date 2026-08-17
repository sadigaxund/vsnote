"""Phase 17 Milestone A — `app/vault.py`'s identity resolution + working-tree
semantics, the `/api/vault` router, the vault-name routing in
`routers/git_http.py`, and the mounted-vault reset refusal in
`routers/git_admin.py`. See `app/vault.py`'s module docstring for the full
contract this suite pins.
"""

from __future__ import annotations

import socket
import stat
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app import models, security
from app import vault as vault_module
from app.main import create_app
from conftest import OWNER_EMAIL, publish_share

OWNER_PASSWORD = "correct horse battery staple 1"


# --- identity resolution (pure unit tests, no app needed) ------------------


def test_vault_repo_path_legacy_default(make_settings):
    settings = make_settings()
    assert vault_module.is_mounted(settings) is False
    assert vault_module.vault_repo_path(settings) == Path(settings.git_root) / "vault.git"


def test_vault_repo_path_mounted(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    assert vault_module.is_mounted(settings) is True
    assert vault_module.vault_repo_path(settings) == mount


def test_vault_repo_path_uses_custom_repo_name(make_settings, tmp_path):
    settings = make_settings(vault_repo_name="myvault")
    assert vault_module.vault_repo_path(settings) == Path(settings.git_root) / "myvault.git"


def test_validate_vault_repo_name_rejects_bad_names():
    for bad in ("../etc", "a/b", "", "x" * 65, "weird name"):
        with pytest.raises(ValueError):
            vault_module.validate_vault_repo_name(bad)
    vault_module.validate_vault_repo_name("vault")  # does not raise
    vault_module.validate_vault_repo_name("my-vault_01")  # does not raise


def test_create_app_fails_loudly_for_invalid_vault_repo_name(make_settings):
    settings = make_settings(vault_repo_name="bad name!")
    with pytest.raises(ValueError):
        create_app(settings)


def test_resolve_git_repo_path_routes_vault_name_and_leaves_others_alone(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount), vault_repo_name="myvault")
    assert vault_module.resolve_git_repo_path(settings, "/myvault.git") == mount
    other = vault_module.resolve_git_repo_path(settings, "/somethingelse.git")
    assert other == Path(settings.git_root) / "somethingelse.git"


# --- working-tree semantics (pure unit tests against a mounted vault) ------


def test_commit_worktree_changes_stages_add_modify_and_delete(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    vault_module.init_vault(settings, branch="main")

    assert vault_module.commit_worktree_changes(mount) is False  # nothing to commit yet

    (mount / "a.md").write_text("one\n")
    assert vault_module.commit_worktree_changes(mount) is True
    assert vault_module.commit_worktree_changes(mount) is False  # clean now

    (mount / "a.md").write_text("two\n")
    (mount / "b.md").write_text("new\n")
    assert vault_module.commit_worktree_changes(mount) is True

    (mount / "a.md").unlink()
    assert vault_module.commit_worktree_changes(mount) is True

    from dulwich.repo import Repo

    repo = Repo(str(mount))
    try:
        head = repo.refs[repo.refs.follow(b"HEAD")[0][-1]]
        commit = repo.object_store[head]
        assert commit.author == vault_module.VAULT_COMMIT_AUTHOR
        tree = repo.object_store[commit.tree]
        names = {name for name, _mode, _sha in tree.items()}
        assert names == {b"b.md"}
    finally:
        repo.close()


def test_commit_worktree_changes_noop_for_bare_repo(make_settings, tmp_path):
    settings = make_settings()  # legacy, bare shape
    from app.gitrepo import ensure_bare_repo

    path = vault_module.vault_repo_path(settings)
    ensure_bare_repo(path)
    assert vault_module.commit_worktree_changes(path) is False


def test_checkout_head_into_worktree_reflects_new_head_without_moving_branch(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    vault_module.init_vault(settings, branch="main")
    (mount / "a.md").write_text("one\n")
    vault_module.commit_worktree_changes(mount)

    from dulwich.objects import Blob, Commit, Tree
    from dulwich.repo import Repo

    repo = Repo(str(mount))
    head_ref = repo.refs.follow(b"HEAD")[0][-1]
    head_oid = repo.refs[head_ref]
    head_commit = repo.object_store[head_oid]
    root = repo.object_store[head_commit.tree]
    blob = Blob.from_string(b"two\n")
    repo.object_store.add_object(blob)
    new_tree = Tree()
    for name, mode, sha in root.items():
        if name != b"a.md":
            new_tree.add(name, mode, sha)
    new_tree.add(b"a.md", stat.S_IFREG | 0o644, blob.id)
    repo.object_store.add_object(new_tree)
    commit = Commit()
    commit.tree = new_tree.id
    commit.parents = [head_oid]
    commit.author = commit.committer = b"pusher <p@test>"
    commit.author_time = commit.commit_time = int(time.time())
    commit.author_timezone = commit.commit_timezone = 0
    commit.encoding = b"UTF-8"
    commit.message = b"external update\n"
    repo.object_store.add_object(commit)
    # Simulate what a real push does: move the branch ref directly, HEAD
    # keeps following it symbolically.
    repo.refs[head_ref] = commit.id
    repo.close()

    assert (mount / "a.md").read_text() == "one\n"  # stale until checkout runs
    assert vault_module.checkout_head_into_worktree(mount) is True
    assert (mount / "a.md").read_text() == "two\n"

    # HEAD is still a symbolic ref to refs/heads/main, not detached.
    repo2 = Repo(str(mount))
    try:
        assert repo2.refs.follow(b"HEAD")[0][-1] == head_ref
    finally:
        repo2.close()


def test_checkout_head_into_worktree_noop_for_empty_repo(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    vault_module.init_vault(settings, branch="main")
    assert vault_module.checkout_head_into_worktree(mount) is False


# --- init_vault: explicit-only, refuses a second time, respects existing --


def test_init_vault_refuses_a_second_time(make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    description = vault_module.init_vault(settings, branch="main")
    assert description.initialized is True
    assert description.mounted is True
    assert description.bare is False
    assert (mount / ".git").exists()

    with pytest.raises(vault_module.VaultAlreadyInitialized):
        vault_module.init_vault(settings, branch="main")


def test_init_vault_raises_structured_error_when_path_not_writable(make_settings, tmp_path):
    """DESIGN-SPEC Amendments round 7 item 50: a root-owned Docker volume
    (simulated here with a read-only directory) must never surface as a raw
    500/traceback — `init_vault` maps it to `VaultPathNotWritable`, which
    the router below turns into a structured 503."""
    mount = tmp_path / "mnt"
    mount.mkdir()
    mount.chmod(0o500)  # r-x: exists, but nothing can be created inside it
    settings = make_settings(vault_path=str(mount))
    try:
        with pytest.raises(vault_module.VaultPathNotWritable) as excinfo:
            vault_module.init_vault(settings, branch="main")
        assert excinfo.value.path == mount
        assert isinstance(excinfo.value.original, OSError)
    finally:
        mount.chmod(0o700)  # restore so pytest's tmp_path cleanup can remove it


def test_init_vault_legacy_creates_bare_repo(make_settings):
    settings = make_settings()  # no vault_path — legacy shape
    description = vault_module.init_vault(settings, branch="main")
    assert description.mounted is False
    assert description.bare is True
    path = vault_module.vault_repo_path(settings)
    assert (path / "HEAD").exists()
    assert not (path / "index").exists()  # bare layout: no working-tree index


def test_init_vault_respects_a_preexisting_repo(make_settings, tmp_path):
    """An owner (or an earlier deployment) may have already put a real git
    repo at the mount before VSNote ever touches it. `init_vault` must
    never overwrite or re-init it — see app/vault.py's module docstring."""
    from dulwich import porcelain

    mount = tmp_path / "mnt"
    mount.mkdir()
    repo = porcelain.init(str(mount), bare=False)
    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
    (mount / "preexisting.md").write_text("already here\n")
    porcelain.add(repo, paths=["preexisting.md"])
    porcelain.commit(repo, message=b"pre-existing\n", author=b"Owner <o@test>", committer=b"Owner <o@test>")
    repo.close()

    settings = make_settings(vault_path=str(mount))
    with pytest.raises(vault_module.VaultAlreadyInitialized):
        vault_module.init_vault(settings, branch="main")

    # Untouched.
    assert (mount / "preexisting.md").read_text() == "already here\n"


# --- helpers for the TestClient-level (no real socket) git-http tests -----


def _make_owner_with_write_token(app):
    db = app.state.SessionLocal()
    user = models.User(username="owner", password_hash=security.hash_password(OWNER_PASSWORD), email=OWNER_EMAIL, is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    write_token = "vault-write-token"
    read_token = "vault-read-token"
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
    return write_token, read_token


def _login(client: TestClient) -> None:
    r = client.post("/api/auth/login", json={"username": "owner", "password": OWNER_PASSWORD})
    assert r.status_code == 200, r.text


# --- mounted-uninitialized vault: never auto-created -----------------------


def test_mounted_uninitialized_vault_write_refused_not_autocreated(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    write_token, _read_token = _make_owner_with_write_token(app)

    r = client.post(
        "/git/vault.git/git-receive-pack",
        headers={"Authorization": f"Bearer {write_token}", "Content-Type": "application/x-git-receive-pack-request"},
        content=b"0000",
    )
    assert r.status_code == 409
    assert "not initialized" in r.text.lower()
    assert not (mount / ".git").exists()


def test_mounted_uninitialized_vault_push_advertisement_also_refused(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    write_token, _read_token = _make_owner_with_write_token(app)

    r = client.get(
        "/git/vault.git/info/refs?service=git-receive-pack",
        headers={"Authorization": f"Bearer {write_token}"},
    )
    assert r.status_code == 409
    assert not (mount / ".git").exists()


def test_mounted_uninitialized_vault_read_is_plain_404(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    _write_token, read_token = _make_owner_with_write_token(app)

    r = client.get(
        "/git/vault.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {read_token}"},
    )
    assert r.status_code == 404
    assert not (mount / ".git").exists()


def test_existing_git_at_mount_is_respected_and_served(make_app, make_settings, tmp_path):
    from dulwich import porcelain

    mount = tmp_path / "mnt"
    mount.mkdir()
    repo = porcelain.init(str(mount), bare=False)
    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
    (mount / "preexisting.md").write_text("already here\n")
    porcelain.add(repo, paths=["preexisting.md"])
    porcelain.commit(repo, message=b"pre-existing\n", author=b"Owner <o@test>", committer=b"Owner <o@test>")
    repo.close()

    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    _make_owner_with_write_token(app)
    _login(client)

    r_init = client.post("/api/vault/init", json={})
    assert r_init.status_code == 409

    read_token = client.post("/api/auth/tokens", json={"name": "r", "scope": "read"}).json()["token"]
    r_refs = client.get(
        "/git/vault.git/info/refs?service=git-upload-pack",
        headers={"Authorization": f"Bearer {read_token}"},
    )
    assert r_refs.status_code == 200
    assert (mount / "preexisting.md").read_text() == "already here\n"


# --- /api/vault/init: explicit, once, session-only --------------------------


def test_api_vault_init_works_once_then_refuses(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    _make_owner_with_write_token(app)
    _login(client)

    r1 = client.post("/api/vault/init", json={})
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body["initialized"] is True
    assert body["mounted"] is True
    assert (mount / ".git").exists()

    r2 = client.post("/api/vault/init", json={})
    assert r2.status_code == 409


def test_api_vault_init_returns_structured_503_when_path_not_writable(make_app, make_settings, tmp_path):
    """The route-level half of item 50: no raw 500/traceback reaches the
    client, and the JSON `detail` names the actual path so
    `VaultSetupPanel.tsx`'s one-row error state has something actionable to
    show verbatim."""
    mount = tmp_path / "mnt"
    mount.mkdir()
    mount.chmod(0o500)
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    _make_owner_with_write_token(app)
    _login(client)
    try:
        r = client.post("/api/vault/init", json={})
        assert r.status_code == 503, r.text
        body = r.json()
        assert str(mount) in body["detail"]
    finally:
        mount.chmod(0o700)


def test_api_vault_init_requires_session(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    write_token, _read_token = _make_owner_with_write_token(app)

    r_unauth = client.post("/api/vault/init", json={})
    assert r_unauth.status_code == 401

    r_token = client.post("/api/vault/init", json={}, headers={"Authorization": f"Bearer {write_token}"})
    assert r_token.status_code == 403
    assert not (mount / ".git").exists()


# --- GET /api/vault: session-only, no secrets -------------------------------


def test_get_vault_requires_session(client, owner, db_session):
    r = client.get("/api/vault")
    assert r.status_code == 401


def test_get_vault_rejects_api_token(owner_client, anon_client):
    token = owner_client.post("/api/auth/tokens", json={"name": "t", "scope": "write"}).json()["token"]
    r = anon_client.get("/api/vault", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_get_vault_default_legacy_shape_has_no_secrets(owner_client):
    r = owner_client.get("/api/vault")
    assert r.status_code == 200
    body = r.json()
    assert body["mounted"] is False
    assert body["initialized"] is False
    assert body["repo_name"] == "vault"
    assert set(body.keys()) == {
        "path",
        "mounted",
        "initialized",
        "bare",
        "repo_name",
        "head_branch",
        "has_commits",
        "worktree_dirty",
        "last_commit_message",
        "last_commit_time",
    }
    # No token/password/secret-shaped fields ever leak from this endpoint.
    dumped = str(body).lower()
    for forbidden in ("password", "secret", "token"):
        assert forbidden not in dumped


# --- share-editor write-back targets the definitive (mounted) vault --------


def test_share_editor_writeback_targets_mounted_vault_and_updates_disk(make_app, make_settings, tmp_path):
    from dulwich import porcelain
    from dulwich.repo import Repo

    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)

    vault_module.init_vault(settings, branch="main")
    (mount / "notes").mkdir()
    (mount / "notes" / "x.md").write_text("original\n")
    repo = Repo(str(mount))
    porcelain.add(repo, paths=["notes/x.md"])
    porcelain.commit(repo, message=b"seed\n", author=b"Owner <o@test>", committer=b"Owner <o@test>")
    repo.close()

    _make_owner_with_write_token(app)
    _login(client)

    share = publish_share(
        client,
        source_path="vault/notes/x.md",
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = client.put(f"/share/{share['slug']}", content=b"edited through the mounted-vault share")
    assert r.status_code == 200, r.text
    assert r.json()["vault_committed"] is True
    assert (mount / "notes" / "x.md").read_text() == "edited through the mounted-vault share"


# --- reset refuses on a mounted vault, still works on a legacy one ---------


def test_reset_refuses_on_mounted_vault(make_app, make_settings, tmp_path):
    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    vault_module.init_vault(settings, branch="main")
    _make_owner_with_write_token(app)
    _login(client)

    r = client.post(f"/api/git-repos/{settings.vault_repo_name}/reset")
    assert r.status_code == 409
    assert (mount / ".git").exists()  # untouched


def test_reset_still_works_for_a_non_vault_mounted_repo_name(make_app, make_settings, tmp_path):
    """Only the exact vault repo name is protected while mounted — any other
    repo name keeps today's exact reset behavior, unchanged."""
    from app.gitrepo import ensure_bare_repo

    mount = tmp_path / "mnt"
    settings = make_settings(vault_path=str(mount))
    app = make_app(settings)
    client = TestClient(app)
    other_path = Path(settings.git_root) / "somethingelse.git"
    ensure_bare_repo(other_path)
    _make_owner_with_write_token(app)
    _login(client)

    r = client.post("/api/git-repos/somethingelse/reset")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


# --- live round trip: real git push into a mounted vault -------------------


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _run_git(args: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    import os

    full_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})}
    return subprocess.run(["git", *args], cwd=str(cwd), env=full_env, capture_output=True, text=True, timeout=30)


@pytest.fixture
def live_vault_server(make_settings, tmp_path):
    """A real uvicorn instance over a MOUNTED, already-initialized vault —
    the live counterpart to the `live_server` fixture in test_git_sync.py,
    which never involves the vault mount at all."""
    vault_dir = tmp_path / "mounted-vault"
    settings = make_settings(git_root=str(tmp_path / "gitroot"), vault_path=str(vault_dir))
    vault_module.init_vault(settings, branch="main")
    app = create_app(settings)

    SessionLocal = app.state.SessionLocal
    db = SessionLocal()
    user = models.User(username="live-vault-owner", password_hash=None, email="live-vault@example.com", is_admin=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    write_token = "live-vault-write-token"
    db.add(
        models.ApiToken(
            user_id=user.id, name="w", token_hash=security.hash_token(write_token), prefix=write_token[:12], scope=models.TokenScope.write
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
        "vault_dir": vault_dir,
    }

    server.should_exit = True
    thread.join(timeout=10)


def test_live_push_into_mounted_vault_lands_on_disk(live_vault_server, tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "note.md").write_text("hello from the client\n")
    _run_git(["add", "note.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "first"], cwd=src)

    push_url = f"http://x:{live_vault_server['write_token']}@127.0.0.1:{live_vault_server['port']}/git/vault.git"
    result = _run_git(["push", push_url, "main"], cwd=src)
    assert result.returncode == 0, f"push failed: {result.stderr}"

    vault_dir = live_vault_server["vault_dir"]
    assert (vault_dir / "note.md").read_text() == "hello from the client\n"
    assert (vault_dir / ".git").is_dir()


def test_live_disk_edit_committed_before_fetch_and_reaches_client(live_vault_server, tmp_path):
    src = tmp_path / "src2"
    src.mkdir()
    _run_git(["init", "-q", "-b", "main"], cwd=src)
    _run_git(["config", "user.email", "test@example.com"], cwd=src)
    _run_git(["config", "user.name", "Test"], cwd=src)
    (src / "a.md").write_text("first\n")
    _run_git(["add", "a.md"], cwd=src)
    _run_git(["commit", "-q", "-m", "first"], cwd=src)

    push_url = f"http://x:{live_vault_server['write_token']}@127.0.0.1:{live_vault_server['port']}/git/vault.git"
    assert _run_git(["push", push_url, "main"], cwd=src).returncode == 0

    # Simulate the owner editing a file directly on the mounted disk (over
    # SSH, another editor, ...) — no git command involved on this side.
    vault_dir = live_vault_server["vault_dir"]
    (vault_dir / "b.md").write_text("edited directly on disk\n")

    # A fetch/clone is a READ request, but must still trigger the
    # pre-serve commit — see vault.py's module docstring.
    clone_dir = tmp_path / "clone"
    result = _run_git(["clone", push_url, str(clone_dir)], cwd=tmp_path)
    assert result.returncode == 0, f"clone failed: {result.stderr}"
    assert (clone_dir / "b.md").read_text() == "edited directly on disk\n"

    log = _run_git(["log", "-1", "--format=%an <%ae>"], cwd=vault_dir)
    assert log.stdout.strip() == "VSNote server <vault@vsnote>"

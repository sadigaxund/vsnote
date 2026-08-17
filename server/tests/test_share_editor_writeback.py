"""Round 6 items 11/12 — caller role exposure in share JSON, editor
write-back for files inside folder shares, and the best-effort vault
commit into the bare sync repo."""

from __future__ import annotations

import stat
import time
from pathlib import Path

from conftest import OWNER_EMAIL, publish_share, publish_folder_share

NOT_FOUND = {"detail": "Not found"}


# --- role exposure ---------------------------------------------------------


def test_json_payload_reports_viewer_role_by_default(owner_client):
    share = publish_share(owner_client, general_access="link", auth_mode="none", render_mode="rendered")
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"


def test_json_payload_reports_editor_role_for_granted_principal(owner_client):
    share = publish_share(
        owner_client,
        general_access="link",
        auth_mode="none",
        render_mode="rendered",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    assert r.json()["role"] == "editor"


def test_folder_listing_reports_role(owner_client):
    share = publish_folder_share(
        owner_client,
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.get(f"/api/share/{share['slug']}/content")
    assert r.status_code == 200
    assert r.json()["role"] == "editor"


# --- folder-share editor write-back ---------------------------------------


def test_folder_relpath_put_editor_updates_manifest_entry(owner_client):
    share = publish_folder_share(
        owner_client,
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.put(f"/share/{share['slug']}/a.md", content=b"edited via share")
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    fetched = owner_client.get(f"/share/{share['slug']}/a.md")
    assert fetched.content == b"edited via share"


def test_folder_relpath_put_viewer_is_uniform_404(owner_client):
    share = publish_folder_share(owner_client, general_access="link", auth_mode="none")
    r = owner_client.put(f"/share/{share['slug']}/a.md", content=b"nope")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_folder_relpath_put_unknown_relpath_is_uniform_404_never_a_create(owner_client):
    share = publish_folder_share(
        owner_client,
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.put(f"/share/{share['slug']}/new-file.md", content=b"sneaky create")
    assert r.status_code == 404
    assert r.json() == NOT_FOUND
    # And it really didn't create anything.
    r2 = owner_client.get(f"/share/{share['slug']}/new-file.md")
    assert r2.status_code == 404


# --- vault commit ----------------------------------------------------------


def _init_bare_repo_with_file(git_root: Path, repo_path: str, content: bytes):
    """A bare `vault.git` holding one commit with `repo_path` = `content`,
    built the way the client's first push would leave it."""
    from dulwich.objects import Blob, Commit, Tree
    from dulwich.repo import Repo

    bare = git_root / "vault.git"
    bare.mkdir(parents=True, exist_ok=True)
    repo = Repo.init_bare(str(bare))

    blob = Blob.from_string(content)
    repo.object_store.add_object(blob)
    segments = repo_path.split("/")
    tree = Tree()
    tree.add(segments[-1].encode(), stat.S_IFREG | 0o644, blob.id)
    repo.object_store.add_object(tree)
    for name in reversed(segments[:-1]):
        parent = Tree()
        parent.add(name.encode(), stat.S_IFDIR, tree.id)
        repo.object_store.add_object(parent)
        tree = parent

    commit = Commit()
    commit.tree = tree.id
    commit.author = commit.committer = b"owner <owner@test>"
    commit.author_time = commit.commit_time = int(time.time())
    commit.author_timezone = commit.commit_timezone = 0
    commit.encoding = b"UTF-8"
    commit.message = b"initial\n"
    repo.object_store.add_object(commit)
    repo.refs[b"refs/heads/main"] = commit.id
    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
    repo.close()
    return bare


def _read_file_at_head(bare: Path, repo_path: str) -> bytes:
    from dulwich.objects import Tree
    from dulwich.repo import Repo

    repo = Repo(str(bare))
    try:
        head = repo.refs[repo.refs.follow(b"HEAD")[0][-1]]
        commit = repo.object_store[head]
        tree = repo.object_store[commit.tree]
        for segment in repo_path.split("/"):
            _mode, sha = tree[segment.encode()]
            tree = repo.object_store[sha]
        return bytes(tree.data)
    finally:
        repo.close()


def test_editor_put_lands_as_a_vault_commit(owner_client, app):
    git_root = Path(app.state.settings.git_root)
    bare = _init_bare_repo_with_file(git_root, "notes/x.md", b"original vault content")

    share = publish_share(
        owner_client,
        source_path="vault/notes/x.md",
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.put(f"/share/{share['slug']}", content=b"edited through the share")
    assert r.status_code == 200, r.text
    assert r.json()["vault_committed"] is True

    assert _read_file_at_head(bare, "notes/x.md") == b"edited through the share"


def test_editor_put_without_bare_repo_is_blob_only_but_succeeds(owner_client):
    share = publish_share(
        owner_client,
        source_path="vault/notes/x.md",
        general_access="link",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "editor"}],
    )
    r = owner_client.put(f"/share/{share['slug']}", content=b"blob only")
    assert r.status_code == 200, r.text
    assert r.json()["vault_committed"] is False
    assert owner_client.get(f"/share/{share['slug']}").content == b"blob only"

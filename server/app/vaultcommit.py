"""Round 6 item 12 — share-editor write-back "lands as vault commits".

A share editor's PUT already repoints the share's snapshot blob (so every
subsequent viewer sees the edit). This module adds the second half: a real
git commit into the backend's bare sync repo, updating the same file the
share was published from, so the OWNER receives the edit through the
ordinary sync pipeline (fetch -> merge with backup refs -> conflict
resolver if they edited the same lines). Plain object surgery on the bare
repo; the sync protocol itself is untouched and still never force-pushes.

Best-effort by design: the bare repo only exists once the owner has synced
at least once, its name is a client-side setting the share record does not
carry, and an empty repo has no history to edit. Every bail-out returns
False (blob-only edit) rather than failing the PUT: the share edit itself
must succeed even when the vault mirror can't take it.

Repo choice: `vault.git` (the client's `DEFAULT_GIT_REPO_NAME`) when
present; otherwise, if EXACTLY one bare repo exists under the git root,
that one (covers a renamed "Repository name" setting); otherwise ambiguous
-> skip. Phase 17's server-mounted vault removes this guesswork entirely.

Path mapping: `Share.source_path` is a display path (`vault/notes/x.md`,
`fs/paths.ts`: display = "vault/" + repo-relative), so the repo path is
everything after the first segment.
"""

from __future__ import annotations

import stat
import time
from pathlib import Path
from typing import Optional

from dulwich.objects import Blob, Commit, Tree
from dulwich.repo import Repo

DEFAULT_REPO_DIRNAME = "vault.git"


def _pick_repo_path(git_root: Path) -> Optional[Path]:
    default = git_root / DEFAULT_REPO_DIRNAME
    if (default / "HEAD").exists():
        return default
    if not git_root.exists():
        return None
    candidates = [p for p in git_root.iterdir() if p.name.endswith(".git") and (p / "HEAD").exists()]
    return candidates[0] if len(candidates) == 1 else None


def source_path_to_repo_path(source_path: str) -> Optional[str]:
    parts = source_path.split("/", 1)
    if len(parts) != 2 or not parts[1]:
        return None
    return parts[1]


def _rebuild_tree(repo: Repo, tree: Tree, segments: list[str], blob_id: bytes) -> Tree:
    """Returns a NEW tree with `segments` (a file path split on '/') set to
    `blob_id`, sharing every unchanged subtree with the original."""
    name = segments[0].encode("utf-8")
    new_tree = Tree()
    for entry_name, mode, sha in tree.items():
        if entry_name != name:
            new_tree.add(entry_name, mode, sha)
    if len(segments) == 1:
        new_tree.add(name, stat.S_IFREG | 0o644, blob_id)
    else:
        try:
            _mode, child_sha = tree[name]
            child = repo.object_store[child_sha]
            if not isinstance(child, Tree):
                child = Tree()  # a FILE sat where a directory is needed — replace it
        except KeyError:
            child = Tree()
        rebuilt = _rebuild_tree(repo, child, segments[1:], blob_id)
        repo.object_store.add_object(rebuilt)
        new_tree.add(name, stat.S_IFDIR, rebuilt.id)
    return new_tree


def commit_share_edit(git_root: Path, source_path: str, content: bytes, principal: Optional[str]) -> bool:
    """Commits `content` at `source_path`'s repo-relative path onto the bare
    repo's current HEAD branch. Returns True when a commit landed, False
    for every best-effort bail-out (no repo, empty repo, unmappable path,
    concurrent ref move)."""
    repo_path = source_path_to_repo_path(source_path)
    if repo_path is None:
        return False
    bare_path = _pick_repo_path(git_root)
    if bare_path is None:
        return False

    repo = Repo(str(bare_path))
    try:
        head_ref = repo.refs.follow(b"HEAD")[0][-1]  # e.g. b"refs/heads/main"
        try:
            head_oid = repo.refs[head_ref]
        except KeyError:
            return False  # empty repo: no history for the owner to merge from

        head_commit = repo.object_store[head_oid]
        assert isinstance(head_commit, Commit)
        root_tree = repo.object_store[head_commit.tree]
        assert isinstance(root_tree, Tree)

        blob = Blob.from_string(content)
        repo.object_store.add_object(blob)
        new_root = _rebuild_tree(repo, root_tree, repo_path.split("/"), blob.id)
        repo.object_store.add_object(new_root)
        if new_root.id == head_commit.tree:
            return True  # byte-identical content: nothing to commit, not a failure

        commit = Commit()
        commit.tree = new_root.id
        commit.parents = [head_oid]
        author = f"{principal or 'share-editor'} (via share) <share-editor@vsnote>".encode("utf-8")
        commit.author = commit.committer = author
        commit.author_time = commit.commit_time = int(time.time())
        commit.author_timezone = commit.commit_timezone = 0
        commit.encoding = b"UTF-8"
        commit.message = f"Edit {repo_path} via share\n".encode("utf-8")
        repo.object_store.add_object(commit)

        # Atomic: only advance if HEAD is still where we built from — a
        # concurrent push wins and this edit stays blob-only.
        return bool(repo.refs.set_if_equals(head_ref, head_oid, commit.id))
    finally:
        repo.close()

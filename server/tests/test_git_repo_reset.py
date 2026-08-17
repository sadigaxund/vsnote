"""`POST /api/git-repos/{name}/reset` — round 6 item 19's "Replace remote
with local" escape hatch: deletes and re-creates the bare repo. The sync
pipeline still never force-pushes; this is repo management, not git."""

from __future__ import annotations

from pathlib import Path


def _seed_bare_repo_with_ref(app, name: str) -> Path:
    """Creates the bare repo the way the git HTTP layer would, then plants a
    fake ref file so a reset is observable (the re-created repo won't have
    it)."""
    from app.gitrepo import ensure_bare_repo

    root = Path(app.state.settings.git_root)
    path = root / f"{name}.git"
    ensure_bare_repo(path)
    marker = path / "refs" / "heads" / "old-history"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("0" * 40)
    return path


def test_reset_recreates_an_empty_bare_repo(owner_client, app):
    path = _seed_bare_repo_with_ref(app, "vault")
    assert (path / "refs" / "heads" / "old-history").exists()

    r = owner_client.post("/api/git-repos/vault/reset")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # Still a bare repo, but the old history marker is gone.
    assert path.exists()
    assert (path / "HEAD").exists()
    assert not (path / "refs" / "heads" / "old-history").exists()


def test_reset_requires_authentication(client, app):
    _seed_bare_repo_with_ref(app, "vault")
    r = client.post("/api/git-repos/vault/reset")
    assert r.status_code == 401


def test_reset_refuses_api_tokens_even_write_scoped(owner_client, anon_client, app):
    """A leaked git-client token must never be able to erase the server's
    copy of the history — interactive sessions only, same posture as the
    admin routes. (`anon_client`: the plain `client` fixture shares the
    owner's cookie jar, which would authenticate the request as a session
    and mask the bearer path entirely.)"""
    path = _seed_bare_repo_with_ref(app, "vault")
    token = owner_client.post("/api/auth/tokens", json={"name": "git", "scope": "write"}).json()["token"]

    r = anon_client.post("/api/git-repos/vault/reset", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert (path / "refs" / "heads" / "old-history").exists()


def test_reset_validates_repo_name(owner_client):
    for bad in ("..", "a/b", "x" * 65):
        r = owner_client.post(f"/api/git-repos/{bad}/reset")
        # Traversal-looking names either fail validation (422) or don't
        # route at all (404) — never reach the filesystem.
        assert r.status_code in (404, 422)

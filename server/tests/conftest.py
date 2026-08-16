from __future__ import annotations

import secrets
import string
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models, security  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

OWNER_USERNAME = "owner"
OWNER_PASSWORD = "correct horse battery staple 1"
OWNER_EMAIL = "owner@example.com"


@pytest.fixture
def make_settings(tmp_path):
    counter = {"n": 0}

    def _make(**overrides):
        counter["n"] += 1
        db_path = tmp_path / f"test_{counter['n']}.db"
        defaults = dict(
            db_url=f"sqlite:///{db_path}",
            # Phase 11 — every app instance eagerly `mkdir`s this at
            # create_app() time (see main.py's `/git` mount), so it MUST be
            # `tmp_path`-scoped like `db_url` above: without this override
            # every test app defaults to `./git-repos` relative to pytest's
            # CWD (server/), which would litter `server/git-repos/` on disk
            # every single test run instead of staying inside pytest's
            # auto-cleaned tmp dir.
            git_root=str(tmp_path / f"gitroot_{counter['n']}"),
            secret_key="pytest-fixed-secret-key-not-for-prod-use",
            cookie_secure=False,
            env="dev",
            # High default limits so unrelated tests never trip a rate
            # limiter by accident; test_rate_limit.py overrides these low.
            rate_limit_default="1000/minute",
            rate_limit_share="1000/minute",
            rate_limit_share_auth="1000/minute",
            session_ttl_min=30,
        )
        defaults.update(overrides)
        return Settings(**defaults)

    return _make


@pytest.fixture
def make_app(make_settings):
    def _make(settings: Settings | None = None, **overrides):
        return create_app(settings or make_settings(**overrides))

    return _make


@pytest.fixture
def app(make_app):
    return make_app()


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def db_session(app):
    SessionLocal = app.state.SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def owner(db_session):
    user = models.User(
        username=OWNER_USERNAME,
        password_hash=security.hash_password(OWNER_PASSWORD),
        email=OWNER_EMAIL,
        is_admin=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def owner_client(client, owner):
    r = client.post("/api/auth/login", json={"username": OWNER_USERNAME, "password": OWNER_PASSWORD})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def anon_client(app):
    """A SEPARATE TestClient instance (its own cookie jar) pointed at the
    same app. `client`/`owner_client` alias the SAME underlying object (the
    latter just logs in on top of the former) — any test that needs a truly
    unauthenticated, uninvolved caller alongside an already-logged-in
    owner_client must use this fixture instead of `client`, or it will
    silently inherit the owner's session cookie."""
    return TestClient(app)


def publish_share(client: TestClient, *, content: bytes = b"hello world", **share_kwargs) -> dict:
    """Publish a blob + share via the owner API. `client` must already be
    authenticated (see owner_client). Returns the ShareOut JSON dict."""
    files = {"file": ("note.md", content, "text/markdown")}
    r = client.post("/api/blobs", files=files)
    assert r.status_code == 201, r.text
    blob_id = r.json()["id"]

    payload = {
        "source_path": "notes/x.md",
        "blob_id": blob_id,
        "render_mode": "raw",
        "general_access": "link",
        "auth_mode": "none",
    }
    payload.update(share_kwargs)
    r = client.post("/api/shares", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def publish_folder_share(
    client: TestClient,
    *,
    files: dict | None = None,
    source_path: str = "notes",
    **share_kwargs,
) -> dict:
    """Publish a folder share via the owner API. `files` maps relpath ->
    content bytes (default: a small two-file tree). Returns the ShareOut
    JSON dict (includes `manifest_count`)."""
    if files is None:
        files = {"a.md": b"file a", "sub/b.md": b"file b"}

    manifest = []
    for relpath, content in files.items():
        r = client.post("/api/blobs", files={"file": (relpath.split("/")[-1], content, "text/markdown")})
        assert r.status_code == 201, r.text
        manifest.append({"relpath": relpath, "blob_id": r.json()["id"]})

    payload = {
        "source_path": source_path,
        "kind": "folder",
        "manifest": manifest,
        "render_mode": "raw",
        "general_access": "link",
        "auth_mode": "none",
    }
    payload.update(share_kwargs)
    r = client.post("/api/shares", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def random_wellformed_slug(length: int = 22) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

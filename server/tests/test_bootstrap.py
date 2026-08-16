"""Phase 12 (DESIGN-SPEC Amendments round 4, item 32) — "fallback-login
onboarding": `main.py::bootstrap_user` (the `SLATE_BOOTSTRAP_USER`/
`SLATE_BOOTSTRAP_PASSWORD` env-var path, wired into `create_app()`) and
`scripts/create_user.py` (the interactive CLI companion). Full contract:
bootstrap creates the user iff the `users` table is empty; a second
startup never overwrites or changes the password; the password never
appears in any captured log; the half-configured case (exactly one of the
two vars set) fails loudly at startup; `create_user.py` hashes with
argon2id and refuses/handles a duplicate username per its own documented
`--force` design.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

import pytest

from app import models, security
from app.main import bootstrap_user, create_app

SERVER_DIR = Path(__file__).resolve().parent.parent
PYTHON = SERVER_DIR / ".venv" / "bin" / "python"
CREATE_USER_SCRIPT = SERVER_DIR / "scripts" / "create_user.py"


# --- main.py::bootstrap_user -----------------------------------------------


def test_bootstrap_noop_when_neither_var_set(make_settings):
    settings = make_settings()
    app = create_app(settings)
    db = app.state.SessionLocal()
    try:
        assert db.query(models.User).count() == 0
    finally:
        db.close()


def test_bootstrap_creates_user_iff_table_empty(make_settings):
    settings = make_settings(bootstrap_user="owner1", bootstrap_password="correct horse battery staple")
    app = create_app(settings)
    db = app.state.SessionLocal()
    try:
        users = db.query(models.User).all()
        assert len(users) == 1
        assert users[0].username == "owner1"
        assert users[0].is_admin is True
        assert security.verify_password(users[0].password_hash, "correct horse battery staple")
        # Real argon2id hash, not some placeholder/plaintext.
        assert users[0].password_hash.startswith("$argon2id$")
    finally:
        db.close()


def test_bootstrap_second_startup_never_overwrites_existing_password(make_settings, tmp_path):
    db_path = tmp_path / "shared.db"
    db_url = f"sqlite:///{db_path}"

    settings1 = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password="original-password-123")
    app1 = create_app(settings1)
    db1 = app1.state.SessionLocal()
    try:
        original_hash = db1.query(models.User).filter(models.User.username == "owner1").one().password_hash
    finally:
        db1.close()

    # "Restart" against the SAME db_url — a real second-boot scenario — with
    # a DIFFERENT password value in the env (simulating a stale/forgotten
    # env var still sitting around, or an operator trying to "update" the
    # password this way, which must NOT work).
    settings2 = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password="a-totally-different-password")
    app2 = create_app(settings2)
    db2 = app2.state.SessionLocal()
    try:
        users = db2.query(models.User).all()
        assert len(users) == 1, "bootstrap must never create a second row on a re-run"
        assert users[0].password_hash == original_hash, "bootstrap must never overwrite an existing password hash"
        assert security.verify_password(users[0].password_hash, "original-password-123")
        assert not security.verify_password(users[0].password_hash, "a-totally-different-password")
    finally:
        db2.close()


def test_bootstrap_does_not_overwrite_a_user_created_by_other_means(make_settings, tmp_path):
    """The gate is "does ANY user exist", not "does a user with this exact
    username already exist" — per the phase brief ("iff the users table is
    empty"). A pre-existing user from a completely different source (here:
    a plain owner fixture, standing in for `demo.sh`/`create_user.py`) must
    also block bootstrap from ever running, even though its username
    differs from `SLATE_BOOTSTRAP_USER`."""
    db_path = tmp_path / "preexisting.db"
    db_url = f"sqlite:///{db_path}"

    settings0 = make_settings(db_url=db_url)
    app0 = create_app(settings0)
    db0 = app0.state.SessionLocal()
    try:
        db0.add(models.User(username="someone-else", password_hash=security.hash_password("whatever"), is_admin=True))
        db0.commit()
    finally:
        db0.close()

    settings1 = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password="should-never-be-created")
    app1 = create_app(settings1)
    db1 = app1.state.SessionLocal()
    try:
        users = db1.query(models.User).all()
        assert len(users) == 1
        assert users[0].username == "someone-else"
    finally:
        db1.close()


def test_bootstrap_half_configured_fails_loudly(make_settings):
    settings_user_only = make_settings(bootstrap_user="owner1", bootstrap_password=None)
    with pytest.raises(RuntimeError, match="SLATE_BOOTSTRAP_USER and SLATE_BOOTSTRAP_PASSWORD"):
        create_app(settings_user_only)

    settings_password_only = make_settings(bootstrap_user=None, bootstrap_password="somepassword")
    with pytest.raises(RuntimeError, match="SLATE_BOOTSTRAP_USER and SLATE_BOOTSTRAP_PASSWORD"):
        create_app(settings_password_only)


def test_bootstrap_half_configured_creates_no_user(make_settings, tmp_path):
    db_path = tmp_path / "half.db"
    db_url = f"sqlite:///{db_path}"
    settings = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password=None)
    with pytest.raises(RuntimeError):
        create_app(settings)

    # A subsequent, fully-configured boot against the SAME db still works
    # fine — the failed half-configured attempt left no partial row behind
    # to conflict with it.
    settings2 = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password="a-real-password")
    app2 = create_app(settings2)
    db2 = app2.state.SessionLocal()
    try:
        assert db2.query(models.User).count() == 1
    finally:
        db2.close()


def test_bootstrap_password_never_appears_in_logs(make_settings, caplog):
    secret_password = "extremely-secret-do-not-log-me-9182"
    settings = make_settings(bootstrap_user="owner1", bootstrap_password=secret_password)

    with caplog.at_level(logging.DEBUG):
        create_app(settings)

    for record in caplog.records:
        assert secret_password not in record.getMessage()
        assert secret_password not in repr(record.args)
    # Sanity: the log capture actually captured SOMETHING from bootstrap
    # (the success message), so this test isn't vacuously passing over an
    # empty caplog.
    assert any("owner1" in record.getMessage() for record in caplog.records)


def test_bootstrap_password_never_appears_in_logs_on_failure_path(make_settings, caplog):
    settings = make_settings(bootstrap_user="owner1", bootstrap_password=None)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(RuntimeError):
            create_app(settings)
    # Nothing password-shaped to leak in the half-configured case (no
    # password was ever provided) — this just confirms the failure path
    # doesn't somehow echo settings/env internals into a log record.
    for record in caplog.records:
        assert "SLATE_BOOTSTRAP_PASSWORD=" not in record.getMessage()


def test_bootstrap_function_directly_is_idempotent(make_settings, tmp_path):
    """Direct unit-level check on `bootstrap_user` itself (not just via
    `create_app`), calling it twice against the same session factory —
    mirrors what two `create_app()` calls do internally without the extra
    app-construction overhead."""
    db_url = f"sqlite:///{tmp_path / 'direct.db'}"
    settings = make_settings(db_url=db_url, bootstrap_user="owner1", bootstrap_password="pw-one")
    app = create_app(make_settings(db_url=db_url))  # build tables, no bootstrap vars set
    SessionLocal = app.state.SessionLocal

    bootstrap_user(SessionLocal, settings)
    bootstrap_user(SessionLocal, settings)  # second call — must be a no-op, not an error

    db = SessionLocal()
    try:
        assert db.query(models.User).count() == 1
    finally:
        db.close()


# --- scripts/create_user.py --------------------------------------------


def _run_create_user(db_url: str, stdin_text: str, *extra_args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(PYTHON), str(CREATE_USER_SCRIPT), *extra_args],
        input=stdin_text,
        env={"SLATE_DB_URL": db_url, "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        timeout=30,
    )


@pytest.mark.skipif(not PYTHON.exists(), reason="server/.venv not present in this environment")
def test_create_user_script_hashes_with_argon2id(tmp_path):
    db_path = tmp_path / "cli.db"
    db_url = f"sqlite:///{db_path}"

    result = _run_create_user(db_url, "clioperator\nsuper-secret-cli-password\nsuper-secret-cli-password\n")
    assert result.returncode == 0, f"stdout={result.stdout!r} stderr={result.stderr!r}"
    assert "Created user 'clioperator'" in result.stdout
    assert "super-secret-cli-password" not in result.stdout
    assert "super-secret-cli-password" not in result.stderr

    from app.db import make_engine, make_sessionmaker

    engine = make_engine(db_url)
    db = make_sessionmaker(engine)()
    try:
        user = db.query(models.User).filter(models.User.username == "clioperator").one()
        assert user.password_hash.startswith("$argon2id$")
        assert security.verify_password(user.password_hash, "super-secret-cli-password")
        assert user.is_admin is True
    finally:
        db.close()


@pytest.mark.skipif(not PYTHON.exists(), reason="server/.venv not present in this environment")
def test_create_user_script_refuses_duplicate_without_force(tmp_path):
    db_path = tmp_path / "dup.db"
    db_url = f"sqlite:///{db_path}"

    first = _run_create_user(db_url, "dupuser\npassword-one-123\npassword-one-123\n")
    assert first.returncode == 0, first.stderr

    second = _run_create_user(db_url, "dupuser\npassword-two-456\npassword-two-456\n")
    assert second.returncode != 0
    assert "already exists" in second.stderr

    from app.db import make_engine, make_sessionmaker

    engine = make_engine(db_url)
    db = make_sessionmaker(engine)()
    try:
        user = db.query(models.User).filter(models.User.username == "dupuser").one()
        # The refused second attempt must not have touched the original password.
        assert security.verify_password(user.password_hash, "password-one-123")
        assert not security.verify_password(user.password_hash, "password-two-456")
    finally:
        db.close()


@pytest.mark.skipif(not PYTHON.exists(), reason="server/.venv not present in this environment")
def test_create_user_script_force_resets_existing_password(tmp_path):
    db_path = tmp_path / "force.db"
    db_url = f"sqlite:///{db_path}"

    first = _run_create_user(db_url, "resetme\noriginal-pw-999\noriginal-pw-999\n")
    assert first.returncode == 0, first.stderr

    forced = _run_create_user(db_url, "resetme\nbrand-new-pw-777\nbrand-new-pw-777\n", "--force")
    assert forced.returncode == 0, forced.stderr
    assert "Password reset for existing user 'resetme'" in forced.stdout

    from app.db import make_engine, make_sessionmaker

    engine = make_engine(db_url)
    db = make_sessionmaker(engine)()
    try:
        users = db.query(models.User).filter(models.User.username == "resetme").all()
        assert len(users) == 1, "--force must reset the existing row, never create a second one"
        assert security.verify_password(users[0].password_hash, "brand-new-pw-777")
        assert not security.verify_password(users[0].password_hash, "original-pw-999")
    finally:
        db.close()


@pytest.mark.skipif(not PYTHON.exists(), reason="server/.venv not present in this environment")
def test_create_user_script_mismatched_passwords_reprompt_then_succeed(tmp_path):
    db_path = tmp_path / "mismatch.db"
    db_url = f"sqlite:///{db_path}"

    # First confirm attempt mismatches; script re-prompts and the second
    # attempt matches.
    stdin_text = "mismatcher\nfirst-try-pw\nDOES-NOT-MATCH\nsecond-try-pw\nsecond-try-pw\n"
    result = _run_create_user(db_url, stdin_text)
    assert result.returncode == 0, f"stdout={result.stdout!r} stderr={result.stderr!r}"

    from app.db import make_engine, make_sessionmaker

    engine = make_engine(db_url)
    db = make_sessionmaker(engine)()
    try:
        user = db.query(models.User).filter(models.User.username == "mismatcher").one()
        assert security.verify_password(user.password_hash, "second-try-pw")
    finally:
        db.close()

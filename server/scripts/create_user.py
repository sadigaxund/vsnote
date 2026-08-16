#!/usr/bin/env python
"""Phase 12 (DESIGN-SPEC Amendments round 4, item 32) — interactive CLI to
create (or reset) a fallback-login user. This is the "do it any time, not
just at startup" companion to `main.py::bootstrap_user` (the
`SLATE_BOOTSTRAP_USER`/`SLATE_BOOTSTRAP_PASSWORD` env-var path, which only
ever fires once, iff the `users` table is completely empty). Use THIS script
for every other case: adding a second account, or resetting a forgotten
password on an existing deployment.

Same DB the running server uses (`SLATE_DB_URL`/`server/.env`, via
`app.config.Settings` — identical resolution to `app/main.py`'s own, and to
`scripts/demo.sh`'s inline bootstrap snippet) — this is a plain script, not
an HTTP client, so there is no separate "is the server up" requirement; it
writes directly to the same sqlite file/DB the server reads. Safe to run
with the server running or stopped.

Hashing: `app.security.hash_password` — the exact same argon2id path
`main.py::bootstrap_user` and `routers/auth.py::login`'s verify side use.
There is deliberately no second hashing implementation anywhere in this
codebase.

Password entry: `getpass.getpass()` (hidden, no echo to the terminal), typed
twice with a mismatch re-prompt — the interactive equivalent of a browser
password-confirm field. Never accepted as a command-line argument (argv is
visible to every other process on the machine via `/proc`/`ps`, and lands in
shell history) and never echoed, logged, or printed back anywhere in this
script.

Usage:
    server/.venv/bin/python server/scripts/create_user.py
    server/.venv/bin/python server/scripts/create_user.py --force   # reset an existing user's password
    server/.venv/bin/python server/scripts/create_user.py --no-admin

Existing-user behavior (this script's own design choice, documented here
per the phase brief): REFUSE by default — printing a clear "already exists,
pass --force to reset its password" message and exiting nonzero — rather
than silently overwriting a password an operator didn't explicitly ask to
change. `--force` opts into resetting the password (and the admin flag, if
`--admin`/`--no-admin` was passed) for that EXISTING row; it never creates a
second row for the same username (usernames are already DB-unique — see
`models.User.username`).
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models, security  # noqa: E402
from app.config import Settings  # noqa: E402
from app.db import Base, make_engine, make_sessionmaker  # noqa: E402


def prompt_username() -> str:
    while True:
        username = input("Username: ").strip()
        if username:
            return username
        print("Username cannot be empty.", file=sys.stderr)


def prompt_password() -> str:
    while True:
        password = getpass.getpass("Password: ")
        if not password:
            print("Password cannot be empty.", file=sys.stderr)
            continue
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords did not match — try again.", file=sys.stderr)
            continue
        return password


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create or reset a Slate fallback-login user.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reset the password of an existing user instead of refusing.",
    )
    admin_group = parser.add_mutually_exclusive_group()
    admin_group.add_argument("--admin", dest="is_admin", action="store_true", default=True, help="Grant admin (default).")
    admin_group.add_argument("--no-admin", dest="is_admin", action="store_false", help="Do not grant admin.")
    args = parser.parse_args(argv)

    settings = Settings()
    engine = make_engine(settings.db_url)
    Base.metadata.create_all(engine)
    db = make_sessionmaker(engine)()

    try:
        username = prompt_username()
        existing = db.query(models.User).filter(models.User.username == username).one_or_none()
        if existing is not None and not args.force:
            print(
                f"User {username!r} already exists. Re-run with --force to reset its password.",
                file=sys.stderr,
            )
            return 1

        password = prompt_password()
        password_hash = security.hash_password(password)
        # `password`/`password_hash` never appear in anything printed below
        # — only the username and a plain outcome word.
        del password

        if existing is not None:
            existing.password_hash = password_hash
            existing.is_admin = args.is_admin
            db.commit()
            print(f"Password reset for existing user {username!r}.")
        else:
            db.add(
                models.User(
                    username=username,
                    password_hash=password_hash,
                    email=None,
                    is_admin=args.is_admin,
                )
            )
            db.commit()
            print(f"Created user {username!r}.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

"""SQLAlchemy engine/session plumbing. SQLite, Alembic-free (Phase 9 uses
`Base.metadata.create_all`; a real migration tool is deferred until the
schema needs to change under live data — see ARCHITECTURE.md).

Deliberately NOT a module-level singleton engine/session: `app/main.py`'s
`create_app()` builds a fresh engine + sessionmaker per app instance so each
pytest test can point at its own temporary SQLite file (tmp_path) without any
cross-test state leaking through a shared global.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine(db_url: str) -> Engine:
    connect_args = {}
    kwargs = {}
    if db_url.startswith("sqlite"):
        # Needed because FastAPI's TestClient / uvicorn's threadpool touch
        # the session from a different thread than the one that created it.
        connect_args["check_same_thread"] = False
        # Concurrency hardening (TODO §6.5): under the fullyParallel e2e run
        # (many browser workers -> concurrent POST/PATCH bursts through
        # uvicorn's threadpool), SQLite's default 5s busy handler timed out
        # as "database is locked" 500s. 30s absorbs writer bursts; writes
        # here are short (single-row inserts/upserts), so this never wedges
        # a healthy server — it only stops spurious lock failures.
        connect_args["timeout"] = 30
        if ":memory:" in db_url or db_url in ("sqlite://", "sqlite:///:memory:"):
            # An in-memory SQLite DB is scoped to a single connection. With
            # the default pool, each new thread checks out its OWN
            # connection — i.e. its own, separate, empty database — which
            # made every request (run in a worker thread) see "no such
            # table" against data inserted from the test's main thread.
            # StaticPool pins the engine to exactly one shared connection so
            # all threads see the same in-memory DB. File-based SQLite
            # (including every pytest tmp_path DB) doesn't need this — the
            # same file is visible from any connection.
            kwargs["poolclass"] = StaticPool
    return create_engine(db_url, connect_args=connect_args, future=True, **kwargs)


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

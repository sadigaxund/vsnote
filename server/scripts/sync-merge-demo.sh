#!/usr/bin/env bash
# Phase 11 (real sync, roadmap §5.2) — re-runnable proof of the auto-merge /
# conflict-resolver pipeline against a REAL backend. Self-contained: builds
# its own scratch DB/git-root, starts its own uvicorn on an OS-assigned free
# port (never collides with `npm run server`'s 8787 or the e2e suite's
# 8788), mints a real write-scoped API token directly against that scratch
# DB (same `ApiToken`/`security.hash_token` model `server/tests/
# test_git_sync.py`'s fixtures use), and tears everything down (kills
# exactly the PID it spawned) on exit — same shape as
# `single_origin_navigation_demo.sh`.
#
# The actual merge/conflict PROOF is delegated to
# `tests/manual/syncMergeDemo.spec.ts` (run via `npx vitest run --config
# tests/manual/vitest.config.ts`): a real vitest process driving the app's
# OWN `src/git/sync.ts`/`src/git/remote.ts`/`src/git/backupRefs.ts`
# TypeScript modules — exactly what `useGitStore.ts`'s `syncNow`/
# `resolveConflict` call — against this script's real backend over real
# HTTP, cross-checked at every step with independent SYSTEM `git` clones
# (never trusting the app's own read-back). This script's job is standing
# the backend up and handing that test file the URL/token/repo name it
# needs; the narrated step-by-step output comes from the vitest run itself.
#
# Usage: server/scripts/sync-merge-demo.sh
# Exit code is nonzero on ANY assertion failure — safe to wire into CI.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
PYTHON="$SERVER_DIR/.venv/bin/python"

WORKDIR="$(mktemp -d)"
DB_PATH="$WORKDIR/demo.db"
GIT_ROOT="$WORKDIR/git-repos"
UVICORN_LOG="$WORKDIR/uvicorn.log"

PORT="$("$PYTHON" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
BASE="http://127.0.0.1:$PORT"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "############################################################"
echo "# 0. Bootstrap scratch DB + owner + a real write-scoped API token,"
echo "#    start uvicorn on $BASE"
echo "############################################################"
export VSNOTE_DB_URL="sqlite:///$DB_PATH"
export VSNOTE_GIT_ROOT="$GIT_ROOT"
export VSNOTE_COOKIE_SECURE=False
export VSNOTE_ENV=dev
export VSNOTE_SECRET_KEY="sync-merge-demo-fixed-secret-not-for-prod"

DEMO_TOKEN="demo-sync-merge-write-token-$(date +%s)"
PYTHONPATH="$SERVER_DIR" VSNOTE_DB_URL="$VSNOTE_DB_URL" "$PYTHON" -c "
from app.db import make_engine, make_sessionmaker, Base
from app import models, security
import os
engine = make_engine(os.environ['VSNOTE_DB_URL'])
Base.metadata.create_all(engine)
db = make_sessionmaker(engine)()
user = models.User(username='demo-owner', password_hash=security.hash_password('demo-owner-pw-123'), email='demo-owner@example.com', is_admin=True)
db.add(user)
db.commit()
db.refresh(user)
token = '$DEMO_TOKEN'
db.add(models.ApiToken(user_id=user.id, name='sync-merge-demo', token_hash=security.hash_token(token), prefix=token[:12], scope=models.TokenScope.write))
db.commit()
db.close()
print('owner + write-scoped token bootstrapped')
"

"$PYTHON" -m uvicorn app.main:app --app-dir "$SERVER_DIR" --port "$PORT" >"$UVICORN_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "$BASE/api/auth/whoami"; then break; fi
  sleep 0.2
done
if ! curl -s -o /dev/null "$BASE/api/auth/whoami"; then
  echo "FAIL: server never became ready — see $UVICORN_LOG" >&2
  cat "$UVICORN_LOG" >&2
  exit 1
fi
echo "  server up, PID=$SERVER_PID"

echo
echo "############################################################"
echo "# 1. Run the real proof: tests/manual/syncMergeDemo.spec.ts"
echo "#    (real client git modules, real HTTP, real system-git checks)"
echo "############################################################"
cd "$REPO_ROOT"
VSNOTE_DEMO_BASE_URL="$BASE" \
VSNOTE_DEMO_TOKEN="$DEMO_TOKEN" \
VSNOTE_DEMO_REPO="sync-merge-demo" \
  npx vitest run --config tests/manual/vitest.config.ts

echo
echo "############################################################"
echo "# Demo complete — backend + scratch DB/git-root torn down on exit."
echo "############################################################"

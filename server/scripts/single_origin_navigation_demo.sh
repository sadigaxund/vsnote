#!/usr/bin/env bash
# Production-topology proof for Phase 10.5a's `_deny_response` widening
# (roadmap §5.4, `app/routers/share_public.py`) — runs against a REAL
# `uvicorn` instance serving the REAL built `dist/`, the actual production
# shape, deliberately NOT `vite preview`. This is the distinction that
# mattered: `vite preview`'s dev-only `shareAuthProxy` `bypass` rule serves
# a real browser navigation to `/share/...` via Vite's own SPA fallback
# regardless of backend state, which is why the whole e2e suite (100% of
# which runs against `vite preview`) stayed green while the single-origin
# `uvicorn` deployment 404'd on a real password-protected/revoked/expired
# share's cold navigation. This script is what catches THAT class of bug
# again if it ever comes back.
#
# Self-contained: builds its own scratch DB/git-root, starts its own
# uvicorn on an OS-assigned free port, tears both down (kills exactly the
# PID it spawned) on exit (success OR failure) via `trap`. Requires a built
# `dist/` (run `npm run build` first) — fails loudly, not silently, if
# missing, since serving `dist/` is the entire point of this script.
#
# Usage: server/scripts/single_origin_navigation_demo.sh
# Exit code is nonzero on ANY assertion failure — safe to wire into CI.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
PYTHON="$SERVER_DIR/.venv/bin/python"
DIST_DIR="$REPO_ROOT/dist"

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "FAIL: $DIST_DIR/index.html not found — run 'npm run build' from the repo root first." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
OWNER_COOKIES="$WORKDIR/owner_cookies.txt"
SHARE_COOKIES="$WORKDIR/share_cookies.txt"
DB_PATH="$WORKDIR/demo.db"
GIT_ROOT="$WORKDIR/git-repos"
UVICORN_LOG="$WORKDIR/uvicorn.log"

# OS-assigned free port — never a fixed one, so this never collides with a
# real `npm run server` (8787) or the e2e suite's backend (8788).
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

FAILURES=0
check() {
  # check <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    echo "  OK   $1"
  else
    echo "  FAIL $1 — expected [$3], got [$2]"
    FAILURES=$((FAILURES + 1))
  fi
}

json_field() {
  "$PYTHON" -c "import sys, json; print(json.load(sys.stdin)['$1'])"
}

echo "############################################################"
echo "# 0. Bootstrap scratch DB + owner account, start uvicorn on $BASE"
echo "############################################################"
export SLATE_DB_URL="sqlite:///$DB_PATH"
export SLATE_GIT_ROOT="$GIT_ROOT"
export SLATE_COOKIE_SECURE=False
export SLATE_ENV=dev
export SLATE_SECRET_KEY="single-origin-demo-fixed-secret-not-for-prod"

PYTHONPATH="$SERVER_DIR" "$PYTHON" -c "
from app.db import make_engine, make_sessionmaker, Base
from app import models, security
import os
engine = make_engine(os.environ['SLATE_DB_URL'])
Base.metadata.create_all(engine)
db = make_sessionmaker(engine)()
db.add(models.User(username='demo-owner', password_hash=security.hash_password('demo-owner-pw-123'), email='demo-owner@example.com', is_admin=True))
db.commit()
db.close()
print('owner bootstrapped')
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
echo "# 1. SPA served at / (sanity)"
echo "############################################################"
ROOT_TYPE="$(curl -s -o /dev/null -w '%{content_type}' "$BASE/")"
case "$ROOT_TYPE" in
  text/html*) echo "  OK   / serves text/html ($ROOT_TYPE)" ;;
  *) echo "  FAIL / did not serve text/html, got: $ROOT_TYPE"; FAILURES=$((FAILURES + 1)) ;;
esac

echo
echo "############################################################"
echo "# 2. Login, publish a PASSWORD-protected rendered-mode share"
echo "############################################################"
curl -s -c "$OWNER_COOKIES" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"demo-owner","password":"demo-owner-pw-123"}' >/dev/null

BLOB_ID=$(curl -s -b "$OWNER_COOKIES" -X POST "$BASE/api/blobs" \
  -F "file=@-;filename=secret-note.md;type=text/markdown" <<< "# Password-protected content" | json_field id)

SLUG=$(curl -s -b "$OWNER_COOKIES" -X POST "$BASE/api/shares" \
  -H "Content-Type: application/json" \
  -d "{\"source_path\":\"notes/secret.md\",\"blob_id\":\"$BLOB_ID\",\"render_mode\":\"rendered\",\"general_access\":\"link\",\"auth_mode\":\"password\",\"password\":\"correct-horse\"}" \
  | json_field slug)
echo "  published slug=$SLUG"

echo
echo "############################################################"
echo "# 3. THE headline assertion: cold browser navigation to the"
echo "#    password-protected link, before entering the password"
echo "############################################################"
NAV_BEFORE_AUTH="$(curl -s -o "$WORKDIR/nav_before_auth.html" -w '%{http_code} %{content_type}' \
  -H 'Accept: text/html,application/xhtml+xml' "$BASE/share/$SLUG")"
NAV_STATUS="${NAV_BEFORE_AUTH%% *}"
NAV_CTYPE="${NAV_BEFORE_AUTH#* }"
check "cold navigation to password share -> 200" "$NAV_STATUS" "200"
case "$NAV_CTYPE" in
  text/html*) echo "  OK   cold navigation -> text/html (the SPA shell, not JSON)" ;;
  *) echo "  FAIL cold navigation content-type: $NAV_CTYPE"; FAILURES=$((FAILURES + 1)) ;;
esac
if diff -q "$DIST_DIR/index.html" "$WORKDIR/nav_before_auth.html" >/dev/null 2>&1; then
  echo "  OK   shell bytes are IDENTICAL to dist/index.html — content-independent, no leaked detail"
else
  echo "  FAIL shell bytes differ from dist/index.html"
  FAILURES=$((FAILURES + 1))
fi

echo
echo "############################################################"
echo "# 4. The JSON/data-fetch path (what the SPA itself uses) is"
echo "#    UNAFFECTED — still the byte-identical uniform 404"
echo "############################################################"
JSON_BEFORE_AUTH="$(curl -s -w '\n%{http_code}' -H 'Accept: application/json' "$BASE/share/$SLUG")"
JSON_BODY_BEFORE="$(echo "$JSON_BEFORE_AUTH" | head -n1)"
JSON_STATUS_BEFORE="$(echo "$JSON_BEFORE_AUTH" | tail -n1)"
check "JSON fetch, no session -> 404" "$JSON_STATUS_BEFORE" "404"
check "JSON fetch, no session -> uniform body" "$JSON_BODY_BEFORE" '{"detail":"Not found"}'

BOGUS_JSON="$(curl -s -w '\n%{http_code}' -H 'Accept: application/json' "$BASE/share/totally-bogus-000000000000000")"
BOGUS_BODY="$(echo "$BOGUS_JSON" | head -n1)"
BOGUS_STATUS="$(echo "$BOGUS_JSON" | tail -n1)"
check "bogus slug JSON fetch -> 404" "$BOGUS_STATUS" "404"
check "bogus slug body == password-required body (uniform)" "$BOGUS_BODY" "$JSON_BODY_BEFORE"

BOGUS_NAV="$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE/share/totally-bogus-000000000000000")"
check "bogus slug, Accept: text/html -> 200 (the shell, same as password-required)" "$BOGUS_NAV" "200"

echo
echo "############################################################"
echo "# 5. Submit the WRONG password -> still the uniform 404"
echo "############################################################"
WRONG_PW="$(curl -s -w '\n%{http_code}' -c "$SHARE_COOKIES" -X POST "$BASE/share/$SLUG/auth" \
  -H "Content-Type: application/json" -d '{"password":"nope"}')"
WRONG_PW_STATUS="$(echo "$WRONG_PW" | tail -n1)"
check "wrong password -> 404" "$WRONG_PW_STATUS" "404"

echo
echo "############################################################"
echo "# 6. Submit the CORRECT password -> session cookie, then the"
echo "#    real content is reachable via BOTH the JSON re-fetch AND"
echo "#    a browser navigation (still the shell, now for a SUCCESS)"
echo "############################################################"
RIGHT_PW="$(curl -s -w '\n%{http_code}' -c "$SHARE_COOKIES" -X POST "$BASE/share/$SLUG/auth" \
  -H "Content-Type: application/json" -d '{"password":"correct-horse"}')"
RIGHT_PW_STATUS="$(echo "$RIGHT_PW" | tail -n1)"
check "correct password -> 200" "$RIGHT_PW_STATUS" "200"

JSON_AFTER_AUTH="$(curl -s -b "$SHARE_COOKIES" -H 'Accept: application/json' "$BASE/share/$SLUG")"
CONTENT_AFTER_AUTH="$(echo "$JSON_AFTER_AUTH" | json_field content)"
check "authenticated JSON re-fetch returns the real content" "$CONTENT_AFTER_AUTH" "# Password-protected content"

NAV_AFTER_AUTH="$(curl -s -o "$WORKDIR/nav_after_auth.html" -w '%{http_code}' -b "$SHARE_COOKIES" \
  -H 'Accept: text/html' "$BASE/share/$SLUG")"
check "authenticated browser navigation -> 200" "$NAV_AFTER_AUTH" "200"
if diff -q "$DIST_DIR/index.html" "$WORKDIR/nav_after_auth.html" >/dev/null 2>&1; then
  echo "  OK   authenticated navigation ALSO gets the identical shell (the SPA re-fetches JSON itself)"
else
  echo "  FAIL authenticated navigation shell bytes differ from dist/index.html"
  FAILURES=$((FAILURES + 1))
fi

echo
echo "############################################################"
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED (production topology: uvicorn serving the real dist/)"
  exit 0
else
  echo "$FAILURES CHECK(S) FAILED"
  exit 1
fi

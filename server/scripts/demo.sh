#!/usr/bin/env bash
# Re-runnable curl demo for the VSNote backend (Phase 9). Proves, against a
# REAL running server (not TestClient): publish a blob -> publish a share ->
# raw GET -> password auth flow (uniform 404 deny, then real auth) -> revoke
# -> expired. See server/README.md for the full API surface this exercises,
# in particular "Every deny reason is the SAME 404" — a password-protected
# share with no session 404s exactly like a dead/nonexistent one, on
# purpose (roadmap §1's no-existence-oracle requirement).
#
# Usage:
#   1. Start the server pointed at a scratch DB, e.g.:
#        VSNOTE_DB_URL=sqlite:///server/demo.db VSNOTE_COOKIE_SECURE=False \
#          server/.venv/bin/python -m uvicorn app.main:app --port 8787 --app-dir server &
#   2. VSNOTE_DB_URL=sqlite:///server/demo.db server/scripts/demo.sh
#
# Re-running is safe: the bootstrap owner account is idempotent, and each
# run publishes fresh shares (new blobs/slugs) rather than reusing state.

set -euo pipefail

BASE="${VSNOTE_DEMO_BASE:-http://127.0.0.1:8787}"
DB_URL="${VSNOTE_DB_URL:-sqlite:///./vsnote.db}"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$SERVER_DIR/.venv/bin/python"

OWNER_COOKIES="$(mktemp)"
SHARE_COOKIES="$(mktemp)"
CONTENT_FILE="$(mktemp)"
cleanup() { rm -f "$OWNER_COOKIES" "$SHARE_COOKIES" "$CONTENT_FILE"; }
trap cleanup EXIT

json_field() {
  # json_field <field> reads a JSON object from stdin, prints one field.
  "$PYTHON" -c "import sys, json; print(json.load(sys.stdin)['$1'])"
}

echo "############################################################"
echo "# 0. Bootstrap a demo owner account (idempotent)"
echo "############################################################"
# Deliberately does NOT `cd` into server/ — VSNOTE_DB_URL (a relative sqlite
# path, in the common case) must resolve the SAME way here as it did for
# the already-running uvicorn process, i.e. relative to whatever directory
# THIS script was invoked from. PYTHONPATH makes `app.*` importable without
# needing to change directory.
PYTHONPATH="$SERVER_DIR" VSNOTE_DB_URL="$DB_URL" "$PYTHON" -c "
from app.db import make_engine, make_sessionmaker, Base
from app import models, security
import os
engine = make_engine(os.environ['VSNOTE_DB_URL'])
Base.metadata.create_all(engine)
db = make_sessionmaker(engine)()
existing = db.query(models.User).filter(models.User.username == 'demo-owner').one_or_none()
if existing is None:
    db.add(models.User(
        username='demo-owner',
        password_hash=security.hash_password('demo-owner-pw-123'),
        email='demo-owner@example.com',
        is_admin=True,
    ))
    db.commit()
    print('created demo-owner')
else:
    print('demo-owner already exists')
db.close()
"

echo
echo "############################################################"
echo "# 1. Login"
echo "############################################################"
curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo-owner","password":"demo-owner-pw-123"}'
echo

echo
echo "############################################################"
echo "# 2. Publish a blob"
echo "############################################################"
printf 'hello from the Phase 9 demo script\n' > "$CONTENT_FILE"
BLOB_JSON=$(curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X POST "$BASE/api/blobs" \
  -F "file=@${CONTENT_FILE};filename=demo.md;type=text/markdown")
echo "$BLOB_JSON"
BLOB_ID=$(echo "$BLOB_JSON" | json_field id)

echo
echo "############################################################"
echo "# 3. Publish a raw, no-auth share"
echo "############################################################"
SHARE_JSON=$(curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X POST "$BASE/api/shares" \
  -H 'Content-Type: application/json' \
  -d "{\"source_path\":\"demo.md\",\"blob_id\":\"$BLOB_ID\",\"render_mode\":\"raw\",\"general_access\":\"link\",\"auth_mode\":\"none\"}")
echo "$SHARE_JSON"
SLUG=$(echo "$SHARE_JSON" | json_field slug)
SHARE_ID=$(echo "$SHARE_JSON" | json_field id)

echo
echo "############################################################"
echo "# 4. GET raw share -> text/plain + nosniff"
echo "############################################################"
curl -sS -i "$BASE/share/$SLUG"
echo

echo
echo "############################################################"
echo "# 5. Publish a password-protected share"
echo "############################################################"
PWSHARE_JSON=$(curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X POST "$BASE/api/shares" \
  -H 'Content-Type: application/json' \
  -d "{\"source_path\":\"secret.md\",\"blob_id\":\"$BLOB_ID\",\"render_mode\":\"raw\",\"general_access\":\"link\",\"auth_mode\":\"password\",\"password\":\"demo-share-pw\"}")
echo "$PWSHARE_JSON"
PWSLUG=$(echo "$PWSHARE_JSON" | json_field slug)

echo
echo "############################################################"
echo "# 6. GET password share without a session -> 404 (uniform deny — see"
echo "#    server/README.md's 'Every deny reason is the SAME 404' section)"
echo "############################################################"
curl -sS -i "$BASE/share/$PWSLUG"
echo

echo
echo "############################################################"
echo "# 7. POST wrong password -> 404 (indistinguishable from nonexistent)"
echo "############################################################"
curl -sS -i -X POST "$BASE/share/$PWSLUG/auth" -H 'Content-Type: application/json' -d '{"password":"wrong-guess"}'
echo

echo
echo "############################################################"
echo "# 8. POST right password -> 200 + sets a scoped session cookie"
echo "############################################################"
curl -sS -i -c "$SHARE_COOKIES" -X POST "$BASE/share/$PWSLUG/auth" -H 'Content-Type: application/json' -d '{"password":"demo-share-pw"}'
echo

echo
echo "############################################################"
echo "# 9. GET with the cookie -> 200"
echo "############################################################"
curl -sS -i -b "$SHARE_COOKIES" "$BASE/share/$PWSLUG"
echo

echo
echo "############################################################"
echo "# 10. Revoke the raw share -> 404 immediately"
echo "############################################################"
curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X DELETE "$BASE/api/shares/$SHARE_ID"
echo
curl -sS -i "$BASE/share/$SLUG"
echo

echo
echo "############################################################"
echo "# 11. Publish an already-expired share -> 404"
echo "############################################################"
EXPIRED_JSON=$(curl -sS -c "$OWNER_COOKIES" -b "$OWNER_COOKIES" -X POST "$BASE/api/shares" \
  -H 'Content-Type: application/json' \
  -d "{\"source_path\":\"old.md\",\"blob_id\":\"$BLOB_ID\",\"render_mode\":\"raw\",\"general_access\":\"link\",\"auth_mode\":\"none\",\"expires_at\":1}")
echo "$EXPIRED_JSON"
EXPSLUG=$(echo "$EXPIRED_JSON" | json_field slug)
curl -sS -i "$BASE/share/$EXPSLUG"
echo

echo
echo "############################################################"
echo "# Demo complete."
echo "############################################################"

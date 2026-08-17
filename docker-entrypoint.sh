#!/bin/sh
# DESIGN-SPEC Amendments round 7 item 50. The image (Dockerfile) creates
# /data/db, /data/git-repos, /data/secrets and chowns them to the non-root
# `vsnote` user at BUILD time, but a Docker named volume (or a bind mount
# to a host directory) that lands on top of one of those paths at RUN time
# is its own filesystem, created root-owned the first time it's mounted —
# the image-time chown never touches it. `docker-compose.yml`'s
# `vsnote-vault:/data/vault` volume is exactly this case, and it produced
# the reported bug: `POST /api/vault/init` hit `PermissionError` trying to
# create `.git` under a root-owned mount while the server ran as uid 1000.
#
# This entrypoint runs as root (the image no longer sets `USER vsnote`
# directly — see Dockerfile) ONLY long enough to fix ownership of the
# handful of paths this process actually writes to, then drops to the
# `vsnote` user via `setpriv` (already present in python:3.12-slim's base
# `util-linux` package, so this adds no new image dependency) and `exec`s
# straight into the real command — the server itself NEVER runs as root.
#
# Shallow chown only, deliberately: these directories are either created
# fresh and empty by a volume mount, or already correctly owned from a
# previous run (chown is idempotent), so there is never a large pre-
# existing tree under them that would make a recursive chown either
# necessary or fast. A vault with years of history mounted here would make
# `chown -R` a slow, unnecessary walk over every blob on every single
# container start; the `vsnote` user only needs to own the directory ITSELF
# to create/modify files inside it, and everything it creates is owned by
# it from that point on.
set -eu

chown_dir() {
    dir="$1"
    if [ -n "$dir" ]; then
        mkdir -p "$dir"
        chown vsnote:vsnote "$dir"
    fi
}

chown_dir "${VSNOTE_VAULT_PATH:-}"
chown_dir "${VSNOTE_SECRETS_PATH:-/data/secrets}"
# 0700 re-asserted here for defense in depth; `app/secrets_store.py`'s
# `ensure_secrets_root` re-asserts it again on every boot regardless (see
# that module's docstring) — this entrypoint's chmod is not a substitute.
chmod 0700 "${VSNOTE_SECRETS_PATH:-/data/secrets}"

# `setpriv` changes uid/gid but does NOT touch $HOME — without this, the
# process inherits root's $HOME=/root from the image's default (since
# there's no Dockerfile `USER vsnote` anymore for Docker to derive it
# from), and dulwich's repo init tries to stat `$HOME/.gitconfig` as uid
# 1000 against a directory only root can enter, raising a same-shaped
# `PermissionError` that looked identical to the actual vault-ownership
# bug this entrypoint exists to fix (caught live while testing this
# change against a real container: `[Errno 13] Permission denied:
# '/root/.gitconfig'`, NOT the vault path). `/app` is the `vsnote` user's
# real home dir (`Dockerfile`'s `useradd --home-dir /app`) and world-
# executable, so this is correct, not a workaround.
export HOME=/app

exec setpriv --reuid=vsnote --regid=vsnote --init-groups "$@"

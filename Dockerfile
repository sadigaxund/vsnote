# syntax=docker/dockerfile:1
#
# Phase 14 (docs/IMPLEMENTATION-PLAN-V2.md "Phase 14 — Containerization").
# Single-origin (docs/ROADMAP-SHARING-AUTH.md §5.4) means ONE image, ONE
# process: this Python/uvicorn process serves the built SPA *and* /api,
# /share/*, /git/* — see server/app/main.py's module docstring for how that
# single process serves both. Two build stages:
#
#   1. `builder` (node) — `npm ci && npm run build` to produce dist/. Node
#      and every npm dev dependency (vite, typescript, eslint, playwright,
#      ...) live ONLY in this stage and are discarded — the final image
#      never contains a `node` binary or `node_modules/`.
#   2. final stage (python:3.12-slim) — installs ONLY the backend's runtime
#      dependencies (server/requirements.txt, filtered to drop the two
#      test-only entries — pytest/httpx — that file also carries for local
#      `pytest` runs; nothing in this repo ever pip-installs those in the
#      image), copies server/app + server/scripts, copies dist/ from stage
#      1, and runs uvicorn as a non-root user.
#
# Nothing here changes local dev: `npm run dev`/`npm run server` never touch
# this file (CLAUDE.md rule 3).

# ---------------------------------------------------------------------------
# Stage 1: build the SPA
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /build

# Install deps first so this layer is cache-friendly across source-only
# changes. `npm ci` (not `install`) — exact, reproducible, respects
# package-lock.json, and fails loudly instead of silently drifting.
COPY package.json package-lock.json ./
RUN npm ci

# Now bring in the rest of the source needed for `npm run build`
# (tsc -b && vite build). .dockerignore already keeps node_modules/dist/
# server/.venv/tests/etc. out of this COPY's context.
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: the runtime image — python only, no node, no dev deps
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS final

# Backend runtime deps. requirements.txt is the same pinned file
# server/README.md tells a human to `pip install -r` — filtered here to
# drop pytest/httpx (test-only; CLAUDE.md rule 2's "no dev deps in the
# final image" per the Phase 14 brief) rather than hand-duplicating the
# other ten pins into a second file that could drift from the real one.
WORKDIR /app
COPY server/requirements.txt /tmp/requirements.txt
RUN grep -vE '^(pytest|httpx)==' /tmp/requirements.txt > /tmp/requirements.prod.txt \
    && pip install --no-cache-dir -r /tmp/requirements.prod.txt \
    && rm -f /tmp/requirements.txt /tmp/requirements.prod.txt

# Phase 17 Milestone B — `app/mirror.py` shells out to the REAL `git`/`ssh`
# binaries (see that module's docstring for why: battle-tested interop with
# GitHub/GitLab/Gitea beats reimplementing SSH/HTTPS transports on top of
# dulwich). `git` was already an implicit dependency of nothing else in this
# image (dulwich needs no system git); `openssh-client` (the `ssh`/
# `ssh-keygen` binaries) is new here specifically for SSH-credentialed
# mirror remotes. Installed in THIS final stage only — never the builder
# stage, and never anything that would bake a credential into a layer (no
# credential material is ever written anywhere under this Dockerfile's
# build context; see `app/secrets_store.py`'s module docstring for where it
# actually lives at runtime, a bind/named volume mounted in, never COPYd).
# `--no-install-recommends` + apt list cleanup keeps this from re-growing
# the slim base image by much.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Non-root user. The three paths this process ever writes to at runtime
# (the SQLite DB's directory, VSNOTE_GIT_ROOT's bare-repo directory, and
# VSNOTE_SECRETS_PATH's mirror-credential directory — Phase 17 Milestone B)
# need to be owned by it — everything else (the app code, dist/) is
# read-only from this process's point of view and can stay root-owned.
# `/data/secrets` is created 0700 here as a defensive default; `app/
# secrets_store.py::ensure_secrets_root` re-asserts 0700 on every boot
# regardless (belt-and-suspenders, not a substitute for this).
RUN groupadd --system --gid 1000 vsnote \
    && useradd --system --uid 1000 --gid vsnote --home-dir /app --shell /usr/sbin/nologin vsnote \
    && mkdir -p /data/db /data/git-repos /data/secrets \
    && chown -R vsnote:vsnote /data/db /data/git-repos /data/secrets \
    && chmod 0700 /data/secrets

# Backend source (app/ + scripts/, e.g. create_user.py for an operator to
# `docker compose exec` into). server/tests/ and server/.venv/ are excluded
# by .dockerignore / not copied here.
COPY server/app ./server/app
COPY server/scripts ./server/scripts

# The built SPA. server/app/main.py resolves DIST_DIR as
# `Path(__file__).resolve().parents[2] / "dist"` — main.py lives at
# /app/server/app/main.py, so parents[2] is /app, i.e. this must land at
# exactly /app/dist for the single-origin static/catch-all route to find it.
COPY --from=builder /build/dist ./dist

# Defaults for the three settings that must resolve to the writable, owned
# volume-backed paths above rather than app/config.py's relative-to-CWD
# defaults (./vsnote.db, ./git-repos, ./secrets — fine for `npm run server`
# from server/, wrong once this process's CWD/user don't own the app tree).
# Every other VSNOTE_* setting keeps app/config.py's own default and is
# passed through by docker-compose.yml when the operator wants to override
# it — nothing else is hardcoded here.
ENV VSNOTE_DB_URL=sqlite:////data/db/vsnote.db \
    VSNOTE_GIT_ROOT=/data/git-repos \
    VSNOTE_SECRETS_PATH=/data/secrets \
    VSNOTE_PORT=8787 \
    PYTHONUNBUFFERED=1

# `docker-entrypoint.sh` (repo root — see its own header comment, DESIGN-
# SPEC Amendments round 7 item 50) fixes ownership of any volume-mounted
# path this process writes to that the build-time chown above couldn't
# reach (a fresh named volume with nothing at its mount path in the image,
# e.g. VSNOTE_VAULT_PATH, is created root-owned regardless of what's
# chowned at build time), THEN drops to `vsnote` and execs the real
# command — this is why `USER vsnote` moved from a Dockerfile directive to
# something the entrypoint does at runtime instead: the entrypoint itself
# has to start as root to be able to chown anything.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 8787

# Shell form so ${VSNOTE_PORT} expands at container start (compose can still
# override the published host port independently — see docker-compose.yml).
# --proxy-headers/--forwarded-allow-ips: same single-origin-behind-a-tunnel
# rationale as `npm run server` (server/README.md's "Running it" section) —
# this is the one process a Cloudflare tunnel/reverse proxy points at. Runs
# as root only until the entrypoint's `setpriv` hands off to `vsnote` —
# the SERVED process is still always non-root, unchanged from before.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port \"${VSNOTE_PORT:-8787}\" --app-dir /app/server --proxy-headers --forwarded-allow-ips='*'"]

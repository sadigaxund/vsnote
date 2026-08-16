# Changelog

VSNote is a local-first note and code workspace: VSCode's shell (file tree,
tabs, real in-browser git, diffs, syntax highlighting) with Obsidian's writing
experience (live-preview markdown that reveals raw syntax only around the
cursor). A single-origin FastAPI backend adds fortified sharing, auth, and
real git sync — while the app itself stays fully usable offline.

Releases are versioned by date (CalVer, `YYYY.MM.DD`). Entries below start at
the first public release; the pre-release development history (the full v1
client and the v2 backend, August 2026) lives in the git log.

## [Unreleased]

### Breaking
- **Full Slate → VSNote rebrand — no back-compat.** Every server-side
  `SLATE_*` environment variable is renamed to `VSNOTE_*`
  (`VSNOTE_ENV`, `VSNOTE_DB_URL`, `VSNOTE_SECRET_KEY`, `VSNOTE_PORT`,
  `VSNOTE_MAX_BLOB_BYTES`, `VSNOTE_GIT_ROOT`, `VSNOTE_RATE_LIMIT_DEFAULT` /
  `_SHARE` / `_SHARE_AUTH`, `VSNOTE_SESSION_TTL_MIN`, `VSNOTE_COOKIE_SECURE`,
  `VSNOTE_BOOTSTRAP_USER` / `_PASSWORD`, `VSNOTE_HOST_PORT`); the server does
  **not** read the old names at all. Operators must rename these in their
  `.env`, `docker-compose.yml` overrides, and any CI/deployment secrets
  before upgrading, or the server silently falls back to defaults (e.g. an
  unset `VSNOTE_SECRET_KEY` in prod). The build-time vars `SLATE_BASE_PATH`
  and `SLATE_SHARE_PROXY_TARGET` are likewise renamed to `VSNOTE_BASE_PATH`
  / `VSNOTE_SHARE_PROXY_TARGET`.
- The default SQLite filename moves from `slate.db` to `vsnote.db`
  (`VSNOTE_DB_URL` default `sqlite:///./vsnote.db`, container default
  `sqlite:////data/db/vsnote.db`) — a fresh-install default only, no
  existing `slate.db` is migrated or renamed automatically.
- The git-auth realm (`WWW-Authenticate: Basic realm="vsnote-git"`) and both
  session cookie names (`slate_session` → `vsnote_session`,
  `slate_share_<slug>` → `vsnote_share_<slug>`) changed; any existing
  session is invalidated on upgrade (users simply sign in again — no data
  loss).
- `package.json`'s package name (`slate` → `vsnote`) and the Python backend's
  `pyproject.toml` project name (`slate-server` → `vsnote-server`).
- Removed the commented-out `cloudflared` sidecar sketch from
  `docker-compose.yml` (DESIGN-SPEC item 35) — it documented one operator's
  personal topology, not a project default. `server/README.md` now carries
  one neutral sentence noting any HTTPS reverse proxy or tunnel works
  (proxy headers are honored). `CF_ACCESS_*` variables are unaffected — the
  Cloudflare Access SSO feature (roadmap §2) is independent of any tunnel.
- **Browser-side storage keys renamed, with NO migration.** The lightning-fs
  IndexedDB database (`slate-vault-fs` → `vsnote-vault-fs`) and the three
  zustand `persist` localStorage keys (`slate-tabs` → `vsnote-tabs`,
  `slate-settings` → `vsnote-settings`, `slate-git-sync` →
  `vsnote-git-sync`) all move to the new brand. Nothing is copied across:
  after upgrading, the app opens a fresh, empty store, so a vault created
  before this release — every note and the whole in-browser git history —
  is no longer read, along with settings, open tabs, and sync state. The
  old data is not deleted; it stays inert in the browser under the old key
  names until site data is cleared, so it can still be recovered by hand
  via devtools. Export your vault (Command palette → "Export vault as
  .zip") before upgrading if you want to keep it.
- API tokens are now minted with a `vsn_` prefix instead of `slt_`. Tokens
  issued before this release keep working: each token row stores its own
  prefix and lookups use that stored value, never the current constant.

### Added
- CHANGELOG (this file).

## [2026.08.17] — first public release

Everything to date, in brief:

- **Editor**: CodeMirror 6 throughout — source, unified/side-by-side diff, and
  Obsidian-style live preview; VSCode-style find widget; grid split view with
  drag-to-dock panes; zen mode.
- **Vault**: in-browser git (isomorphic-git + IndexedDB), file tree with
  drag & drop, drafts that survive reloads, PWA offline install, zip export.
- **Sharing**: publish files or folders to `/share/<slug>` with roles, expiry,
  password, alias, raw/rendered modes; uniform deny-by-default policy gate.
- **Sync**: real push/pull against the backend's bare git repos over
  smart-HTTP; safe auto-merge with backup refs; in-editor conflict resolver;
  commit message templates.
- **CI**: full test suite (vitest + Playwright + pytest) green on GitHub
  Actions with retries disabled; GitHub Pages client-only demo.

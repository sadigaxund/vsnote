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
- **The mounted vault is now the default deployment shape.**
  `docker compose up` mounts a real, non-bare, plaintext vault working tree
  at `/data/vault` (the new `vsnote-vault` volume) and treats it as the
  authoritative copy. A fresh mount is empty and is never auto-initialized:
  sign in and let Settings → Git & Sync's setup wizard create the repository
  once. **An existing deployment that already synced into the legacy bare
  repo under `VSNOTE_GIT_ROOT` must act before upgrading**: either set
  `VSNOTE_VAULT_PATH=` (explicitly empty) in `.env` to keep the old shape
  exactly as it was, or bind the new mount to a directory that already holds
  a clone of that history. Pointing it at an empty volume does not migrate
  anything, and clients pushing to an uninitialized mount are refused with a
  409 until the wizard runs.
- **The app shell is gated behind a login screen** as soon as a credential
  path exists (a local account, or `CF_ACCESS_*` configured). A deployment
  with neither is not gated, since nothing could satisfy the prompt. Set
  `VSNOTE_REQUIRE_LOGIN=False` to keep the shell open deliberately. An
  unreachable backend never gates: an installed or already-loaded app keeps
  editing its local clone offline.

### Changed
- **Rendered markdown mode runs on `@atomic-editor/editor`** (MIT), replacing the
  hand-rolled live-preview decoration plugin. The Obsidian behavior is unchanged —
  one raw-markdown document, rendered by default, raw syntax only around the caret —
  and the swap fixes real caret bugs (vertical arrow motion across fenced code blocks
  jumped several lines in one keypress). Two visible deltas: Rendered mode's Ctrl/⌘F
  panel is now atomic-editor's minimal find bar (Source/Diff keep the React find
  widget), and the Rendered margin slider applies as horizontal padding. Settings
  sliders, read-only lock, internal-link opening, task checkboxes, and per-pane ⌘F
  all behave as before.

### Added
- **Server-mounted authoritative vault.** `VSNOTE_VAULT_PATH` /
  `VSNOTE_VAULT_REPO_NAME`, a single vault identity every server module
  resolves through, and working-tree semantics that make the mount
  trustworthy: edits made directly on disk are committed before any git
  request is served, and the working tree is updated from the new tip after
  a push is accepted. An existing `.git` is always respected; nothing
  auto-creates or overwrites it. `GET /api/vault`, `POST /api/vault/init`.
- **Mirroring to external remotes**, with credentials that never leave the
  server. Add a GitHub/GitLab/Gitea/any remote with an SSH key or an HTTPS
  token, test it, mirror on demand or automatically after each client push.
  Keys and tokens live under `VSNOTE_SECRETS_PATH` (0700 dir, 0600 files),
  are never returned by any API response and never logged. Mirroring never
  force-pushes.
- **Setup wizard in Settings → Git & Sync**: initialize the vault
  repository and connect a remote entirely in the UI, with no CLI step.
- **Auto-sync policies**: manual, every N minutes, on open and close, or
  debounced on save. Each run uses the existing sync pipeline unchanged,
  including its backup refs and conflict resolver, and never force-pushes.
- **Explorer tree virtualization** for real-vault scale, with the small-tree
  rendering path left exactly as it was.

### Fixed
- A truly offline reload could fail to load the app: the service-worker
  precache exclusion matched chunks by name only, so an unrelated vendor
  chunk sharing an icon's name was silently dropped from the precache.
- A push into a mounted vault could report success before the server's
  working tree had been updated from it.

## [2026.08.17.1] — the VSNote rebrand

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

- **The demo vault is now opt-in.** A first boot seeds a minimal vault
  holding one `welcome.md`, instead of the showcase content. The full demo
  vault loads either from a build that sets `VSNOTE_DEMO_VAULT=1` (the
  public GitHub Pages demo does, so it is unchanged) or from the new "Load
  demo vault" command, which warns before replacing your vault. "Reset
  vault" resets to whichever of the two the build uses.

### Added
- **Three-dot overflow menu** in the title bar, and in each pane's header
  when more than one pane is open. Format (bold, italic, strikethrough,
  inline code, link) and Insert (table, code block, horizontal rule) act on
  the focused editor's selection and are enabled for editable markdown only.
- **Export as PDF** renders the file into a print-clean layout (no app
  chrome, light background, syntax-highlighted code, real page breaks) and
  opens the browser's print dialog. No server, no new dependencies.
- **Import from the OS**: drag files, and folders where the browser exposes
  them, from the desktop onto the file tree to copy them in at the drop
  location; or paste files and images into the selected folder with Ctrl+V.
  Name clashes prompt to rename or replace. A pasted screenshot gets a
  timestamped filename. Firefox delivers images only on paste, which is a
  browser limitation.
- **Git configuration in Settings → Git & Sync**: the resolved remote URL
  and branch are shown, the repository name is configurable, and the vault's
  display name can be renamed. An advanced, off-by-default option points
  sync at an external remote such as GitHub or Gitea with its own
  credential. Sync semantics are identical on any remote: fast-forward,
  auto-merge with backup refs, never a force push. "Test connection" now
  reports reachability, authentication, and repository existence separately.
- **Admin settings**: `GET`/`PUT /api/admin/settings` plus a Settings →
  Sharing control let an admin change the maximum share blob size (1 to
  100 MB) at runtime. `VSNOTE_MAX_BLOB_BYTES` seeds the value on first boot
  and is ignored once an admin has set one. Changes are audit-logged. Admin
  routes require an interactive session: API tokens are refused, because
  token scopes have no admin tier.
- CHANGELOG (this file).

### Fixed
- CI's "Typecheck" step ran `npx tsc --noEmit` against the root
  `tsconfig.json`, which is a solution file (`"files": []`) and therefore
  type-checked nothing and always passed. It now runs `npm run typecheck`
  (`tsc -b`), which really checks `src/` and `vite.config.ts`.

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

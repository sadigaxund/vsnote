# Implementation plan — v2 (sharing, auth, backend, real sync)

Started 2026-08-15 on user instruction. Requirements source:
`docs/ROADMAP-SHARING-AUTH.md` (the contract — especially its security posture,
which is non-negotiable) plus DESIGN-SPEC Amendments round 3.
Same working rules as v1 (CLAUDE.md); same verification protocol
(IMPLEMENTATION-PLAN.md bottom). Each phase ends gates-green + committed.

CLAUDE.md rule 3 ("no server in v1") is hereby superseded for v2 phases: the
backend is now in scope. The v1 app must remain fully functional WITHOUT the
backend running (progressive enhancement: share/sync UI degrades to
"server offline" states).

## Phase 8 — Feedback round 3 (client-only, before any backend work)
DESIGN-SPEC Amendments round 3, items 17–24: total zen (title bar too, single-Esc
via fullscreenchange), header consolidation (inner editor header absorbed into the
title bar; slim per-pane headers only when >1 pane), sidebar collapse-to-zero +
activity-bar expand, kitchen-sink markdown + simple HTML demo files (git-state
invariants preserved), theme compatibility fix (metallic/glass/comic ×
TexturedSurface — scope app token overrides to its own theme), per-theme CM6
syntax palettes via CSS variables, real density scaling, find widget 30–40%
smaller. Update affected Phase 7 specs in the same phase — `npm test` must end
green with the NEW behavior codified.
Exit: every item demonstrable; suite green; visual pass.

## Phase 9 — Backend foundation (FastAPI)
- `server/` at repo root: FastAPI + uvicorn, SQLite via SQLAlchemy, Alembic-free
  (create_all) for now. `pyproject.toml` + uv/pip requirements; `npm run server`
  convenience script. Python 3.11+.
- Share model per roadmap §1: slug (≥128-bit base62 random, validated
  `^[A-Za-z0-9_-]{8,64}$`), optional custom alias, snapshot blob
  (content-addressed, client-POSTed at publish), render mode (raw|rendered),
  policy (general access, expiry, password argon2id, revoked), roles
  (viewer/editor), audit columns (created, last access, hits).
- Auth per roadmap §2: Cf-Access JWT verification middleware (issuer/audience/
  signature, config-driven), fallback username+password login (argon2id) issuing
  HttpOnly session cookies, scoped API bearer tokens (hashed at rest, revocable).
  `/share/*` outside the SSO gate; per-share auth: none/password/token
  (magic-link deferred — needs email infra; leave a documented stub).
- ONE deny-by-default policy gate for all `/share/*` requests; indistinguishable
  404s for missing/revoked/expired/unauthorized; rate limiting (slowapi or
  equivalent); raw mode served `text/plain; charset=utf-8` + nosniff, NEVER html;
  CORS locked to the app origin for the API, none for raw.
- pytest suite: policy gate matrix (every deny path), slug validation, auth flows,
  no-oracle equivalence checks, token hashing. Security checklist from roadmap §1
  walked item-by-item in the phase report.
- Exit: uvicorn serves; pytest green; curl demos: publish→fetch raw, password
  share (401→200), revoke→404, expired→404.

## Phase 10 — Client sharing UI + integration
- Publish flow: context menu + palette + title-bar share action → publish dialog
  (Google/Microsoft-style per roadmap: general access, roles, expiry, password,
  custom alias, raw|rendered mode, copy link). Uses the Phase 9 API.
- "Shared" management panel (activity bar or settings section): list, hit counts,
  revoke, regenerate, edit policy.
- Rendered share page: the app's read-only fullscreen rendered view served for
  `/share/<slug>` (rendered mode) — no shell chrome, no vault access; raw mode
  untouched by the SPA.
- Server-offline degradation: share affordances visible but disabled with a clear
  "backend not running" hint (settings shows how to start it).
- Editor-role write-back: PUT creates a git commit in the vault via the client
  when the owner next syncs (document the flow; full live write-back can wait for
  sync). E2E-encrypted shares remain QUEUED — do not build.
- Exit: e2e spec (server spawned in test fixture): publish→open in second browser
  context→revoke→404; UI states verified.

## Phase 10.5 — Single-origin refactor + folder ("group") shares  [added 2026-08-15 evening, roadmap §5.1 + §5.4]
- FIRST, the single-origin refactor per roadmap §5.4: FastAPI serves the built
  SPA (static mount + SPA fallback) so front+back are one origin; client share
  API goes relative to `window.location.origin` (drop the `baseUrl` parameter
  chain and the Settings "Sharing base URL" field); remove `SLATE_CORS_ORIGINS`
  and CORSMiddleware entirely — tests flip to asserting NO CORS headers on any
  route; uvicorn proxy-header handling + Secure/SameSite cookie rules for the
  Cloudflare-tunnel topology; vite dev/preview proxies `/api`, `/share`,
  (later `/git`) to the backend dev port (8787 locally; 8000 is taken by an
  unrelated process). Verify: `uvicorn` alone serves the working app at
  one origin; publish→fetch works with zero CORS headers in every response.
- Server: share records gain a kind (file|folder); folder shares store a snapshot
  manifest (relative path → content-addressed blob). `/share/<slug>/<relpath>`
  resolves ONLY within the manifest; unknown relpath → the same indistinguishable
  404 as a missing slug, through the same single policy gate. ONE policy per
  share for the whole subtree — no per-file auth overrides (user decision).
- Publish dialog on a folder: checkbox tree of the subtree with per-entry
  exclusion; excluded entries are absent from the manifest. Same policy controls
  as file shares (access, expiry, password, alias, revoke); "Update share"
  republishes the subtree to the same slug.
- Visitor reader page (user decision: slim): read-only tree left + content right,
  no shell chrome, no README special-casing — folder URLs show a plain listing.
  Raw mode per file unchanged (`text/plain` + nosniff).
- Owner UI: explorer tree share indicator (link glyph like git letters; muted
  inherited variant inside shared folders; tooltip link+policy+hits; context
  menu copy/manage) and folder shares listed in the Shared registry view.
- pytest: manifest path resolution matrix (in-manifest, excluded, traversal
  attempts `..`/absolute/encoded, unknown) all deny paths byte-identical to the
  Phase 9 fingerprint. E2e: publish folder → browse tree in second context →
  excluded file 404s → revoke → subtree 404s.
- Exit: gates green; oracle equivalence holds with the new routes included.

## Phase 11 — Real remote sync  [merge policy amended 2026-08-15 evening, roadmap §5.2–5.3]
- Server hosts bare git repos (pygit2 or dulwich) exposed over smart-HTTP,
  authenticated with the Phase 9 API tokens; client uses isomorphic-git
  push/pull/fetch against it (roadmap §3 option b).
- Settings Git & Sync section goes live: NO remote-URL field (roadmap §5.4 —
  the sync remote is implicitly `<origin>/git/vault.git`, auth via the
  same-origin session; API tokens remain for scripts/external git clients);
  "Test connection" health check, device name + default commit message template
  per roadmap §5.3 (`{device}` `{timestamp}` `{date}` `{time}` `{files}`
  `{branch}`; prefills commit box; used by Sync auto-commits and merge commits).
- Sync pipeline per roadmap §5.2: fetch → fast-forward when purely behind →
  push when purely ahead → on divergence auto-merge (backup ref
  `refs/backup/pre-sync-<ts>` first, keep 5; three-way with diff3; clean ⇒
  merge commit ⇒ push). True conflicts open the @codemirror/merge-based
  resolver (take mine / take theirs / keep both, per-chunk accept); nothing
  pushed or discarded until resolved. NEVER force-push; server rejects
  non-fast-forward as backstop. Periodic fetch (~60s) drives real ahead/behind;
  the simulated drift in `src/git/remote.ts` is deleted.
- "Real sync isn't wired up yet" placeholder removed everywhere.
- Exit: e2e: edit→commit→push; clone the bare repo with system git and see the
  commit; pull side works; token-less push rejected; divergence with disjoint
  file edits auto-merges and pushes; same-line conflict opens the resolver and
  resolving pushes a merge commit; backup ref exists afterwards.

## Phase 12 — Feedback round 4 (2026-08-16, DESIGN-SPEC Amendments items 25–33)
Full spec in DESIGN-SPEC round 4. Mixed client+server phase:
- Server: git-http `WWW-Authenticate` gated to `git/` user-agents (26a);
  bootstrap user env vars + `create_user.py` CLI (32); pytest for both
  (browser-shaped request gets 401 WITHOUT the challenge header; bootstrap
  creates iff users table empty, never overwrites, never logs the secret).
- Client: width slider "Full" cap removal (25); suspend /git polling while
  unauthenticated (26b); Test Connection button fit (27); UI copy sweep — one
  row, no em dashes, ALL existing hints (28); static "VSNote" title (29);
  empty-name inline create, empty = cancel, truly inline sizing (30); Publish
  Sign In button no-wrap (31).
- Renderers: stress fixtures + row cap/virtualization for CSV, lazy JSON tree
  (33) with committed perf-guard tests.
- Update any Phase 7/10 specs the new behavior breaks in the same phase;
  `npm test` + pytest end green with the NEW behavior codified.
Exit: every item demonstrable; suites green; visual pass on 25/27/29/30/31.

## Phase 13 — CI + GitHub Pages demo (2026-08-16, after Phase 12)
Remote is github.com/sadigaxund/vsnote (SSH, signed commits — repo git config
already set; never force-push).
- `ci.yml` GitHub Actions workflow, on push/PR to main: install, lint,
  `tsc --noEmit`, build, vitest, playwright (install browsers; bound e2e
  workers to runner cores — the suite is contention-sensitive), server pytest
  (venv from `server/requirements.txt`). Deterministic exit codes; at most one
  retry and only if flakes are individually justified in the workflow comments.
- Pages deploy job (after CI green, main only): build the SPA with a
  configurable base path (env → vite `base`, default `/` unchanged; Pages build
  uses `/vsnote/`) — asset URLs, PWA manifest/icons, and service-worker scope
  must all respect the base. `actions/upload-pages-artifact` +
  `actions/deploy-pages`.
- The Pages demo is CLIENT-ONLY by design: share/sync surfaces show their
  normal server-offline states (round 4 copy rules apply — must read as
  intentional, not broken). No backend is deployed anywhere by CI.
- Owner action (one-time, documented in README): repo Settings → Pages →
  Source = "GitHub Actions".
- Exit: CI green on GitHub on a real push; demo at
  `https://sadigaxund.github.io/vsnote/` boots, edits, shows live preview and
  git state, installs as PWA, zero broken asset/SW paths under the subpath.

## Phase 14 — Containerization (2026-08-16, after Phase 13)
Single-origin (roadmap §5.4) means ONE image: multi-stage Dockerfile — node
stage runs `npm ci && npm run build`, final python-slim stage installs
`server/requirements.txt`, copies `server/` + built `dist/`, runs uvicorn with
`--proxy-headers` as a NON-ROOT user. No dev deps, no node, in the final image.
- `docker-compose.yml` at repo root, service `vsnote`:
  - Port: host-configurable via env (default 8787).
  - Named volumes for ALL persistent state: the SQLite DB and `VSNOTE_GIT_ROOT`
    (bare sync repos). Nothing persistent may live outside a volume — verify by
    `compose down && up` (data survives) vs `down -v` (documented as the
    factory reset).
  - Every `VSNOTE_*` setting passes through as compose env with sane defaults;
    ship `.env.example` for compose (bootstrap user/password, cookie-secure,
    Cf-Access issuer/audience, port). Secrets only via env/.env, never baked
    into the image.
  - Container healthcheck hitting the health endpoint.
  - Optional commented-out `cloudflared` sidecar service showing the intended
    tunnel topology (user runs one already; example only, not enabled).
- CI (extends Phase 13's workflow): a job that builds the image so a broken
  Dockerfile fails CI. No registry publishing unless the user asks.
- CI finalization (user request 2026-08-17):
  - `workflow_dispatch` manual trigger on the CI workflow.
  - CalVer ("datever") releases: a release job, manually triggered
    (`workflow_dispatch`) or on `v*`/date tag push, that tags `YYYY.MM.DD`
    (same-day reruns suffix `.N`), creates a GitHub release with generated
    notes seeded from CHANGELOG.md's Unreleased section, and attaches the
    Docker deployment files as assets: `Dockerfile`, `docker-compose.yml`,
    `.env.example`. Release job runs only after the test + image-build jobs
    are green. Image publishing to a registry stays owner-driven (single
    image, dockerhub-ready) — CI does not push images.
- Repo hygiene (same date, done by the coordinator): CHANGELOG.md added
  (CalVer, intro summary, Unreleased section that release notes draw from);
  `app-preview.png` + `search.png` removed from the tree (git history keeps
  them; CLAUDE.md + DESIGN-SPEC updated — DESIGN-SPEC is now the sole visual
  authority).
- Docs: server/README.md gains a Docker section; root README (housekeeping)
  shows `docker compose up` as the quickest full-stack start.
- Exit: from a clean checkout, `docker compose up` alone serves the full app on
  the configured port; bootstrap user from env works; publish + sync verified
  against the container; state survives down/up; image build job green in CI.

## Phase 15 — Feedback round 5 (2026-08-17, DESIGN-SPEC Amendments items 34–39)
Full spec in DESIGN-SPEC round 5. Mixed client+server+ops phase:
- Rebrand sweep (34): env vars, db filename, package/pyproject names, realm,
  cookies, compose, .env.example, CI, docs. Breaking env rename noted in
  CHANGELOG Unreleased. Grep-verify zero operator-visible "slate" remains
  (case-insensitive) outside git history and deliberately-kept internal ids.
- Compose hygiene (35): drop the cloudflared block; one-line proxy note in
  server/README.md.
- Demo opt-in (36): minimal welcome vault default; demo via build flag (Pages
  workflow sets it) + "Load demo vault" palette command with replace warning;
  e2e fixtures updated (suite seeds demo explicitly, not implicitly).
- Editor context menu (37), three-dot menu + PDF export (38), OS-file
  drag-drop + clipboard paste into tree (39) — components from my-you-eye or
  local/ per CLAUDE.md rules 1–2; backlog rows for anything new.
- Exit: gates + suites green (unit/e2e/pytest); docker compose up boots clean
  vault, bootstrap login works under VSNOTE_* names; Pages demo still shows
  demo content; PDF export produces a real multi-page PDF from a long note;
  drop and paste verified in Chromium, image-paste in Firefox.

## Phase 16 — Round 6 refinement pass (2026-08-17, confirmed by user)
**Status: COMPLETED 2026-08-17** — all 23 items, in four commits (fcf30c8
batch 1: items 1/14/15/16/20/21/22; a7187d0 batch 2: items 2-9; fd8e53a
batch 3: items 17/18/19; dff25cf batch 4: items 10-13/23). Suite at close:
238 vitest / 97 playwright / 167 pytest, retries 0. Notable scope grown in
flight: clear_expiry + source_path PATCH sentinels, POST
/api/git-repos/{name}/reset, PUT /share/{id}/{relpath} + vaultcommit.py
(editor write-back as real bare-repo commits), and a dev-proxy fix (only
GET/HEAD are navigations). Item 13's root cause: the old reader forced a
white canvas under dark-theme selection colors, so selections painted
invisibly.

Executed DIRECTLY by the coordinating session (user lifted the "docs only" rule
for this pass — judgment-density polish work); suites + CI as safety net; same
commit/push discipline. Items (user-confirmed list):

Sharing/publish: (1) Settings→Sharing sign-in button double-row fix; (2)
publish-modal bootstrap hint to one row; (3) publish-modal dropdown icon+text
one row + general layout cleanup; (4) expose per-share TOKEN auth in the
publish modal (server already implements it); (5) expiry explicit — "Never
expires" default state, date opt-in; (6) remove Commenter remnants from UI;
(7) revoke/copy/manage from tree context menu + chain-icon click; (8) share
indicator follows file on move/rename (update the share's recorded path); (9)
muted share marker on ancestor folders of shared items; (10) share reader page
rebuilt REUSING the main shell components (read-only tree/tabs/header, admin +
vault access stripped) replacing the divergent slim page; (11) viewer role:
selectable text + read-only source-view toggle; (12) editor role: real live
editing via the same markdown editor (write-back lands as vault commits); (13)
investigate/fix the reported "Viewer mode selection" breakage.

Tree/editor: (14) git status letters vertical centering; (15) clean tree —
git decorations move to the Source Control panel, new setting "Show git status
in explorer" default OFF (share chain indicator stays in the tree); (16)
Format/Insert/Export move into the EDITOR AREA's existing overflow menu; the
title-bar three-dot added in Phase 15 is removed.

Chrome/settings: (17) contrast-safe accent — auto-derive foreground/lightness
so dark accents stay legible; never limit the picker range; (18) selection
policy done right — chrome unselectable, ALL content selectable (editor,
rendered views, share pages, toast/error text); Ctrl+A scoped to the focused
editor; (19) sync-failure UX — quiet status-bar state instead of repeating
toasts + an explicit destructive "Replace remote with local" action for the
unrelated-history case; (20) Settings view full width (remove the 760px cap;
Sharing table fits); (21) "Reset demo vault" exists ONLY in demo builds;
Export stays; buttons natural width; (22) rename to "Share Size Limit"; (23)
full copy/polish sweep over UI text + fine layout (one-row hints, no em
dashes, consistent tone).

User decisions recorded: NO ⌘K badge (magnifier already present — final);
textured-theme opacity work stays DEFERRED (known library bug). Batch-level
import-conflict dialog stays. E2E-encrypted shares + collab remain unbuilt.

## Phase 17 — Server-mounted vault + git redesign (2026-08-17, confirmed)
Orchestrated (fresh Opus orchestrator per the cost rule), after Phase 16.
Architecture: the server-side repo becomes the AUTHORITATIVE vault, mounted at
deployment (docker volume/host path). Existing `.git` is respected — never
auto-created or overwritten. Browser keeps a full local clone in IndexedDB
(offline editing intact); git sync reconciles. No in-app vault switching.
- Git & Sync renders as a SETUP WIZARD when no repo exists: init repo →
  remote config (URL, SSH key paste/path, tokens) — all in UI, no CLI ever.
- SSH keys and external-remote credentials live SERVER-SIDE only (browsers
  cannot speak SSH): the server MIRRORS to external remotes (GitHub/GitLab/
  any, SSH or HTTPS); clients only ever talk smart-HTTP to our server.
- Auto-sync policies: manual / every N minutes / on open+close / on-save
  (debounced); each run = the existing Phase 11 pipeline (fetch → ff → push →
  clean auto-merge with backup refs → resolver only for true conflicts).
  Draft checkpointing already guarantees no typing loss on failure.
- App-wide LOGIN GATE: no session → login screen (CF Access still works in
  front). Required because every authenticated client syncs the whole vault.
- Tree virtualization (backlog `VirtualList`) — required at real-vault scale.
- Known flag: full clone per client includes history; fine at text scale,
  shallow-clone mitigation only if it ever hurts.

**Milestone A shipped (2026-08-17, server-only, `src/` untouched):** vault
identity + working-tree semantics. `VSNOTE_VAULT_PATH`/
`VSNOTE_VAULT_REPO_NAME` settings; `app/vault.py` (`vault_repo_path`,
`describe_vault`, `init_vault`, `commit_worktree_changes`,
`checkout_head_into_worktree`) as the single source of truth, replacing
`vaultcommit.py`'s old `_pick_repo_path` guesswork; `/git/<vault>.git`
routes through it (mounted-but-uninitialized is never auto-created — 404
reads, 409 writes); `GET`/`POST /api/vault[/init]`; reset (item 19) refuses
on a mounted vault. Full design in `docs/ARCHITECTURE.md`'s "Server-mounted
vault (Phase 17 Milestone A)" section.

**Milestone B shipped (2026-08-17, server-only, `src/` untouched):**
mirroring the vault to external remotes (GitHub/GitLab/Gitea/any), SSH or
HTTPS, credentials server-side only. New `VaultRemote` table (metadata
only — no secret column, ever); `app/secrets_store.py` (0700-dir/0600-file
on-disk storage for both SSH keys and HTTPS tokens, under the new
`VSNOTE_SECRETS_PATH` setting); `app/mirror.py` (system `git`/`ssh` via
`subprocess`, list argv only, URL-scheme allowlist rejecting `-`-prefixed
and `ext::`-style transports, never `--force`/`--mirror`/a `+`-refspec,
`MirrorRunner` for locking + background-thread-by-default triggering with
a `sync` seam for deterministic tests); `routers/vault_remotes.py`
(`/api/vault/remotes` CRUD + `/mirror` + `/test`, session-only, write-only
credential fields, audit events). Triggered automatically after a
successful push into the vault (`push_on_receive`, default on) and
explicitly via the API. Dockerfile/compose gained `git`+`openssh-client`
in the final stage and a `vsnote-secrets` volume. Full design in
`docs/ARCHITECTURE.md`'s "Mirroring to external remotes (Phase 17
Milestone B)" section; operator docs in `server/README.md`'s "Mirroring to
external remotes" section. Remaining Phase 17 scope (setup wizard, auto-sync
policies, the login gate, tree virtualization) is Milestone C+, unstarted.

## After Phases 16–17
- Redo all 18 my-you-eye backlog issues against the FINAL polished components
  (refined source, distilled prop APIs, "what the library needs to absorb
  this" checklists) + NEW per-component gap issues for existing library
  components that required workarounds (Dialog/Select/etc.). Same gh
  throttling + idempotency discipline as the first export.
- When extension/plugin or new-format work begins, FIRST read
  `docs/temp-plan-add-extension.md` (user's spec for a markdown-like format).

## Sequencing & ownership
8 → 9 → 10 → 10.5 → 11 → 12 → 13 → 14, strictly sequential, same
orchestrator/worker pattern as v1. Housekeeping (README/LICENSE) and the
backlog→issues export run after Phase 14.
Python work needs a venv under `server/.venv` (never global installs).
Deployment (Cloudflare, domains) stays out of scope — local uvicorn only, with a
`server/README.md` section sketching the intended CF Access production topology.

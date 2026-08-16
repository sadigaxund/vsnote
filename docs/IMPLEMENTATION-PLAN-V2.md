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

## Sequencing & ownership
8 → 9 → 10 → 10.5 → 11 → 12 → 13 → 14, strictly sequential, same
orchestrator/worker pattern as v1. Housekeeping (README/LICENSE) and the
backlog→issues export run after Phase 14.
Python work needs a venv under `server/.venv` (never global installs).
Deployment (Cloudflare, domains) stays out of scope — local uvicorn only, with a
`server/README.md` section sketching the intended CF Access production topology.

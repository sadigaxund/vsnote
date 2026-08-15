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
  (later `/git`) to :8000. Verify: `uvicorn` alone serves the working app at
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

## Sequencing & ownership
8 → 9 → 10 → 10.5 → 11, strictly sequential, same orchestrator/worker pattern
as v1.
Python work needs a venv under `server/.venv` (never global installs).
Deployment (Cloudflare, domains) stays out of scope — local uvicorn only, with a
`server/README.md` section sketching the intended CF Access production topology.

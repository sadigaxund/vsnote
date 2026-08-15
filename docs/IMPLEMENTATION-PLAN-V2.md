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

## Phase 11 — Real remote sync
- Server hosts bare git repos (pygit2 or dulwich) exposed over smart-HTTP,
  authenticated with the Phase 9 API tokens; client uses isomorphic-git
  push/pull/fetch against it (roadmap §3 option b).
- Settings Git & Sync section goes live: remote URL (default = local server),
  token field, "Test connection". Status-bar sync becomes real: real ahead/behind
  from refs, push/pull actions, conflicts surfaced honestly (fast-forward only in
  v2.0 — refuse + explain on divergence).
- "Real sync isn't wired up yet" placeholder removed everywhere.
- Exit: e2e: edit→commit→push; clone the bare repo with system git and see the
  commit; pull side works; token-less push rejected.

## Sequencing & ownership
8 → 9 → 10 → 11, strictly sequential, same orchestrator/worker pattern as v1.
Python work needs a venv under `server/.venv` (never global installs).
Deployment (Cloudflare, domains) stays out of scope — local uvicorn only, with a
`server/README.md` section sketching the intended CF Access production topology.

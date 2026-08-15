# Roadmap v2 — sharing, auth, backend (QUEUED — do not build yet)

Status: requirements captured 2026-08-15. Nothing here is part of phases 1–5.
v1 ships fully client-side. This doc exists so v2 starts from an agreed spec.

## 1. Publish/share a file

- Action on any file (context menu + palette + editor header): **Publish** →
  the file becomes reachable at `https://<base>/share/<slug>`, where `<slug>` is a
  server-generated unguessable id (≥128-bit random, base62; NOT a hash of content or
  path — hashes are enumerable/oracle-y) with an optional user-chosen custom alias.
- Two share render modes, chosen at publish time (changeable later):
  - **Raw**: served as `text/plain` (correct charset, `X-Content-Type-Options:
    nosniff`, never `text/html` — a raw share must never execute).
  - **Rendered**: the app's fullscreen (zen) rendered view, read-only, no shell chrome.
- Publish dialog = Google/Microsoft-style sharing model:
  - General access: `Restricted` (only listed principals) / `Anyone with the link` /
    (later) `Domain` via Cloudflare Access identity.
  - Per-principal roles: **Viewer** / **Commenter** (later) / **Editor** (write-back
    creates a normal git commit in the vault — full audit trail via git).
  - Link controls: expiry date, password, revoke (kills the slug immediately),
    regenerate link, "copy link" with mode picker. Owner sees a "Shared" panel
    listing all active shares (audit: created, last accessed, hit count).
- A share serves a **pinned snapshot** (content-addressed blob at publish time) by
  default, with an opt-in "live" toggle that tracks the working file. Default
  snapshot = no accidental leaking of later edits.

### Security posture (fortified — non-negotiable)
- Server never serves vault paths; it serves share records (slug → blob/commit ref +
  policy) from its own store. Path traversal is structurally impossible: no
  filesystem lookups keyed by user input, ids validated against `^[A-Za-z0-9_-]{8,64}$`.
- Every request to `/share/*` passes one policy gate (deny-by-default) that evaluates:
  slug exists → not revoked → not expired → auth requirement satisfied → role allows
  method (GET=read, PUT/PATCH=editor only). No side doors: no debug endpoints, no
  "admin" query params, no wildcard CORS (locked to the app origin; raw mode needs none).
- Rate limiting + constant-time slug lookup (no existence oracle: 404 for
  missing/revoked/expired/unauthorized-without-identity look identical).
- Rendered mode sandbox: shared HTML renders only inside a sandboxed iframe with a
  strict CSP; shared markdown is rendered by our pipeline with raw-HTML disabled.
- Secrets/tokens never in URLs except the capability slug itself; everything else in
  headers/cookies (`HttpOnly`, `Secure`, `SameSite`).
- Audit log of auth failures and every policy denial.

## 2. Authentication

- Main app (`/`): stays behind Cloudflare Access (Gmail SSO) as today — the backend
  additionally **verifies the `Cf-Access-Jwt-Assertion` JWT** (issuer + audience +
  signature) instead of trusting the network path. Optional app-level fallback login
  (username + password, argon2id) for non-Cloudflare deployments, plus **API tokens**
  (`Authorization: Bearer <token>`, scoped: read-only / read-write / share-admin,
  revocable, hashed at rest) for programmatic access.
- `/share/*` subdomain/path: EXCLUDED from Cloudflare Access. Per-publish auth chosen
  at publish time, mixable:
  - none (capability = the unguessable link)
  - password (per-share, argon2id, brute-force throttled)
  - email allow-list via one-time magic link
  - bearer token (for scripts/curl)
  - (later) Cloudflare Access service tokens for machine-to-machine.
- Sessions: short-lived signed session cookie after any successful share auth,
  scoped to that slug only (`Path=/share/<slug>`).

## 3. Backend stack

Python + FastAPI — approved (owner's expertise wins; no strong reason against).
Notes from evaluation:
- FastAPI + uvicorn fits: small JSON/policy API + static/raw serving, JWT verify
  (`pyjwt`/`joserfc`), argon2 (`argon2-cffi`), SQLite (or Postgres later) via
  SQLAlchemy for share records/tokens/audit.
- The one genuine friction: v1's git runs in-browser (isomorphic-git/IndexedDB), so
  the server cannot read the vault directly. v2 options, in preference order:
  (a) publish = client POSTs the blob/snapshot to the server (server stays
  vault-agnostic — simplest and safest, matches snapshot-by-default), or
  (b) later "real sync": server hosts a bare git remote (`pygit2`/`dulwich`) that the
  client pushes to via isomorphic-git HTTP — enables live shares + multi-device sync.
  Start with (a).

## 4. Feature ideas backlog (candidates, unscheduled)

Leverage-what-we-have first:
- **Wikilinks + backlinks panel** (`[[note]]`, unlinked mentions) and a **graph view**
  of note links — the component library already ships Canvas/Graph/GraphNode.
- **Version history / time travel**: file history from git log, diff any two versions,
  restore — the plumbing (isomorphic-git) is already there.
- **Real remote sync**: push/pull to a real GitHub/Gitea remote with a PAT (CORS proxy
  or v2 backend remote) — turns the simulated ↑3 ↓1 into reality.
- **Outline panel** (headings tree, click-to-jump) and **document properties** panel
  (frontmatter as a form).
- Obsidian-style extras in the live preview: **callouts** (`> [!note]`), **KaTeX
  math**, **Mermaid diagrams**, footnotes, task lists with a global **Tasks view**
  aggregating `- [ ]` across the vault.
- **Tags** (`#tag` index + filter), **daily notes** (calendar picker + template),
  **templates** for new files, **saved searches**.
- **Quick capture** scratchpad + web-clipper-ish "paste URL → markdown".
- **Split view** (two panes side by side, e.g. source | rendered, or two files).
- **Export**: single file → styled HTML/PDF; vault → static site (pairs naturally
  with the share feature).
- **Editor niceties**: vim mode (CM6 has it), multi-cursor, spell check, word count
  in status bar, typewriter/focus mode (pairs with zen mode), paste-image-into-md
  (stores into `assets/`).
- **PWA**: installable, offline-first (everything is local already), mobile layout.
- **Command-K everything**: recent files, symbol jump in code files (CM6 syntax tree).
- (v2, big) **Collaboration**: CRDT (Yjs) on shared files with Editor role.
- (v2) **End-to-end encrypted shares**: key in URL fragment, server stores ciphertext.

# Roadmap v2 — sharing, auth, backend

Status: requirements captured 2026-08-15; v2 approved and IN SCOPE the same day
(see `docs/IMPLEMENTATION-PLAN-V2.md`). §5 records the second round of user
decisions (folder shares, sync merge policy, commit templates) — it amends and
overrides earlier sections where they touch the same topic.

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

## 4. Feature backlog — user decisions 2026-08-15

### Approved
- **PWA / offline install** (v1, fold into Phase 5): web manifest + service worker
  (e.g. vite-plugin-pwa) so the app installs as its own windowed app and the shell
  loads offline. Vault data is already local (IndexedDB); this makes the app itself
  offline too. No backend needed.
- **Real remote sync** (v2, with the backend): push/pull to a real remote. Start with
  the v2 backend hosting a bare git repo (`pygit2`/`dulwich`) the client talks to via
  isomorphic-git HTTP; optionally GitHub/Gitea + PAT later. Turns the simulated
  ↑3 ↓1 into reality.
- **Grid split view** — now specced in DESIGN-SPEC Amendments item 8 and scheduled
  as Phase 6 in IMPLEMENTATION-PLAN. Termux/tmux-grade grid arranging, mouse-first.

### Rejected (user: skip the Obsidian extras)
Callouts, KaTeX, Mermaid, footnotes, global Tasks view, tags index, daily notes,
templates, saved searches, quick capture / web clipper. Do not build.

### Still candidates (unscheduled — confirm with user before building)
- Wikilinks + backlinks + graph view (library ships Canvas/Graph/GraphNode).
- Version history / time travel from git log (plumbing already present).
- Outline panel; frontmatter properties panel.
- Export: file → styled HTML/PDF; vault → static site (pairs with sharing).
- Editor niceties: vim mode, multi-cursor, spell check, word count,
  paste-image-into-md.
- PWA install + offline; mobile layout.
- Command-K extras: recent files, symbol jump.
- (v2, big) Collaboration: CRDT (Yjs) on shared files with Editor role.
- (v2) End-to-end encrypted shares: key in URL fragment, server stores ciphertext
  only — content confidentiality survives a full server compromise.
  **Scope decided 2026-08-15:** E2E applies ONLY to individual share snapshots,
  opt-in per publish. The vault and its remote git stay PLAINTEXT always — a plain
  `git clone` of the sync remote must remain fully readable without the app.
  Never introduce vault-at-rest encryption (git-crypt/age or similar); it breaks
  the "files are accessible without the app" guarantee the owner requires.

## 5. Amendments 2026-08-15 (evening) — user decisions round 2

### 5.1 Folder ("group") shares — approved
- Publishing a **folder** creates ONE share with ONE opaque slug:
  `/share/<slug>/` is the subtree root, and files resolve at their vault-relative
  paths beneath it (`/share/<slug>/notes/queue.md`). NEVER expose real vault
  paths at the URL root (no `share/group/<real-path>` scheme — leaks vault
  structure, guessable). Custom alias remains available, same rules as files.
- **One policy per share, covering the whole subtree** (user decision): password /
  expiry / role / revoke apply uniformly; there are NO per-file auth overrides
  inside a folder share. A file needing different auth gets its own separate
  share. This keeps the single deny-by-default gate from §1 intact — the gate
  evaluates the slug's policy once, then resolves the relative path *within that
  share's snapshot manifest only*. Paths not in the manifest → the same
  indistinguishable 404 as a missing slug.
- **Name exposure**: file/dir names inside the shared subtree are visible by
  design (they are the navigation). The control is at publish time: the publish
  dialog shows the subtree as a checkbox tree and the owner **excludes** entries;
  excluded entries are absent from the snapshot manifest (not hidden — absent).
  Nothing outside the subtree is ever reachable.
- **Visitor UI** (user decision: "slim, tree + content, no README logic"): a
  read-only reader page — slim file tree left, rendered/raw content right, no
  shell chrome. Folder URLs show a plain file listing; `README.md` gets NO
  special landing treatment. Raw mode per file follows §1 rules unchanged
  (`text/plain` + nosniff).
- **Snapshot semantics** identical to single-file shares: publish pins a
  content-addressed snapshot of the subtree (blob per file + one manifest);
  "Update share" republishes to the same slug.
- Owner-side affordances: shares (file and folder) get a **tree indicator** in
  the explorer (link glyph, right-aligned like git letters; muted inherited
  variant on files inside a shared folder; tooltip = link + policy + hits;
  context menu: copy link / manage) and appear in the **Shared registry view**
  (activity bar; also linked from Settings).

### 5.2 Real-sync merge policy — approved (replaces "refuse + explain" as v2.0 final)
User verdict: refuse-only "makes the app useless". Requirements: never lose
changes, never add friction. Policy, in order:
- **Sync pipeline** (one button): fetch → purely behind ⇒ fast-forward → purely
  ahead ⇒ push → diverged ⇒ auto-merge (below). Periodic background fetch
  (~60s while the backend is reachable) keeps real ahead/behind counters —
  replaces the v1 simulated drift.
- **Backup ref before any merge/pull mutation**: tag local HEAD as
  `refs/backup/pre-sync-<timestamp>` (keep last 5). Recovery is structural,
  not hopeful.
- **Auto-merge**: three-way from the merge base; remote-only-changed files take
  remote, local-only keep local, both-changed get content-level diff3
  (isomorphic-git `merge`). Clean result ⇒ merge commit (template, §5.3) ⇒ push.
- **True conflicts** (same lines changed both sides) open an in-app resolver
  built on the existing `@codemirror/merge` stack: per-file "take mine / take
  theirs / keep both" + per-chunk accept. Nothing is pushed or discarded until
  resolved.
- **Never force-push**; the server's bare repo rejects non-fast-forward pushes
  as the backstop. Whole-branch, single-branch sync (user accepts: no per-file
  sync granularity; access = repo-level via write-scoped API token).

### 5.3 Commit message template — approved
Settings → Git & Sync: `Default commit message`, a template string, default
`Synced from {device}: {timestamp}`. Variables:
- `{device}` — a device-name **setting** (browsers cannot read the hostname),
  auto-defaulted from UA (e.g. `chrome-linux`), user-editable.
- `{timestamp}` — local `YYYY-MM-DD HH:mm`; also `{date}` and `{time}` parts.
- `{files}` — `"N files"`, or the single filename when one file changed.
- `{branch}` — current branch name.
Used to prefill the Source Control commit box (editable per-commit) and by
one-click Sync auto-commits and merge commits. Unknown `{vars}` pass through
literally (no errors).

### 5.4 Single-origin deployment — approved (supersedes settable server URL + CORS allowlist)
User decision: front + back ship as ONE origin. The FastAPI process serves the
built SPA (static mount + SPA fallback for client routes) alongside `/api`,
`/share/*`, and (Phase 11) `/git/*`. Reachability beyond localhost is the
owner's concern (Cloudflare tunnel) — the app's job is to work flawlessly
behind that proxy.
- **No settable server/base URL.** All client calls are relative to
  `window.location.origin`. The Settings "Sharing base URL" field and the
  `SLATE_CORS_ORIGINS` allowlist are REMOVED. Phase 11's sync remote is
  implicitly `<origin>/git/vault.git` — no remote-URL field; "Test connection"
  stays as a same-origin health check. (A single optional "share base URL"
  override may return later ONLY if the owner splits `/share` onto its own
  subdomain; do not build until asked. Same for external GitHub/Gitea remotes.)
- **CORS: none, anywhere.** Same-origin needs no CORS headers; the API emits
  none (drop CORSMiddleware), and `/share/*` stays exactly as CORS-less as §1
  requires. Tests assert the *absence* of CORS headers on every route.
- **Auth simplification**: the in-app client authenticates to `/api` and `/git`
  with the same-origin session (Cf-Access JWT / session cookie). Scoped API
  tokens remain for scripts/curl and non-browser git clients.
- **Proxy/tunnel correctness** (the "HTTPS + browser policy bullshit" the app
  must own): uvicorn runs with proxy headers enabled and honors
  `X-Forwarded-Proto`/`Host` (correct scheme/host in anything absolute);
  cookies `Secure` + `SameSite=Lax` (Secure relaxed only on plain-http
  localhost); zero hardcoded origins or ports in client or server; no mixed
  content; service worker + PWA function behind the HTTPS origin.
- **Dev**: `vite dev`/`preview` proxies `/api`, `/share`, `/git` to the
  backend's dev port (8787 on this machine — 8000 is occupied by an unrelated
  process; the port is a local detail, never hardcoded in client code) — same
  relative URLs work in every environment, no env-specific client config.
- **"Backend down" nuance** (amends CLAUDE.md rule 3's intent, not its spirit):
  since the backend is now also the web server, a cold uncached load needs it
  running. Local-first survives via the PWA: an installed/precached app opens
  and edits fully offline; share/sync affordances degrade gracefully. The SPA
  bundle must still never *require* the API to boot, render, or edit.

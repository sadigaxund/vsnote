# Architecture

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite + React 18 + TypeScript (strict) | SPA, no server |
| Styling | Tailwind CSS v4 + `my-you-eye/styles.css` | required by the library |
| UI kit | `my-you-eye` (npm ^0.4.0) | see CLAUDE.md rule 1 |
| State | zustand (small stores per domain) | fs, git, tabs, editor, settings |
| Editor | CodeMirror 6 | ONE stack: source, live preview, diff |
| Diff view | `@codemirror/merge` | unified + side-by-side vs HEAD |
| Languages | `@codemirror/lang-*` + `@lezer/*` | md, js/ts/tsx, json, css, html; plus legacy modes via `@codemirror/legacy-modes` where needed |
| Git | `isomorphic-git` | real repo in the browser |
| FS | `@isomorphic-git/lightning-fs` (IndexedDB) | persists across reloads |
| Icons | lucide-react (UI chrome) + `material-icon-theme` (file/folder identity, DESIGN-SPEC Amendments item 1) | file/folder icons resolved from the pack's manifest, lazy-loaded per icon |
| Md utilities | lezer markdown tree (already in CM6) | avoid a second parser if possible |

## Modules (`src/`)

- `fs/` — virtual FS service over lightning-fs: read/write/rename/delete, watch/emit
  change events, path utils. Seeding script builds the demo vault + git history on first
  run (idempotent; "Reset demo vault" command re-seeds).
- `git/` — thin service over isomorphic-git: status matrix → per-file letters, diff vs
  HEAD (line + hunk info for gutters/stats), commit, branch info, simulated remote
  (ahead/behind counters + fake push/pull with latency).
- `stores/` — zustand: `useFsStore` (tree snapshot), `useGitStore` (statuses, branch,
  sync state), `useTabsStore` (open tabs, active, dirty, preview flag, per-tab mode),
  `useSettingsStore` (persisted to localStorage).
- `filetypes/` — registry keyed by extension: icon, color, language extension for CM6,
  available modes + default mode, renderer component. Adding a file type = one entry.
- `editor/` — CM6 setup: base extensions (theme matched to design tokens), language
  loading, git gutter extension, diff (merge) mode, **livepreview/** (the
  Obsidian-style decoration plugin — hide-marks-except-at-cursor, widgets for links/
  code blocks/checkboxes). Adapt proven OSS (e.g. patterns from ixora /
  codemirror-rich-markdoc); keep license headers.
- `renderers/` — HtmlPreview (sandboxed iframe, `sandbox=""`), CsvTable (DataTable),
  JsonView, ImageView.
- `components/` — app-specific composition (Shell, ActivityBar, Sidebar panels,
  TabBar, EditorHeader, StatusBar, palette wiring). `components/local/` — primitives
  the library lacks (each one logged in `docs/COMPONENT-BACKLOG.md`).
- `share/` (Phase 10) — sharing client: `api.ts` (typed `fetch` client for the Phase 9
  backend), `useShareStore.ts` (reachability/auth/share-list state), `sharePolicy.ts` /
  `alias.ts` / `shareLinks.ts` (pure logic), `ShareApp.tsx` (the standalone
  `/share/<slug>` route — no vault access, see "Sharing (Phase 10)" below). Never
  imported by anything under `fs/`/`git/`/`stores/use{Fs,Buffer,Tabs,Git}Store.ts`, and
  itself never imports them — the two sides of the vault-access boundary that section
  documents.

## Key flows

- **Open file**: tree click → tabs store (preview tab; double-click/edit pins) →
  filetype registry picks default mode → editor/renderer mounts with fs content.
- **Edit**: CM6 doc changes → tab dirty; ⌘S writes to fs → git status recompute
  (debounced) → tree letters, badge, diff stats, gutters all react via stores.
- **Diff data**: single `git/diff.ts` API used by gutter, diff stats chip, and status
  bar so numbers always agree.
- **Theme**: dark theme is default at boot (`<html class="dark">`, tokens overridden in
  `src/theme.css` to match the screenshot palette). All custom components consume the
  same CSS variables as the library.

## Non-goals (v1)

Terminal, code execution, real network git, extensions marketplace (icon is a stub),
collaborative editing. Sharing/publishing, authentication, and the Python/FastAPI
backend are specced for v2 in `docs/ROADMAP-SHARING-AUTH.md` — out of scope for
phases 1–5. Phase 9 (2026-08-15) built the backend itself; see "Backend (v2)" below.
Phase 10 (2026-08-15, client sharing UI) is built — see "Sharing (Phase 10)" below.
Phase 11 (real git sync, including the roadmap §5.2 auto-merge/conflict-resolver
pipeline) is built — see "Real sync (Phase 11)" below; editor-role share write-back
stays a documented flow only (that section's write-back note), unaffected by Phase 11
landing.

Note: `docs/DESIGN-SPEC.md` has a 2026-08-15 "Amendments" section (Material Icon
Theme icons, no traffic lights, slimmer chrome, zen mode, browser-shortcut capture,
persistence of tabs/settings/unsaved buffers) that overrides the base spec.

## Backend (v2)

FastAPI + SQLite under `server/`, built in Phase 9 per `docs/ROADMAP-SHARING-AUTH.md`
(§1's security posture is binding) and `docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 9
section. Full run/config/API-contract documentation lives in `server/README.md` —
this section is the "how it's built" summary CLAUDE.md rule 4 asks for. The SPA
stays fully usable with this backend down (CLAUDE.md rule 3); nothing under `server/`
is a build/runtime dependency of `src/`.

**Modules** (`server/app/`):
- `config.py` — env-driven `Settings` (pydantic-settings), one `resolve_secret_key()`
  call per app instance (ephemeral + loud warning in dev, required in prod).
- `db.py` — `Base` + `make_engine`/`make_sessionmaker`. No module-level singleton
  engine: `main.py::create_app()` builds a fresh engine per app instance so each
  pytest test gets its own isolated SQLite file.
- `models.py` — SQLAlchemy ORM: `User`, `ApiToken`, `Blob` (content-addressed,
  id = sha256 hex), `Share`, `ShareGrant`, `AuditEvent`. `Base.metadata.create_all`,
  no Alembic yet (schema is still small enough that a migration tool would be
  premature machinery).
- `security.py` — argon2id hashing (`argon2-cffi` defaults), base62 slug
  generation/validation (`SLUG_RE`, `generate_slug` ≥128 bits), SHA-256 token
  hashing, HMAC-signed expiring cookie values, constant-time compares.
- `audit.py` — `write_audit_event`: every policy deny and auth failure writes one
  `AuditEvent` row. `reason` is internal-only by construction — the response-building
  code (`policy.denial_response`) never reads it.
- `policy.py` — **the single deny-by-default share policy gate**
  (`resolve_share()`), used by every `/share/*` route. See its module docstring for
  the full 6-step order and the uniform-deny rationale (below).
- `auth.py` — identity resolution for `/api/*`: Cf-Access JWT (verified against a
  cached JWKS, test-overridable via `JWKSFetcher.override`) → app session cookie →
  scoped bearer token, in that order. `AuthContext.scope is None` means "full
  session-derived rights"; a non-`None` scope is a token's declared ceiling.
- `routers/auth.py`, `routers/shares.py` (owner-side, behind app auth, CORS-enabled),
  `routers/share_public.py` (public `/share/*`, no CORS, plus one CORS-enabled
  `GET /api/share/{id}/content` route — see its docstring for why that one route
  lives under `/api`).

**App factory / two nested ASGI apps** (`main.py::create_app`): a root `FastAPI`
app serving `/share/*` and `/git/*` and, since Phase 10.5a, the built SPA itself
(static files + fallback — see "Single-origin deployment" below), plus a
`/api`-mounted sub-app. **Neither has `CORSMiddleware` anymore** (Phase 10.5a,
roadmap §5.4 — "CORS: none, anywhere"; this paragraph originally described the
`/api` sub-app as CORS-enabled and locked to `SLATE_CORS_ORIGINS`, both since
deleted — see "Single-origin deployment" for the full account and why). Both apps
share one `slowapi.Limiter` instance and one `JWKSFetcher`. Every
pytest test builds its own app via `create_app(settings)` against a `tmp_path`
SQLite file — see `server/tests/conftest.py`.

**The policy gate, in one paragraph:** `policy.resolve_share()` checks, strictly in
order: slug format (`SLUG_RE`) → exists (slug or alias) → not revoked → not expired
→ `general_access`/`auth_mode` requirement satisfied → role allows the HTTP method.
Every deny raises `PolicyDenied(reason)`; `denial_response()` is the ONLY place
that turns one into an HTTP response, and there is exactly ONE possible response —
`404 {"detail": "Not found"}`, always, for every deny reason on every method
(`/share/{id}`, `/api/share/{id}/content`, and `PUT`) — `reason` (audit-log-only)
never reaches a client. This INCLUDES a real, live, password-protected share with no
session: it 404s exactly like a nonexistent slug, a revoked one, or a
wrong-role attempt. See `policy.py`'s module docstring for the full account of why
(roadmap §1's literal "404 for missing/revoked/expired/unauthorized-without-identity
look identical" requirement forbids ANY distinguishable deny shape, not just the one
pair an earlier draft of this gate happened to equate) and
`server/README.md`'s dedicated "Every deny reason is the SAME 404" subsection for the
client-side contract this creates. Proven by
`tests/test_policy_gate.py::test_deny_state_equivalence_matrix_raw_route` /
`_content_route`, which fingerprint every deny state and assert they collapse to one
value — see this doc's Deviations entry below for the RED-then-GREEN evidence that
test can actually fail.

**Data model** — see `server/README.md`'s table and `models.py`'s field-level
comments; the two properties worth calling out here since they're easy to get wrong
by analogy with v1: `Blob.media_type_hint` is informational ONLY (raw-mode responses
use a hardcoded `RAW_CONTENT_TYPE` constant regardless of it), and `Share.source_path`
is display-only — there is **no filesystem lookup keyed by user input anywhere in
this server** (confirmed by inspection: `models.py`, `policy.py`, and both
`routers/share_public.py` handlers touch only `Blob.content`/`Share` DB columns, never
a path on disk).

**Auth model** — see `server/README.md`'s "Cloudflare Access production topology"
section for the intended CF Access deployment shape (not deployed this phase — local
`uvicorn` only). Magic-link auth is a documented, explicit 501 stub
(`routers/auth.py`) — deferred, needs email infra.

## Sharing (Phase 10)

Client-side sharing UI + integration, built entirely under `src/` against the frozen
Phase 9 backend (`server/`, not touched this phase). Full requirements:
`docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 10 section, `docs/ROADMAP-SHARING-AUTH.md` §1,
`server/README.md`'s "Public share contract".

**Modules** (`src/share/`):
- `api.ts` — typed `fetch` client for every `/api/*` and `/share/*` endpoint the client
  needs. As of Phase 10.5a (roadmap §5.4), EVERY call here is a plain relative fetch —
  no `baseUrl` parameter anywhere in this file (originally, `/api/*` calls took an
  explicit, persisted `baseUrl` while `postShareAuth`/`getShareContentSameOrigin` were
  the two deliberate relative-URL exceptions; see "Single-origin deployment" below for
  why that whole distinction collapsed). `whoami()` never throws (fail-closed
  reachability probe — see CLAUDE.md rule 3).
- `useShareStore.ts` — ephemeral zustand store (NOT persisted): backend reachability
  (`"unknown" | "checking" | "online" | "offline"`), auth status, the owner's share
  list, in-flight/error flags. No backend base URL parameter anywhere in this store
  either as of Phase 10.5a — `api.ts`'s functions are relative now, so every action
  here just calls straight through.
- `sharePolicy.ts` — pure `shareCreatePayload()`: shapes the Publish dialog's UI input
  into the exact `POST /api/shares` body. Extracted specifically so it's unit-testable
  without mocking `fetch` (`tests/unit/sharePolicy.test.ts`).
- `alias.ts` / `shareLinks.ts` — pure logic: custom-alias format validation (mirrors the
  backend's `SLUG_RE` exactly, client-side, before ever making a request) and share-link
  URL construction. See "Two link shapes" below for `shareLinks.ts`'s central design
  decision.
- `ShareApp.tsx` — the standalone `/share/<slug>` route. See "Routing" and "No vault
  access" below.

**UI surfaces**: `components/local/PublishDialog.tsx` (Google/Microsoft-style publish/
edit-policy dialog — pure composition of `my-you-eye`'s `Dialog`/`FormField`/`Select`/
`Switch`/`Input`/`Button`/`Badge`/`Alert` plus the existing local `SegmentedControl` for
the raw/rendered mode toggle; no new local primitive, so no `docs/COMPONENT-BACKLOG.md`
row) and `components/local/SharedPanel.tsx` (the owner's share list — composed from the
library's raw `Table`/`TableRow`/`TableCell` primitives rather than `DataTable`, since
`DataTable` has no row-click/actions slot at all — checked `skills/components.json`;
`Table` is exactly "reach for this when you need bespoke markup a data-driven API can't
express," per its own manifest description). Reachable from three places per the
roadmap: `local/ExplorerTree.tsx`'s row context menu ("Publish…", files only), the
command palette ("Publish/Share file…"), and `components/TitleBar.tsx`'s share icon
(shown whenever a real file is focused) — all three funnel through `App.tsx`'s
`handleOpenPublish`/`handleShareActiveFile`, which read the file's CURRENT buffer
content (`useBufferStore`, unsaved edits included) and open one shared dialog instance.
"Edit policy…" (from the Shared panel) is a SEPARATE, local `PublishDialog` instance
owned by `SettingsView.tsx` itself — it never needs file content, so it doesn't need any
of the App.tsx plumbing a fresh publish does. The "Shared" panel lives inside
`SettingsView.tsx`'s new "Sharing" category (not a fifth activity-bar icon): Settings is
already a real full-width tab (Phase 6.5c), the share list is account-level
configuration exactly like "Git & Sync," and a new activity-bar icon would need its own
`SidebarContainer` region + width/collapse plumbing for a view that's fundamentally a
list + actions, not a persistent always-visible panel.

**Routing.** This app had no router before this phase — `main.tsx` read a single
always-mounted `<App/>`. The minimum viable fix: `window.location.pathname` is read
ONCE at boot and used to pick between two entirely separate render roots, never both.
`/share/<slug>` (a `/^\/share\/([^/]+)\/?$/` match) dynamically `import()`s
`share/ShareApp.tsx`; anything else dynamically `import()`s `App.tsx` (previously a
static top-level import — moved behind `import()` specifically so its whole module
graph, `fs/seed.ts`, every `stores/use{Fs,Buffer,Tabs,Git}Store.ts`, isomorphic-git,
lightning-fs, never even downloads on the share route — this is the actual mechanism
behind "no vault access," not a promise kept by convention). No react-router: one
regex, one boot-time branch, two dynamic imports — Vite's default code-splitting turns
each `import()` into its own chunk with zero bundler config. Verified (not assumed) that
`vite dev`/`vite preview`'s default SPA history fallback serves `index.html` for
`/share/<slug>`, and that the generated service worker's `NavigationRoute` (workbox,
matches every navigation, no `denylist`) does the same offline — both checked directly
against the built `dist/sw.js` and via curl/Playwright against a real `vite preview`
during this phase's manual verification.

**No vault access (`ShareApp.tsx`).** Grep-confirmed, not just documented: this file
imports nothing from `fs/`, `git/`, or any `stores/use{Fs,Buffer,Tabs,Git,Settings}Store`
module — only `share/api.ts`'s two relative-URL fetch functions, `renderers/
HtmlPreview.tsx`, and `editor/LivePreviewEditor.tsx` (read-only). Rendering strategy by
`render_mode` and extension: `.html`/`.htm` → `HtmlPreview` (existing Phase 4 sandboxed
iframe, reused verbatim — see "Rendered-mode sandbox" below); anything else → the real
`LivePreviewEditor`, `readOnly`, same pipeline every local `.md` Rendered view uses. A
`render_mode: "raw"` share reached here (shouldn't normally happen — see "Two link
shapes" below) falls back to an inert `<pre>` text block.

**The no-existence-oracle contract, client-side.** `server/README.md`'s "Every deny
reason is the SAME 404" section is binding — `ShareApp.tsx` renders exactly ONE generic
state ("This link is unavailable, or it requires a password") for every 404, with an
inline password field that unconditionally `POST`s to `/share/{id}/auth` regardless of
whether the client has any reason to believe the share exists or needs a password. The
component never branches on response body/message content — only `err.status === 404`
(generic unavailable) vs. anything else (a genuine unreachable-backend state, which
carries no oracle risk since it says nothing about whether the slug is real).

**Two link shapes, historical (Phase 10) — superseded by Phase 10.5a's single origin,
kept for context.** `render_mode` used to pick an ORIGIN, not a query param
(`shareLinks.ts::buildShareLink`): `raw` → the backend's own origin
(`{backendBaseUrl}/share/{slug}`), `rendered` → `{window.location.origin}/share/{slug}`
(this app's own, then-DIFFERENT, origin). Roadmap §5.4 made front + back one origin, so
that distinction collapsed to nothing — both `render_mode`s now build the exact same
URL (`buildShareLink` no longer even takes a `backendBaseUrl` parameter), and which
response a real browser gets there (raw `text/plain` vs. the SPA shell) is decided
server-side by content negotiation instead — see "Single-origin deployment" below for
the full mechanism.

**The `/share/*` same-origin requirement — still true, now for a different, permanent
reason.** `POST /share/{id}/auth`'s success response sets a session cookie scoped
`Path=/share/{slug}` (`server/app/routers/share_public.py`) — a cookie's Path only
covers that literal prefix, so a fetch to any OTHER path prefix (e.g. `/api/share/{id}/
content`) never carries it, and a correctly-entered password would 404 forever on the
content re-fetch. Phase 10 originally worked around this (and around `POST
/share/{id}/auth`'s complete absence of `CORSMiddleware`) with a narrow, deliberately-
scoped dev/preview proxy standing in for "same origin in production." As of Phase
10.5a, "same origin in production" isn't an assumption anymore — it's literally true
(`server/app/main.py` serves the SPA itself) — but the dev/preview proxy
(`vite.config.ts`'s `shareAuthProxy`) still exists and is now MORE broadly used (not
just this one path — see "Single-origin deployment" below), because `vite`/`vite
preview` remain genuinely separate processes from the backend locally.

**Rendered-mode sandbox** (roadmap §1's security bullet, explicitly left to this phase
since it's client-side): HTML renders ONLY inside `renderers/HtmlPreview.tsx`'s existing
`sandbox=""` `srcDoc` iframe (built in Phase 4 for the local `.html` Rendered mode,
reused verbatim — no new sandbox mechanism needed). Markdown's safety is a property of
the EXISTING live-preview pipeline, not new code: `editor/livepreview/widgets.ts` only
ever defines `CheckboxWidget`/`LinkWidget`, both building plain DOM via
`document.createElement` + `textContent` — there is no `HTMLBlock`/`HTMLTag` widget
anywhere in `editor/livepreview/plugin.ts`, so raw HTML embedded in markdown source
(`<script>…`, `<img onerror=…>`) is tokenized by `@lezer/markdown` for syntax
highlighting ONLY and never becomes live DOM, with or without a share involved — CM6
simply never calls `innerHTML`/`dangerouslySetInnerHTML` on user content anywhere in
this codebase. Proven, not just reasoned about: `tests/e2e/share-sandbox.spec.ts`
publishes a real `<script>window.__xss=1</script>` + `<img onerror=…>` payload and
asserts `window.__xss` stays `undefined` (markdown case) and that the HTML case's
`<iframe>` carries `sandbox=""` with neither `allow-scripts` nor `allow-same-origin` —
both assertions would fail immediately if either protection were removed.

**Backend reachability is lazy, not boot-eager.** Tried first: an unconditional `GET
/api/auth/whoami` probe in `App.tsx`'s boot effect (matching the "never blocks first
paint, fail-closed" pattern the persistent-storage request already uses). Reverted — see
this doc's Deviations entry below for why an eager boot probe is a real, provable
regression against `tests/e2e/probes.spec.ts`'s offline-cold-start test, and not merely
a style preference. The probe now fires only from the three real share-entry points
(`App.tsx`'s `handleOpenPublish`, reached by all three Publish affordances) and
`SettingsView.tsx`'s "Sharing" category's own mount effect — a user who never touches
sharing causes zero sharing-related network activity, ever, matching CLAUDE.md rule 3's
"server-optional" spirit more strictly than an eager probe did.

**Editor-role write-back — documented flow only, not built this phase** (per the plan:
"PUT creates a git commit in the vault via the client when the owner next syncs... full
live write-back can wait for sync"). The backend already implements `PUT /share/{id}`
for editor-role shares (`server/app/routers/share_public.py`): it content-addresses the
new body and repoints `share.blob_id`, with its own policy-gated auth. The CLIENT side
this phase deliberately does NOT build: no in-app editor for a share visitor, no polling
for remote edits. The intended flow, for Phase 11 (real remote sync) to pick up once
the client has a concept of "pull from a remote":
1. An editor-role share visitor's write goes straight to the backend via `PUT
   /share/{id}` (some future minimal external editing surface, out of this phase's
   scope — not `ShareApp.tsx`, which stays strictly read-only per this phase's brief).
2. The backend re-points `share.blob_id` at the new content-addressed blob; nothing in
   the OWNER's vault changes yet — the owner's local git history is untouched, and the
   share's edit lives only in the backend's blob store until reconciled.
3. When the owner's client next syncs against the Phase 11 remote (isomorphic-git
   push/pull against the backend-hosted bare repo — see IMPLEMENTATION-PLAN-V2.md's
   Phase 11 section), that sync step is where the share's current blob gets fetched,
   diffed against the owner's working tree at `share.source_path`, and — if it differs —
   written into the vault and committed as a normal git commit (author = the share's
   principal if known, falling back to a generic "via share" author), giving the edit a
   full, ordinary audit trail via git exactly like any other local edit. This is
   deliberately a PULL the owner's own sync initiates, never a push the backend
   forces into the vault unprompted — consistent with "the SPA must remain fully usable
   with the backend down" (CLAUDE.md rule 3): a pending share edit just waits until the
   owner's next sync, it never blocks or surprises anything in the meantime.
4. Conflict handling (the share's edit vs. a concurrent local edit to the same file)
   follows whatever Phase 11 decides for ordinary sync conflicts generally (the plan
   already commits to "fast-forward only in v2.0 — refuse + explain on divergence") —
   a share-originated edit is not a special case once it reaches this step, it's just
   another commit competing for the same fast-forward.

**"Live" toggle — not exposed in the Publish dialog, and said so rather than faked.**
The backend's `Share.live` field exists and defaults `false`
(`schemas.py::ShareCreateIn.live`), but nothing server-side currently re-serves the
CURRENT working-tree content for a `live: true` share — both `GET` handlers in
`routers/share_public.py` always read `share.blob_id`'s PINNED blob, regardless of
`live`. A toggle that silently did nothing would be dishonest UI, so `PublishDialog.tsx`
doesn't render one; snapshot-by-default (the backend's actual behavior) is exactly what
the roadmap specs as the safe default anyway.

## Folder shares (Phase 10.5)

Extends the Phase 9/10 sharing feature to whole subtrees per
`docs/ROADMAP-SHARING-AUTH.md` §5.1, without touching the Phase 9 policy gate's
shape (`policy.py::resolve_share` is unmodified — every folder-share route still
calls it first, unchanged). Full request/response shapes are in the new routes'
docstrings (`server/app/routers/share_public.py`'s module doc walks the whole
design); this section is the "how it's built" summary.

**Data model** (`server/app/models.py`): `Share.kind` (`ShareKind.file` |
`.folder`, default `file`) and `Share.blob_id` is now nullable — `None` for a
folder share, whose content lives entirely in the new `ShareManifestEntry` table
(`share_id`, `relpath`, `blob_id`, `size`, `media_type_hint`, unique on
`(share_id, relpath)`). A file EXCLUDED by the owner in the Publish dialog's
checkbox tree simply never gets a row — "absent, not hidden" (roadmap §5.1) is
literal: there is no exclusion flag anywhere, only presence/absence in this
table.

**Manifest resolution is an exact-match DB query, not a sanitized filesystem
join — this is the actual security argument, not a description of one.**
`share_public.py::_manifest_entry(db, share_id, relpath)` is `WHERE share_id = ?
AND relpath = ?`, full stop — no `os.path`/`pathlib` normalization, no join
against any real directory, no filesystem access of any kind (the server has
never read a vault path — see the "Data model" note under "Backend (v2)"
above — and this doesn't change that). Every attack the phase brief calls out
(`..` traversal, an absolute path, URL-encoded/double-encoded variants, a
backslash variant, a relpath that's real but belongs to a DIFFERENT share, an
excluded entry, a plain unknown path) fails for the exact same reason: no row in
`share_manifest_entries` has that `(share_id, relpath)` pair, so every one of
them falls through to `policy.not_found_response()` — the SAME uniform 404 every
other Phase 9 deny reason produces, not a second, merely-similar-looking 404.
Directory LISTINGS (`_listing_for_prefix`) are the one place resolution does
more than an exact match — it enumerates this share's own manifest rows that
share a path prefix to build a plain listing — but the query is still scoped to
`WHERE share_id = ?`, so it can only ever enumerate rows already inside the
share the caller was granted access to; an unknown/excluded prefix (no matching
rows) returns `None`, 404ing exactly like an unknown file. `_apply_manifest`
(owner-side, `routers/shares.py`) additionally rejects a relpath containing an
empty/`.`/`..` segment or a backslash at WRITE time — belt-and-suspenders
hygiene (keeps the table free of garbage a legitimate client would never send),
explicitly NOT the security boundary itself (a stored `"../x"` relpath would
still only ever be reachable by a request for the literal string `"../x"`,
which resolves nothing outside the manifest either way).

**Routes** (`share_public.py`): `GET /share/{id}` on a folder share now returns
the subtree ROOT listing (never a specific file — roadmap §5.1's "no README
special-casing" is literal: there is no code path that treats any relpath as a
landing page). `GET /share/{id}/{relpath:path}` resolves a relpath to either a
file (raw `text/plain`+nosniff by default, `ShareContentOut` JSON on `Accept:
application/json` — identical content-negotiation to a file share) or a
directory (always JSON `ShareListingOut`, since a listing has no meaningful raw-
bytes form). Both twinned under `/api/share/{id}/content[/relpath]`, mounted
under `/api` (no CORS there either as of Phase 10.5a — see "Single-origin
deployment"). `PUT /share/{id}` on a
folder share 404s (uniform, not a distinct error) — public editor write-back for
folders is out of this phase's scope, same "documented flow only" posture Phase
10's file-share write-back already has.

**Owner API** (`routers/shares.py`): `POST /api/shares` gains `kind` and
`manifest: ManifestEntryIn[]` (each `{relpath, blob_id}` — blobs are POSTed to
`/api/blobs` first, exactly like a file share; the server never reads a vault
path to build a manifest). `PUT /api/shares/{id}/manifest` wholesale-replaces the
manifest at the SAME slug ("Update share" — roadmap §5.1); `GET
/api/shares/{id}/manifest` (owner-only) is the current manifest, used to prefill
the checkbox tree's excluded state when re-opening an existing folder share's
Publish dialog.

**Testing.** `server/tests/test_folder_shares.py` is the manifest
path-resolution matrix (in-manifest hit, excluded, unknown, `..`, absolute,
URL-/double-encoded, backslash, another share's relpath) plus ordinary
resolution (root/subdir listing, raw/JSON file content, "Update share").
`test_policy_gate.py`'s existing `_build_deny_states`/equivalence-matrix tests
are EXTENDED (not duplicated) with the same folder-share deny states, so the
new routes are covered by the SAME single-fingerprint assertion that already
guards every Phase 9 deny path — a regression that reintroduced a second
response class on a folder route fails the exact same test a Phase 9 regression
would. One genuine wire-level subtlety surfaced writing this matrix: a LITERAL,
non-percent-encoded `..` segment never survives client-side URL construction in
any RFC-3986-conformant HTTP client (confirmed: `httpx.URL(path="/share/x/../y")`
normalizes to `/share/y` before a request is even built, same as a real
browser's `URL()`/`fetch()`), so `test_folder_shares.py::test_dotdot_traversal_404`
asserts the resolution FUNCTION directly rejects a literal `".."` relpath rather
than routing an unsendable request through a `TestClient`; the percent-encoded
and double-encoded variants (which DO survive client-side construction) exercise
the real route end-to-end and are the tests that matter for the actual wire-level
attack surface.

**Client** (`src/share/`): `folderManifest.ts` (pure) flattens a vault subtree
into flat `{relpath}` entries and shapes the checkbox tree's included/excluded
state into the manifest payload — "excluded" is computed as "not in this array,"
never a separate flag threaded through to the request. `shareIndicators.ts`
(pure) computes the Explorer tree's own-vs-inherited indicator state from the
owner's share list, comparing plain `FileNode.path` strings (own = exact match
on `source_path`; inherited = `path.startsWith(source_path + "/")` for a folder
share) — no server round-trip needed for the glyph itself. `PublishDialog.tsx`'s
folder mode composes the new local `CheckboxTree` (see `docs/COMPONENT-BACKLOG.md`)
over a subtree `App.tsx` already read from the vault (`readFolderPublishData`) —
the dialog itself still never touches `fs/`/`useBufferStore` directly, same
vault-agnostic boundary as the single-file flow. `ShareApp.tsx`'s folder-browsing
mode (`FolderShareView`) is a slim tree-left/content-right split, built to
degrade EXACTLY to the pre-Phase-10.5 single-file layout for an ordinary file
share (`load()` distinguishes the two purely from response shape — a folder
share's root ALWAYS returns a listing, a file share's root ALWAYS returns
content — no new field needed, see that file's doc for the full account) — every
existing `tests/e2e/share-{password,publish-revoke,sandbox,backend-down}.spec.ts`
assertion about the single-file DOM shape still holds unchanged.
`tests/e2e/share-folder.spec.ts` is this phase's exit-criterion spec: publish a
folder → browse the tree in a second browser context → an excluded file 404s
(the identical generic unavailable state, never a distinct message) → revoke →
the whole subtree 404s, plus the Explorer indicator (both variants) and the
Shared registry's folder-kind row.

**Known simplification, stated plainly.** The Explorer tree's "inherited" glyph
marks the WHOLE subtree of a folder share uniformly — it does not currently
re-fetch that share's manifest to grey out files the owner separately excluded
at publish time (a file excluded from the share still shows the muted
"inside a shared folder" glyph in the Explorer, even though it doesn't actually
resolve for a visitor). Fixing this exactly would mean either caching every
visible folder share's manifest client-side or a bulk "what's included"
endpoint — neither exists yet. Not a security issue (the server-side exclusion
is real and enforced; this is purely an owner-facing indicator's precision), but
worth fixing before folder shares with meaningfully large exclusion lists become
common.

## Real sync (Phase 11)

Server hosts real bare git repos over smart-HTTP; the client talks to them with real
isomorphic-git `fetch`/`push` (a real `git.fastForward`-shaped fast-forward, hand-rolled
— see Deviations). Full server-side contract (auth header shapes, scope rules, path
safety, CORS) lives in `server/README.md`'s "Real git sync" section — not duplicated
here. This section is the "how it's built" summary across both sides.

**Server** (`server/app/gitrepo.py`, `server/app/routers/git_http.py`): bare repos live
under `SLATE_GIT_ROOT` (`{root}/{repo}.git`), one directory per repo name, created on
demand on first authorized WRITE. `gitrepo.py`'s `resolve_repo_path` validates the repo
name against `^[A-Za-z0-9_-]{1,64}$` *before* it's ever joined onto a filesystem path
(traversal is structurally unrepresentable, same posture as `policy.py`'s share-slug
validation) and double-checks the resolved path stays inside `SLATE_GIT_ROOT`.
`git_http.py`'s `GitAuthMiddleware` is a plain ASGI middleware — NOT a FastAPI
`Depends` chain, because the thing it's guarding (`dulwich.web.HTTPGitApplication`, a
WSGI app bridged into ASGI via `a2wsgi.WSGIMiddleware`) is opaque to FastAPI's DI —
that parses `Authorization` (Basic, token in either slot, or Bearer), resolves it
against the EXACT SAME `ApiToken` table Phase 9 built (`auth.resolve_bearer_token` —
never a second token system), and enforces `read` (or higher) for fetch/clone,
`write`/`share-admin` for push, on both the `info/refs` advertisement and the actual
service POST. Mounted at `/git` on the ROOT app (alongside `/share/*`). Originally had
its own `CORSMiddleware` instance (browser isomorphic-git needed it — a different
origin than the SPA); removed in Phase 10.5a (roadmap §5.4) once the sync remote
became implicitly same-origin (`git/remote.ts::computeGitRemoteUrl`) — see
"Single-origin deployment" below.

**Client — individual Pull/Push** (`src/git/remote.ts`, `src/git/syncStatus.ts`):
`realFetch`/`realPull`/`realPush`/`testGitConnection` replace the old
`simulateFetch`/`simulatePull`/`simulatePush`. Real ahead/behind (`computeSyncStatus`)
walks `git.log`/`findMergeBase` comparing local HEAD against
`refs/remotes/origin/<branch>` — pure local ref reads, no network I/O, so
`useGitStore.refresh()` recomputes it on every commit/save/tree-change for free,
safely even with the backend down. Divergence classification
(`syncStatus.ts::classifyDivergence` — up-to-date / ahead-only / behind-only /
diverged) drives the fast-forward-only policy for these TWO INDIVIDUAL actions only:
push only ever fires for ahead-only (refuses outright on diverged, never attempts
`git.push`, `force` always `false`); pull only ever fast-forwards for behind-only
(refuses on diverged; also refuses — a real, honest error, not a silent skip — if the
working tree has uncommitted changes a fast-forward checkout could clobber). On
diverged, `DIVERGED_MESSAGE` now points the user at "Sync" (below) rather than the
v2.0-original "resolve manually" dead end — roadmap §5.2 amended that policy after the
user's verdict that refusal-only "makes the app useless". Every failure surfaces as a
real `SyncError` with a `code` (`not-configured`/`offline`/`auth`/`diverged`/`dirty`/
`http`/`unknown`) and a specific message; `useGitStore`'s actions catch every one into
`syncError` state rather than letting it propagate, so a down/misconfigured backend
never produces an unhandled rejection or a stuck `syncing` flag (CLAUDE.md rule 3).
`SourceControlPanel.tsx`'s Pull/Push buttons surface success/failure via toast, reading
`syncError` back after the action resolves. `fastForwardBranch`/`pushBranch`/
`mapError` are exported from `remote.ts` specifically so `git/sync.ts` (below) reuses
the exact same mutation/error logic rather than a second copy.

**Client — the "Sync" pipeline** (`src/git/sync.ts`, `src/git/mergeLogic.ts`,
`src/git/backupRefs.ts`, roadmap §5.2): the ONE-BUTTON action (status bar's sync
segment, command palette's "Sync now", both driving `useGitStore.ts`'s `syncNow`) that
actually resolves divergence instead of refusing it. `syncNow` first auto-commits any
uncommitted local changes (rendered from the commit-template engine, below — "never
lose changes, never add friction"), then calls `sync.ts::runSync`, which fetches and
branches on `classifyDivergence`:
- up-to-date → no-op.
- behind-only → `backupRefs.ts::createBackupRef` (tags local HEAD as
  `refs/backup/pre-sync-<timestamp>`, prunes to the 5 most recent —
  `mergeLogic.ts::selectBackupRefsToDelete` is the pure prune-selection logic, unit
  tested directly), then `fastForwardBranch`.
- ahead-only → `pushBranch`.
- diverged → the auto-merge policy: `computeMergePlan` reads every file's content at
  the merge base / local HEAD / the remote-tracking ref (`git.listFiles`+`git.readBlob`
  over the union of all three trees) and classifies each via
  `mergeLogic.ts::classifyFileMerge` — a PURE function (unit tested directly, no
  `isomorphic-git`/`fs`) implementing "remote-only-changed files take remote,
  local-only-changed keep local, both-changed get content-level diff3": diff3 itself
  (`mergeLogic.ts::threeWayMergeText`) is the `diff3` npm package DIRECTLY — the exact
  engine `isomorphic-git`'s own built-in `git.merge()` merge driver
  (`mergeFile`/`mergeBlobs` in its bundled source) uses internally, so this app's
  auto-merge and `git.merge()`'s own default behavior can never disagree on what
  "clean" means. A CLEAN result (no true conflicts) creates the backup ref, writes
  every resolved file to the working tree + stages it (`applyMergedFiles`), commits a
  real two-parent merge commit (`git.commit({ref: `refs/heads/<branch>`, parent:
  [ourOid, theirOid]})` — see this section's Deviations entry below for why `ref` MUST
  be the fully-qualified form here), and pushes (`force` always `false` — the merge
  commit's second parent IS the remote's current tip, so it's always a legitimate
  fast-forward from the remote's point of view; the server's non-fast-forward
  rejection stays the backstop regardless). A TRUE conflict (same lines changed both
  sides, or a modify/delete conflict) makes `runSync` return `action: "conflict"`
  WITHOUT writing anything — no backup ref either, since nothing mutated yet — and
  `useGitStore`'s `conflict` state opens the resolver; `resolveConflict` (from the
  resolver's "Resolve & push") creates the backup ref THEN, applies the user's
  resolutions plus the already-computed clean files, and finishes the same
  commit-then-push sequence. Every `SyncError` path reuses `remote.ts::mapError`.

**Conflict resolver** (`src/components/local/ConflictResolver.tsx`, missing-component
protocol — `docs/COMPONENT-BACKLOG.md`): built on the EXISTING `@codemirror/merge`
stack (CLAUDE.md rule 7 — no second editor engine), using its OTHER documented purpose
besides the read-only diff viewer `editor/DiffView.tsx` already uses: `unifiedMergeView`
as a genuinely EDITABLE buffer with a live diff against a reference document, plus its
built-in per-chunk accept/reject gutter controls (`mergeControls: true`,
`acceptChunk`/`rejectChunk`). Content conflicts get an editable CM6 instance seeded
from "mine" and diffed against "theirs", with whole-file "Take mine" / "Take theirs" /
"Keep both" (concatenates both full versions, nothing silently dropped) quick actions
on top of the per-chunk controls; delete/modify conflicts get a simpler read-only
preview + keep/delete choice (defaulting to KEEP the surviving content, never a silent
delete). Every conflicted file gets a real, chosen default resolution the instant the
dialog opens (never "unresolved by omission"), so "Resolve & push" never blocks on the
user having visited every file. Nothing is pushed or discarded until that click.

**Commit-message template engine** (`src/git/commitTemplate.ts`, roadmap §5.3): pure,
unit-tested string substitution — `renderCommitTemplate(template, vars)` replaces
`{name}` tokens found in `vars`, passing anything else through LITERALLY (a typo'd or
undefined variable never errors). `buildTemplateVars` assembles the documented set
(`{device}` `{timestamp}` `{date}` `{time}` `{files}` `{branch}`); `{files}` is `"N
files"` or the single filename (basename only) when exactly one file changed;
`defaultDeviceName` parses `navigator.userAgent` into e.g. `"chrome-linux"` —
`useSettingsStore`'s `gitDeviceName` seeds from this once at store-init and is
user-editable from then on, same as `gitCommitTemplate` (default `"Synced from
{device}: {timestamp}"`, roadmap §5.3's exact string). Three consumers, one template:
`SourceControlPanel.tsx`'s commit box (prefills live while un-edited, stops the moment
the user types, matching the settings-driven "auto-fill, never fight the user" pattern
of nothing else in this codebase FORCING a value — see its own doc comment), the
`syncNow` auto-commit, and every merge commit `sync.ts` creates (rendered with
`{files}` = every path the merge actually touched).

**Periodic background fetch** (`App.tsx`, roadmap §5.2: "~60s while the backend is
reachable"): a plain `setInterval`/`clearInterval` pair mounted once at boot,
identical cleanup shape to `StatusBar.tsx`'s own synced-label tick interval — never
leaks a timer across reloads/HMR. Gated on `useShareStore`'s `reachability` (same
backend, same origin as every other Phase 9+ surface) so a KNOWN-offline backend isn't
hit every 60s for nothing; `fetch()` itself never throws (every `SyncError` lands in
`syncError` state), so a failed background tick is never an unhandled rejection. This
replaces every last bit of the v1 simulated ahead/behind drift
(`driftIncrement`/`SYNC_DRIFT_*`) — already fully removed in this phase's first pass
(the `computeSyncStatus` module doc's "There is no more 'drift' simulation" note); this
interval is what keeps the REAL counters current without the user having to manually
sync.

**Settings → Git & Sync** (`SettingsView.tsx`): Personal access token is a real,
enabled field — no more "coming soon" disabled placeholder. A "Generate token" action
mints a real `write`-scoped Phase 9 API token (`POST /api/auth/tokens`, reusing the
Sharing category's existing sign-in session) so a user can get sync working entirely
from the UI. "Test connection" (`testGitConnection`) does a real `git.getRemoteInfo`
round-trip that touches neither the local repo nor the working tree — a `404` (repo
not created yet) is reported as reachable/authenticated, not an error, since Phase 11
repos are created on demand on first push. **Phase 10.5a note:** there is no more
Remote URL field at all — see "Single-origin deployment" below; the Repository
DataList shows the implicit remote URL read-only instead. **Phase 11 (this section's
final pass)**: two new rows, "Default commit message" (the template `Input`, with a
live-rendered preview line underneath) and "Device name" (the `{device}` setting) — no
remaining "isn't wired up yet" placeholder anywhere in this category.

## Single-origin deployment (Phase 10.5a)

Supersedes this doc's earlier "Two link shapes" / "The `/share/*` same-origin
requirement" framing above (Sharing (Phase 10) section) and the per-app CORS
description in "Backend (v2)" — both described a genuinely cross-origin SPA/backend
split with a configurable base URL bridging them. Roadmap §5.4's user decision
replaced that entirely: front + back ship as ONE origin, one process
(`server/app/main.py`), reached from outside `localhost` via a Cloudflare tunnel (the
owner's concern, config-only, out of scope here).

**Client: no configurable origin, anywhere.** `share/api.ts` (every `/api/*` and
`/share/*` call), `share/shareLinks.ts` (`buildShareLink`/`buildFolderShareLink`,
which no longer need to pick between "backend origin" and "app origin" — both are the
same origin now, so there's nothing left to pick), and `git/remote.ts`
(`computeGitRemoteUrl()`, replacing the old `useSettingsStore::gitRemoteUrl`/
`DEFAULT_GIT_REMOTE_URL` settable field) all either fetch a bare relative path or
build `${window.location.origin}/...` on demand. `useSettingsStore`'s `gitRemoteUrl`
and `shareBackendUrl` fields are gone (`version: 3`'s `migrate` step deletes either
key from a returning user's persisted blob if present — never errors, never leaves
stale-but-unread data forever). Settings no longer has a "Sharing base URL" or
"Remote URL" field; the Sharing category's "Test connection" is a same-origin
reachability re-probe, and Git & Sync's "Test connection" is a same-origin health
check against the implicit remote.

**Server: no CORSMiddleware anywhere.** `main.py`'s root app (`/share/*`, `/git/*`)
and the `/api`-mounted sub-app both dropped `CORSMiddleware` entirely — same-origin
needs none. `SLATE_CORS_ORIGINS`/`Settings.cors_origin_list` are deleted from
`config.py`, `.env.example`, and this doc's earlier "App factory" paragraph is stale
in describing a CORS-enabled `/api` sub-app (kept above for the historical record of
Phase 9's design, not because it's still accurate). `git_http.py`'s `build_git_app`
dropped its own `CORSMiddleware` wrap the same way — the browser's isomorphic-git
client is same-origin now too. Tests flip from asserting CORS-header presence to
asserting absence: `server/tests/test_share_public.py`, `test_git_sync.py`,
`test_raw_mode.py` (`assert not any(k.lower().startswith("access-control-") for k in
r.headers.keys())` — the whole prefix, not just `access-control-allow-origin`, since
starlette's OWN default behavior emits `access-control-allow-credentials: true` on
every response through machinery this app doesn't control unless CORSMiddleware is
present at all, which it now never is).

**Server serves the SPA — static mount + fallback, route ORDER is the whole safety
argument.** `main.py::create_app` reads `../dist/index.html` once at startup into
`app.state.spa_index_html` (`None`, with a one-line startup log, if `dist/` hasn't
been built yet — never a crash; `npm run build` produces it). Two pieces, both
registered on the root app strictly AFTER `/share/*`'s explicit routes and the `/git`
mount:
1. A catch-all `GET /{full_path:path}` route, registered LAST — Starlette tries
   routes/mounts in registration order, so anything registered earlier (the `/api`
   mount, the `/git` mount, every `/share/*` route) always wins its own path space
   first; this handler is only ever REACHED for a path none of those claimed. It
   serves a real file straight off `dist/` when one exists there (hashed JS/CSS
   chunks, PWA icons, `manifest.webmanifest`, `sw.js`, favicon — all the "loose"
   top-level build outputs), else falls back to `index.html` (this app has no
   client-side route besides `/share/*`, which never reaches this handler at all —
   see point 2 — so literally everything else, including `/` itself, is meant to
   land on the app shell).
2. `routers/share_public.py`'s existing GET handlers (`get_share`/`get_share_path`)
   gained a new branch, gated on a new `_wants_html()` check (`"text/html" in
   Accept` — deliberately NOT "absence of `application/json`", so a plain
   curl/script with no `Accept` header at all keeps getting the exact
   pre-Phase-10.5a documented default: raw bytes for a file, JSON listing for a
   folder). Two sub-cases, both funneled through this check:
   - **Success** (`policy.resolve_share` granted access): a `render_mode="rendered"`
     file share or ANY folder share, wanting HTML, gets `app.state.spa_index_html`
     (`_spa_shell_response()`) instead of the raw/JSON response — the SPA then
     mounts and re-fetches the identical URL itself with `Accept:
     application/json`, taking the unchanged JSON branch. RAW-mode file shares are
     excluded from this branch entirely (checked on `render_mode`, not `Accept`) —
     they always return `text/plain`, browser or not, preserving roadmap §1's "a
     raw share must never execute" absolutely, with no exception.
   - **Denial** (`policy.PolicyDenied`, or an "access granted but this relpath/kind
     doesn't resolve" case): ALSO gets the identical shell for `Accept: text/html`
     — see the paragraph below for why this widening (not part of this phase's
     original design) is required and is a strict privacy IMPROVEMENT, not a
     weakening.

**Every deny reason gets the shell for HTML navigation too — `_deny_response()`,
replacing the old direct `policy.denial_response()`/`policy.not_found_response()`
calls in `get_share`/`get_share_path` only (not `put_share`, not the `/api/share/
.../content` twin routes — neither is ever browser-navigated).** This phase's
original design kept denials JSON-only regardless of `Accept`, reasoning that
serving the shell for a bogus slug would "hand the app shell to unauthenticated
visitors." That reasoning turned out to be backwards, caught by an independent
review against the REAL production topology (`uvicorn` alone, `vite preview`'s
dev-only `bypass` proxy rule not in the loop): a password-protected, revoked, or
expired share opened via a cold browser navigation got a bare JSON 404 body
instead of ever reaching `ShareApp.tsx`'s "this link is unavailable, or it requires
a password" UI — the SPA was never loaded at all, so its whole password-prompt
contract (`server/README.md`'s "Every deny reason is the SAME 404" section) could
never execute. Worse, the original design was ITSELF a (smaller, HTML-Accept-only)
oracle: a plain `curl -H 'Accept: text/html'` could already distinguish "real,
accessible, rendered/folder share" (200 HTML) from "denied for any reason" (404
JSON) from "real raw-mode share" (200 text/plain) — three classes reachable
without ever sending `Accept: application/json`. `_deny_response()` fixes both:
`GET /share/<bogus-slug>` (or revoked, expired, password-required, wrong role,
unresolvable relpath — EVERY deny reason, uniformly) with `Accept: text/html` now
returns the exact same `app.state.spa_index_html` bytes a SUCCESSFUL rendered-mode/
folder share's navigation gets — content-independent, no slug/policy/error detail
baked in — collapsing what used to be three navigation-visible classes into ONE
(a successful RAW-mode share is the sole remaining exception, on its own separate,
non-negotiable terms). The actual authorization decision — and the byte-identical
JSON `404 {"detail":"Not found"}` the uniform-404 fingerprint requires — moved
entirely to the DATA fetch: `Accept: application/json` (what `ShareApp.tsx`'s own
re-fetch always sends, and what `tests/test_policy_gate.py`'s equivalence-matrix
tests exercise via httpx's default-no-`Accept`-header requests) is completely
unaffected by `_deny_response()` — `_wants_html()` requires `text/html` specifically
present, so neither of those ever takes the new branch. Proven directly:
`server/tests/test_policy_gate.py::test_html_navigation_gets_shell_for_every_deny_
reason_and_success_alike` asserts the shell bytes are IDENTICAL across bogus/
revoked/expired/password-required/rendered-success, and that `Accept: */*`/
`application/json` still get the untouched byte-identical JSON 404 — see that
test's own doc for the RED/GREEN proof it was written against (temporarily
reverting `_deny_response`'s HTML branch reproduces exactly the bug this fixes: a
real 404 body where the test expects the shell). The §5.4 exit demo (this phase's
final report) separately curls `/share/<bogus>` and a real password-protected share
directly against a built `dist/` + running uvicorn (the actual production
topology, not `vite preview`) and shows both.

**Proxy-header handling (uvicorn, `package.json`'s `server` script).**
`--proxy-headers --forwarded-allow-ips='*'` — uvicorn's `ProxyHeadersMiddleware`
rewrites `scope["scheme"]`/`scope["client"]` from `X-Forwarded-Proto`/
`X-Forwarded-Host` when the connecting peer is in `forwarded-allow-ips`; `'*'` (not
uvicorn's own default, which only trusts `127.0.0.1`) is a deliberate choice for this
single-host deployment shape — a Cloudflare tunnel client can connect from a
container/bridge address that isn't literally `127.0.0.1` depending on how
`cloudflared` is run, and this process has no other untrusted network path in front
of it. See `server/README.md`'s "Single-origin deployment" section for the full
rationale and the cookie `Secure`/`SameSite=Lax` posture (unchanged by this phase —
already correct since Phase 9).

**Dev/preview**: `vite.config.ts`'s proxy config (`shareAuthProxy`, kept as the
variable name for continuity) gained two new unconditional entries,
`^/api(/.*)?$` and `^/git(/.*)?$`, alongside the pre-existing `/share/*` entries
(unchanged logic — still needs the `bypass` content-negotiation trick for the bare
`/share/{id}` path, which is ALSO this app's own client-side route). Both proxy to
`SLATE_SHARE_PROXY_TARGET` (env, default `http://127.0.0.1:8787`; `8788` for the e2e
suite) — the same target variable Phase 10 already established, just applied more
broadly now that the client has no `baseUrl` fallback of its own to reach for.

## Feedback round 4 — server/auth (Phase 12a, DESIGN-SPEC Amendments items 26 + 32)

### 26a — `/git`'s `WWW-Authenticate` challenge, gated to git-shaped clients

**The bug**: `git_http.py::GitAuthMiddleware` used to send `WWW-Authenticate:
Basic realm="slate-git"` on EVERY anonymous/failed-auth 401, unconditionally.
A browser `fetch()` that receives that header on ANY response — regardless of
whether the page code ever reads it — pops the browser's own NATIVE
credential dialog. The app's own background `/git` poll (see 26b below) hits
this route roughly every 60s while signed out, so the user saw that native
popup on a cadence, with no way to dismiss it from inside the app.

**The fix**: `_is_git_client(user_agent)` (`git_http.py`) gates the header's
PRESENCE — never the status code, body, or the underlying authorization
decision, all three of which are byte-identical either way — on the
request's `User-Agent` starting with `git/` (case-insensitive; a MISSING
User-Agent is treated as NOT a git client — the safer default, since real
git always sends some `git/…` string on its own, confirmed against system
git 2.43.0 in this environment). `_unauthenticated_response()` is now the
ONE place that builds this 401, so there is exactly one code path to keep
correct. Real git clients (system `git`, and any other tool that identifies
itself honestly) are unaffected — they still get the challenge they depend
on to prompt/retry with credentials; `server/tests/test_git_sync.py`'s live
`uvicorn` + real-system-git round-trip tests (unchanged) are the regression
backstop for that half. New coverage:
`server/tests/test_git_http_ua_gating.py` — browser-UA/git-UA/missing-UA
matrix, plus a byte-for-byte comparison proving `WWW-Authenticate` is the
ONLY thing that differs between the browser and git response classes.

This is deliberately narrower than `/share/*`'s uniform-404 no-oracle
posture (roadmap §1) — `/git/*` is a real HTTP auth challenge surface by
design (real git clients need SOME signal to know to prompt), so "vary one
header by caller type" is a legitimate, intentional asymmetry here, not a
weakening of the share gate's much stricter "every deny reason is
byte-identical, full stop" rule described earlier in this doc.

### 26b — background `/git` poll suspended while signed out

**The bug's other half**: `App.tsx`'s periodic background fetch (Phase 11,
roadmap §5.2, "~60s while the backend is reachable") used to gate on
`useShareStore`'s `reachability` field alone (`reachability !== "offline"`).
`reachability` is a soft, tri-state signal that starts `"unknown"` and is
**never probed at app boot by design** (see this doc's Sharing section:
an eager unconditional `whoami()` at boot broke `tests/e2e/probes.spec.ts`'s
offline-cold-start assertion, and was reverted for that reason). The net
effect: for every signed-out session, the interval's guard was always
truthy, so it fired unconditionally, every ~60s, hitting `/git` with no
credentials — the exact request that triggered 26a's popup.

**The fix**: the interval now gates on `useShareStore`'s `authenticated`
field instead — a HARD boolean that starts `false` and is only ever flipped
`true` by an explicit sign-in action (`login()`, or a `probe()` that
resolves to an authenticated `whoami()`). A signed-out session therefore
makes literally zero `/git` requests from this interval (proven at the
network level, not by asserting on internal state, per the phase brief:
`tests/e2e/git-background-poll.spec.ts`'s `page.on("request")` tracking),
and polling resumes automatically on the very next tick after sign-in from
anywhere (Settings → Git & Sync, the Publish dialog, …). Deliberate
trade-off, stated plainly: a user who already has a valid server-side
session from a PREVIOUS visit does not get automatic background sync
resumed on a fresh page load — `authenticated` resets to `false` on every
reload (this store is deliberately not persisted, see its own module doc)
and nothing re-probes it until the user touches a share-surface entry point
or Settings → Sharing/Git & Sync. This is consistent with — not a new
exception to — the existing "no eager boot-time reachability probe" design
this section's first paragraph already describes; fixing it further (e.g. a
throttled, offline-safe boot probe) is not in this phase's scope.

`App.tsx` also gained a test-only override,
`window.__gitBackgroundFetchMsOverride` (same inert-unless-set shape as
`lib/renderProbe.ts`'s `__renderProbeEnabled`), so the e2e spec above can
observe several poll ticks without a real 60s wait.

### 32 — fallback-login onboarding

Full contract, rationale, and usage: `server/README.md`'s "Fallback-login
onboarding" section (the "how to use it" doc) and `main.py::bootstrap_user`'s
own docstring (the "why it's safe" doc) — not duplicated here to avoid the
three drifting. Summary for this doc's "how it's built" purpose:
`main.py::bootstrap_user(SessionLocal, settings)` runs once per `create_app()`
call, right after `Base.metadata.create_all`, gated on
`SLATE_BOOTSTRAP_USER`/`SLATE_BOOTSTRAP_PASSWORD` and an empty `users` table;
`scripts/create_user.py` is the interactive (`getpass`-hidden password)
CLI companion for every other case. Both hash through the exact same
`security.hash_password` (argon2id) path `routers/auth.py::login`'s verify
side already used — no second hashing implementation introduced anywhere.
Full test coverage: `server/tests/test_bootstrap.py`.

## CI + GitHub Pages demo (Phase 13)

`.github/workflows/ci.yml` has two jobs. `test` runs on every push/PR to
`main`: install, lint, `tsc --noEmit`, build (default base path), vitest,
the Playwright e2e suite, and the server pytest suite. `pages` runs after
`test` is green, main-only, and deploys a client-only build to GitHub
Pages at `https://sadigaxund.github.io/vsnote/` — no backend is deployed
by CI anywhere; share/sync surfaces on the demo render their normal
server-offline states (`PublishDialog`/`SettingsView`'s existing
`reachability === "offline"` branches, unchanged by this phase).

**Ordering inside `test`**: the server virtualenv (`server/.venv`, from
`server/requirements.txt`) is created immediately after `npm ci` and well
before the Playwright step. This matters because `tests/e2e/globalSetup.ts`
spawns the share backend via the literal path `server/.venv/bin/python` —
without that venv already installed, the e2e run doesn't fail a handful of
specs, it dies at `globalSetup` before any spec executes at all. Playwright
workers are pinned explicitly (`--workers=2`) rather than left to Playwright's
default auto-detection, matching `playwright.config.ts`'s own
`workers: process.env.CI ? 2 : undefined` — this suite runs a real
`vite preview` server and a real uvicorn backend alongside the browser
workers, and over-parallelizing on a shared runner has cost real wall-clock
time via port/resource contention. **Retries are 0**, unconditionally
(`playwright.config.ts`), and the workflow adds no retry logic of its own.
Phase 12 is the reason that default is zero rather than one: the
live-preview defect fixed in `834063d` (the async-parse race that left raw
markdown on screen) presented purely as an *intermittent* e2e failure. A
retry budget with no named flake behind it would have failed that spec
once, passed it on the retry, and reported CI green while real users kept
hitting the bug. Raising retries above 0 therefore requires naming the
specific spec and the reason, in `playwright.config.ts` and in
`.github/workflows/ci.yml`, at the time it is raised.

**Base-path mechanism.** `vite.config.ts` reads `SLATE_BASE_PATH` (default
`"/"`, so every local flow — dev, build, preview, the e2e suite's own
`vite preview` on port 5290 — is unchanged) into a `BASE` constant that
feeds four independent things, all of which have to agree or the demo
silently 404s its own assets under `/vsnote/`:

1. Vite's own `base` config — drives every built `<script>`/`<link>` URL
   and the `%BASE_URL%` placeholder this project's `index.html` uses for
   its favicon (a raw `public/` asset reference Vite does not otherwise
   rewrite, unlike tags it processes as part of the module graph).
2. `VitePWA`'s own `base`/`scope` plugin options (SW registration path +
   precache URL prefix) — passed explicitly even though they default to
   vite's `base`, so the tie is visible in the config rather than implicit.
3. The Web App Manifest's `start_url`/`scope`/icon `src` fields — these are
   plain JSON fields the plugin does **not** derive from vite's `base` on
   its own; left at `"/"` they'd claim a scope the origin doesn't actually
   grant the app under `/vsnote/`, breaking install/standalone launch.
4. The service worker's precache manifest, which workbox emits as paths
   relative to `sw.js`'s own URL (`"assets/…"`, no leading slash) — this
   one needs no base-awareness at all, since a relative URL resolves
   correctly against wherever `sw.js` itself is served from.

CI's `pages` job builds with `SLATE_BASE_PATH=/vsnote/`; the default job
(`test`) builds with no override, proving both paths on every run.

**One-time owner action (required before the demo goes live).** The `pages`
job deploys through the `github-pages` environment, which only accepts
Actions-sourced deployments once the repository is configured for it: in
GitHub, go to Settings, then Pages, and set Source to "GitHub Actions". No
token or secret is involved; `deploy-pages` authenticates with the
workflow's own `id-token: write` permission. Until that flip is made the
`test` job still runs and passes normally, and only the `pages` job fails
at the deploy step, so CI staying green is not evidence the demo is live.

Verified locally before the workflow shipped (not just read from config):
`dist-pages/index.html`'s script/link/manifest URLs, the manifest's
`start_url`/`scope`/icon `src`, and `sw.js`'s reachability + precache
entries were all fetched over real HTTP from a copy of the build served
under an actual `/vsnote/` subpath on a scratch port, plus a real headless
Chromium load asserting zero failed requests and zero console errors.

## Containerization (Phase 14)

One image, one process — a direct consequence of single-origin (Phase
10.5a, roadmap §5.4): the same uvicorn/FastAPI process that already serves
`/api`, `/share/*`, `/git/*`, and the built SPA off one port needs nothing
else added to become the whole deployable artifact. `Dockerfile` (repo
root) is a two-stage build:

1. **`builder` (`node:20-slim`)** — `npm ci && npm run build`, producing
   `dist/`. Node, npm, and every dev dependency (vite, typescript, eslint,
   playwright, ...) live only in this stage and are never copied forward.
2. **final stage (`python:3.12-slim`)** — installs `server/requirements.txt`
   filtered to drop its two test-only entries (`pytest`, `httpx` — that
   file also doubles as the local `pytest` dependency list, see
   `server/README.md`'s "Running the tests"; the image has no test runner
   and doesn't need them), copies `server/app` + `server/scripts` and the
   built `dist/` from stage 1, and runs as a non-root user (`slate`,
   uid/gid 1000 — created with `useradd --system ... --shell
   /usr/sbin/nologin`). Verified empirically, not assumed: `which node`
   inside the final image reports nothing, `pip list` carries no
   pytest/httpx, and `docker compose exec vsnote id` / `/proc/1/status`'s
   `Uid:` line both confirm PID 1 runs as uid 1000, never root.

**Where DIST_DIR resolves.** `server/app/main.py` computes `DIST_DIR` as
`Path(__file__).resolve().parents[2] / "dist"` — three levels up from
`server/app/main.py` is the repo root locally. Inside the image, `server/app`
is copied to `/app/server/app`, so `parents[2]` is `/app`; the Dockerfile
therefore copies the builder stage's `dist/` to exactly `/app/dist` to keep
that same relative relationship intact with zero code changes.

**Persistent state — two named volumes, nothing else.** The two paths this
process ever writes to at runtime are pointed at container-local mounts
`/data/db` and `/data/git-repos` (owned by `slate:slate` at build time),
which `docker-compose.yml` backs with named volumes `vsnote-db` and
`vsnote-git-repos`:

- `SLATE_DB_URL` defaults to `sqlite:////data/db/slate.db` in the image
  (overriding `app/config.py`'s own `sqlite:///./slate.db` default, which
  is relative to a CWD/ownership assumption that doesn't hold in a
  container) — the owner/share/token database.
- `SLATE_GIT_ROOT` defaults to `/data/git-repos` (overriding `app/
  config.py`'s own `./git-repos`) — the bare repos Phase 11's smart-HTTP
  git server reads/writes.

Everything else in the image (app code, `dist/`) is read-only from this
process's point of view. **The persistence contract, verified against a
real `docker compose down` / `up` cycle** (not assumed from the compose
file alone): a share published and a git repo pushed to before `down`
both still resolve correctly after a subsequent `up` — same slug content,
same commit hash on `git clone`. `docker compose down -v` is the
deliberate factory reset (drops both named volumes — the DB and every bare
repo, unrecoverable) and is never run as part of a routine restart.

**Healthcheck.** No dedicated `/healthz` route exists anywhere in
`server/app/routers/`. The compose healthcheck instead hits `GET /` — the
real single-origin front door (what a Cloudflare tunnel or browser reaches
first) — via Python's stdlib `urllib` (deliberately not curl/wget, neither
of which `python:3.12-slim` carries, and the image doesn't add one just for
this). `GET /` only returns `200` once `create_app()` has fully booted
(engine + `Base.metadata.create_all` + `bootstrap_user` + `dist/`
discovery) without raising, so a healthy status genuinely means "serving
real traffic," not merely "process started."

**Cloudflare tunnel topology.** `docker-compose.yml` includes a commented-
out `cloudflared` sidecar service (image, `tunnel run` command, a
`TUNNEL_TOKEN` env var, `depends_on: vsnote: condition: service_healthy`) —
disabled by default, since most operators already run their own tunnel
process/token outside this compose file (see server/README.md's
"Cloudflare Access production topology" sketch, which this mirrors at the
container level).

**What did NOT change**: no code under `src/` or `server/app/` changed for
this phase — the container is purely a packaging/runtime concern layered
on top of the exact same single-origin process `npm run server` already
runs locally.

## Deviations

Real friction points found while building against the actual `my-you-eye@0.4.0` npm
package (not just its docs), and how Phase 1 resolved each without abandoning the
stack choices in this doc.

- **React version.** `my-you-eye` declares `react`/`react-dom` as plain `dependencies`
  pinned to `^19.2.7`, not `peerDependencies` — installing it alongside this app's
  required React 18 would let npm nest a second, incompatible React copy inside
  `node_modules/my-you-eye/node_modules/react`, which breaks hooks across the
  library/app boundary (two dispatcher instances). Fixed with a `package.json`
  `"overrides"` block pinning `react`/`react-dom` to this app's `^18.3.1` everywhere in
  the tree, so exactly one React copy is ever installed. Nothing in the library's
  compiled output (checked in `node_modules/my-you-eye/dist/index.js`) uses a React
  19-only API, so this holds up in practice — confirmed by exercising `Tooltip` and
  `DropdownMenu` (both stateful, hook-heavy) in the running app with zero console
  errors. If a future `my-you-eye` bump needs a real 19-only feature, this override
  becomes a real blocker and React 18 vs. the library version needs revisiting then.
- **Tailwind v4 content scanning vs. a component library shipped as compiled JS.**
  We used the documented "normal path" — `@import "my-you-eye/styles.css"` (the raw
  Tailwind v4 source, not the `styles.compiled.css` fallback) — but Tailwind v4's
  automatic content detection does not scan `node_modules` by default, while every
  `my-you-eye` component's utility classes live only as string literals inside its
  compiled `node_modules/my-you-eye/dist/*.js`. Left alone, this silently drops any
  utility class that our own source never happens to also reference (`Input`'s
  `w-full` was the tell: the search field and filter field rendered at a fixed
  ~20-character intrinsic width instead of filling their container, with no error —
  just quietly wrong CSS). Fixed with one `@source "../node_modules/my-you-eye/dist";`
  directive in `src/index.css`, the standard Tailwind v4 mechanism for opting a path
  back into scanning. Confirmed fixed by grepping the built CSS for `.w-full` (absent
  before, present after) and by the search bar/filter input rendering at full width.
  This is *not* the `styles.compiled.css` fallback the setup docs describe (that
  trade-off — losing the ability to use Tailwind utilities in our own source — was
  never needed here); it's a one-line addition to the source-CSS pipeline described in
  the stack table above.

- **`isomorphic-git` needs Node's `Buffer` global.** `node_modules/isomorphic-git/index.js`'s
  `GitIndex` (the `.git/index` reader/writer used by every `add`/`commit`) calls
  `Buffer.from`/`Buffer.alloc`/`Buffer.concat`/`Buffer.isBuffer` directly — there is no
  browser-native equivalent. Confirmed by the exact runtime error (`Buffer is not
  defined`, thrown from inside `isomorphic-git`) the first time `git.add` ran in the
  browser. Fixed with the `buffer` npm package (the standard browser polyfill) and a
  four-line shim at the very top of `src/main.tsx` that sets `globalThis.Buffer` before
  any `fs/`/`git/` module runs — not a bundler-wide `vite-plugin-node-polyfills`, since
  `Buffer` was the only Node global anything in this stack actually touches.
- **lightning-fs's own internal write debounce vs. "reload must never lose unsaved
  work."** `@isomorphic-git/lightning-fs`'s README documents that its in-memory
  directory/inode structure (the "superblock") is flushed to IndexedDB on its own
  ~500ms idle debounce, separate from and in addition to this app's 300ms draft
  checkpoint debounce (`fs/drafts.ts`, DESIGN-SPEC Amendments item 6). Reproduced while
  testing that amendment: a draft wrote successfully and read back correctly *within
  the same tab* (which hits the same instance's in-memory cache), then vanished after
  an immediate `page.reload()` because the superblock update hadn't reached IndexedDB
  yet. Fixed by calling `pfs.flush()` after every mutating call in `fs/operations.ts`
  (`writeFile`/`removeFile`/`removePath`/`renamePath`, which `fs/drafts.ts` now routes
  through instead of calling `pfs` directly) — see the long comment on `flush()` there.
  Confirmed fixed with a Playwright repro: type into a file, wait for the 300ms
  checkpoint, `page.reload()`, and the draft is present with the tab still dirty.
- **Status bar's `+A -R` figure is the *active tab's* diff, not a sum across every
  changed file.** ARCHITECTURE.md's "Key flows" says the chip and status bar read the
  same `git/diff.ts` call "so numbers always agree" but doesn't specify which file's
  diff the status bar shows when several files are changed at once (this repo's demo
  vault has three: `architecture.md`, `indexer.ts`, `metrics.csv`). Summing all of them
  would make the status bar disagree with the header chip whenever the two differ (e.g.
  the screenshot's `+12 -5` is `architecture.md` alone) and has no clean definition once
  no tab is active. Resolved as "the active tab's diff, cached and invalidated via
  `useGitStore`'s `diffCache`/`refreshGeneration`" — the same single call, just scoped
  to one file at a time, which is what makes the two numbers provably equal rather than
  coincidentally equal.
- **Mode availability this phase covers `.md` (Rendered) + every type (Source); the
  full DESIGN-SPEC "Modes" table (json tree view, csv `DataTable`, html iframe, image
  viewer) waits for Phase 4's renderers.** Building throwaway renderers now to satisfy
  the full per-type matrix would contradict IMPLEMENTATION-PLAN.md Phase 2's own
  instruction to keep Phase 1's static Rendered placeholder rather than build a second
  markdown renderer — the same reasoning extends to json/csv/html. Diff is enabled
  whenever the active file's real computed diff is nonzero; images get no mode this
  phase (no renderer, no meaningful text source) and show an `EmptyState` instead.
- **Drag-and-drop "drop between two rows" targets their shared parent folder — same
  operation as "drop onto that folder" — rather than a persisted sibling position.**
  DESIGN-SPEC Amendments item 7 asks for an insertion-line affordance between rows for
  "precise placement," but a real git-backed filesystem has no field to store "this
  file is 3rd of 7 in its folder": `readTree`'s sibling order is derived (canonical
  demo order, then creation time — see `useFsStore.ts`), not stored per-file. The
  insertion line still renders (precision *feels* real while dragging), but the actual
  move is identical whether you drop between two rows or directly onto their folder.
  If per-file manual ordering becomes a real requirement later, it needs an explicit
  stored order field — recorded here rather than silently faked.
- **`FileKind` gained `js`/`jsx`/`html`, alongside `filetypes/registry.ts`.** Phase 3's
  brief ("ts/tsx, js/jsx, json, css, html, md, and csv-as-text") names three extensions
  `FileKind`/`useFsStore.inferFileKind` didn't recognize yet (they fell through to
  `unknown`). Rather than key the new registry by a second, parallel extension-string
  table, `FileKind` (already the single extension-derived type every store/component
  reads) grew three variants and `inferFileKind`'s switch gained the matching cases —
  "adding a file type = one entry" now holds for the registry *and* stays true to the
  rest of the module list, instead of only being true for the registry. No demo `.js`/
  `.jsx`/`.html` file was added to the seeded vault (DESIGN-SPEC §3's file list is
  exact); the new kinds activate the moment such a file exists (new-file creation,
  future seeding) without further plumbing.
- **The git gutter (Source mode) reflects the file as of its last save, not live
  keystrokes.** `editor/gitGutter.ts` is fed the exact same `useGitStore` diff-cache
  entry (`git/diff.ts`'s `diffFileVsHead`, itself reading from disk) that the `+12 -5`
  chip and status bar read — per this doc's own "Key flows" invariant ("numbers always
  agree"). `diffFileVsHead` compares disk content, so while a buffer is dirty (unsaved
  edits) the gutter shows the diff as of the last ⌘S, not the in-progress typing — the
  alternative (diffing the live CM6 buffer against HEAD directly) would routinely show
  the gutter disagreeing with the chip while a file is dirty, which is exactly what the
  single-source invariant rules out. The gutter, chip, and status bar all update
  together the instant ⌘S writes to fs and `useGitStore.refresh()` invalidates the
  cache — verified with Playwright: edit `indexer.ts`, save, and the gutter's
  added+modified marker count equals the chip's `+N` exactly (see
  `editor/gitGutter.ts`'s header comment for the full reasoning).
- **Diff mode's two documents (`editor/DiffView.tsx`) are fed to `@codemirror/merge`,
  which runs its own internal diff — a second, independent computation from
  `git/diff.ts`'s `lcsDiffFlags`-based one, not literally the same chunk data reused.**
  `@codemirror/merge`'s public API (`MergeView`, `unifiedMergeView`) only accepts two
  document strings and computes its own `Chunk[]` internally; there's no hook to hand it
  a precomputed diff. Both algorithms are still LCS/Myers-class minimal-edit-distance
  diffs over the *same* two inputs (HEAD content, on-disk working content — the same
  read `git/diff.ts` uses), so for real, non-pathological content the total added/
  removed line counts they report necessarily coincide even though the exact chunk
  *alignment* isn't guaranteed identical in every edge case. Verified empirically against
  the seeded `indexer.ts` diff (a near-total rewrite): chip `+20 -3` vs. the unified diff
  view's own `.cm-changedLine`/`.cm-deletedLine` counts on the working/HEAD sides — `20`
  and `3` respectively, an exact match, both before and after a live ⌘S-triggered edit.
- **The live-preview decoration set (`editor/livepreview/`) is provided from a
  `StateField`, not a `ViewPlugin`.** The first implementation used a `ViewPlugin`
  (decorations recomputed in `update()`, following the same shape as every other
  CM6 extension in this codebase) and crashed on mount with CM6's own
  `"Decorations that replace line breaks may not be specified via plugins"` —
  hiding a fenced-code fence line (marks *and* its trailing newline, so the line
  disappears instead of leaving a blank row) is a `Decoration.replace` that spans
  a line break, and CM6 only allows that from state-derived sources. Fixed by
  moving decoration computation into a `StateField<DecorationSet>` (provided via
  `EditorView.decorations.from(field, ...)`), which is exempt from the
  restriction since it's computed synchronously with the document rather than
  during view measurement. Confirmed fixed: no console/page errors on mount, and
  a fenced code block's fence lines collapse cleanly (see the Rendered-mode
  screenshots taken for the Phase 4 exit criteria).
- **Reveal-on-cursor is gated on DOM focus, not just selection overlap.**
  DESIGN-SPEC's Phase 4 exit criterion is explicit that blur — not just moving
  the selection elsewhere — re-hides a revealed span ("moving the cursor away
  (blur) re-renders it immediately"). Selection alone isn't enough: CM6 gives a
  freshly-created, unfocused `EditorState` a selection at document position 0 by
  default, which would otherwise permanently reveal the first heading's `#`
  before a user ever clicks into the note (confirmed empirically — the first
  cursor-reveal screenshot showed exactly this). `editor/livepreview/index.ts`
  tracks focus via `EditorView.focusChangeEffect` into the same `StateField`, and
  `plugin.ts`'s `overlapsSelection` short-circuits to "hidden" whenever
  `!focused`. Verified with Playwright: unfocused boot render is clean (matches
  `app-preview.png` exactly), clicking into `**append-only**` reveals only that
  span (`editorText` extracted from `.cm-content` showed every other heading/
  bullet/quote/code block untouched), and clicking a sidebar input (a real blur)
  restores the clean render immediately — both the screenshot and the extracted
  text before/after blur are identical to the never-focused baseline.
- **List bullet markers (`-`) are always hidden, not cursor-gated** — unlike
  headings/bold/italic/inline-code/links, which DESIGN-SPEC explicitly calls out
  as revealing at the cursor. A markdown list's `-` is structural formatting
  Obsidian itself keeps rendered as a bullet glyph even while the cursor sits in
  that list item's text; revealing raw `-` characters while editing bullet text
  would contradict "never dump ... raw text" for content the user isn't actually
  looking at. Ordered-list markers (`1.`, `2.`, …) are the one exception kept
  always-visible regardless of focus — they carry real sequence information a
  bullet glyph would destroy, confirmed via `@lezer/markdown`'s `ListMark` node
  covering the whole `"1."` token (not just a delimiter character) for
  `OrderedList` children.
- **`.html`/`.csv` default to Rendered mode; DESIGN-SPEC's Modes table only
  marks a default explicitly for `.md` (Rendered), `.json` (Source), and code
  (Source), leaving `.html`/`.csv` unmarked.** Resolved as "Rendered is the
  default whenever a renderer exists, unless the table explicitly names a
  different default" — html gets a live iframe preview and csv a `DataTable` by
  default, the same reasoning already applied to md, while json (a config
  format usually edited directly) and code keep the table's explicit Source
  default. `filetypes/registry.ts`'s module doc flags this interpretation
  inline; worth confirming against DESIGN-SPEC in review since the table's
  silence on those two rows is genuinely ambiguous rather than a clear "same as
  md" implication.
- **A file rename that changes extension now updates the open tab's `kind`
  (`useTabsStore.setKind`, called from `App.tsx`'s `handleRenameCommit`) — a
  pre-existing Phase 2 gap surfaced by Phase 4's renderer wiring.** Before this
  phase, `kind` staleness after a cross-extension rename only cost Source-mode
  syntax highlighting (CM6 language didn't update either, a latent bug of its
  own); now that `kind` also selects the Rendered-mode renderer and the set of
  enabled mode segments, a stale `kind` after renaming e.g. `untitled.md` to
  `notes.html` would silently keep routing to the live-preview markdown editor
  instead of the iframe preview. Fixed narrowly: `setKind` only fires for the
  exact file being renamed (never for a folder rename's remapped descendants,
  whose own filenames/extensions don't change), and resets `mode` to the new
  kind's default only if the tab's current mode isn't in the new kind's
  `modeAvailabilityFor` list. Verified with Playwright: create a file, rename it
  to `.html`, and both the status-bar language id and the Rendered segment
  (iframe showing real DOM content) update correctly.
- **Phase 4's renderers only got a live, in-browser Playwright pass for
  markdown/csv/json/image/html; `.html` needed a hand-created demo file since
  the seeded vault has none (ARCHITECTURE.md's Phase 3 Deviations note already
  records why: no demo `.js`/`.jsx`/`.html` file was added to the seed).**
  Exercised by creating a file via the Explorer's "New file" action, renaming
  it to `preview-test.html` (see the `setKind` fix above, which this same test
  exposed), typing a small HTML document in Source mode, and switching to
  Rendered — the sandboxed iframe (`sandbox=""`, `srcDoc`) rendered the real
  heading/paragraph with its own isolated dark styling, confirming both the
  renderer and the sandbox attribute are wired correctly end-to-end.
- **`<Toaster>` was mounted as a sibling of `<App>` (`main.tsx`) since Phase 1's
  scaffold, not a wrapper — a latent bug invisible until Phase 5a became the
  first code to call `useToast()`.** `node_modules/my-you-eye/dist/index.js`
  shows `Toaster` *is* `ToastContext.Provider` itself (`{children, [rendered
  toasts + viewport]}`), so it must wrap whatever calls `useToast()`, not sit
  next to it — confirmed by the exact runtime error the first Playwright boot
  of the sync/reset-vault toasts threw: `"useToast must be used within
  <Toaster />"`, thrown from `App` despite `<Toaster />` being right there in
  the tree, just as an unrelated sibling. Fixed by nesting `<App />` inside
  `<Toaster>` in `main.tsx`; `TooltipProvider` still wraps both, unaffected.
- **The Settings dialog's theme switcher needed `src/theme.css` restructured
  from one unconditional `.dark { ... }` block into two** (Phase 5a,
  DESIGN-SPEC "Misc / settings" + SKILL.md "Trust the theme"): a boot-default
  block (pixel-sampled hex, scoped to `data-theme` unset or `"dark"`) and a
  theme-agnostic block deriving every `--app-*`/`--git-*`/`--markdown-*`
  app-only token from the library's own theme-varying `--color-*` tokens
  (`--app-editor-bg` via `color-mix`, since no single library token matches
  this app's third, darker-than-`--color-bg` content depth). Needed because
  the original single block redefined every token unconditionally on `.dark`,
  so setting `data-theme="neon"` (etc.) would change nothing this app's own
  components actually render with — confirmed by reading the library's theme
  files (`node_modules/my-you-eye/dist/themes/*.css`, each a plain
  `[data-theme="X"]`/`[data-theme="X"].dark` selector in `@layer(theme)`) and
  verifying with Playwright: `data-theme="neon"` after a Settings change now
  measurably changes `--app-chrome-bg`'s computed value, while an unset/
  `"dark"` `data-theme` (boot, or explicitly re-selecting "Dark (Slate
  default)") stays pixel-identical to every phase before this one.
- **`LivePreviewEditor.tsx`'s new font-size `Compartment` needed
  `Prec.highest`, not just array position, to beat `livepreview/theme.ts`'s
  own hardcoded `&{fontSize: "17px"}` rule** — verified empirically: ordering
  the compartment's extension *after* `livePreviewExtensions` in the array
  (the natural first attempt, reasoning by analogy with a plain stylesheet's
  cascade) did not win the same-specificity tie, since CM6's `StyleModule`
  doesn't resolve two separate `EditorView.theme()` calls' identical-
  specificity rules by extension-registration order. Wrapping in
  `Prec.highest(...)` fixed it and (CM6's documented pattern) survives every
  later `.reconfigure()` too.
- **Wiring that same font-size setting straight through to Rendered mode was
  a real regression, caught by Phase 5a's own verification, not shipped**:
  at the setting's own default (13, tuned for Source mode's monospace code
  size), it silently shrank Rendered's carefully-tuned 17px prose size on
  every fresh boot — visibly off `app-preview.png`, and (worse) enough to
  shift the live-preview reveal decorations' pixel geometry that a scripted
  click at a coordinate computed from the live (regressed) page landed on a
  completely different line than intended. Caught by comparing the exact
  same click coordinates against a from-scratch build of the pre-Phase-5a
  commit (`git worktree add ... a9112df`) in a second `vite preview`
  instance — the two builds' `.cm-content` DOM (`innerHTML`, byte-for-byte)
  disagreed only because of this. Fixed by applying the setting as an
  *offset* from Rendered's own 17px base (`17 + (fontSize - 13)`,
  `LivePreviewEditor.tsx`'s `renderedFontSize`) instead of the raw value, so
  the unconfigured-default boot state is pixel-identical to Phase 4 while the
  slider still visibly scales Rendered up/down by the same delta it applies
  to Source. `DEFAULT_EDITOR_FONT_SIZE` (13) is now exported from
  `useSettingsStore.ts` so the two files don't duplicate that literal.
- **A search result's "open the file at that line" (Phase 5a's Search
  activity view) needed to distinguish "no CM6 view registered yet" from
  "still reading the outgoing view that's about to be torn down," not just
  poll `editor/activeView.ts`'s `getActiveEditorView()` until it's
  non-null.** `CodeMirrorEditor` is `React.lazy`-loaded
  (`EditorContent.tsx`); switching a file from Rendered to Source mode for
  the first time in a session means that chunk hasn't downloaded yet, so the
  outgoing `LivePreviewEditor`'s view (confirmed via a temporary debug trace:
  `hasView: true`, but no `.cm-gutters` in its DOM, i.e. definitely not
  `CodeMirrorEditor`'s view) stays the one thing registered for the whole
  time React's `<Suspense>` fallback is showing — a same-tick or next-`rAF`
  read reliably grabbed that stale view and dispatched the line-jump to it
  for nothing (cursor stayed at Ln 1, Col 1). Fixed in `App.tsx`:
  `handleSearchOpenResult` snapshots whatever view is registered *before*
  requesting the jump (`pendingJumpStaleView`), and the polling effect
  requires a *different* view to show up (falling back to "whatever's
  registered" once its ~1s attempt budget runs out, which also correctly
  covers the no-remount-needed case, where stale and final are the same
  object by design). Verified for both the same-tab mode-switch path
  (Rendered→Source on the already-active file) and the cross-tab path
  (jumping into a different, not-yet-open file).
- **`vite-plugin-pwa`'s default `injectRegister: 'auto'` does not implement
  `registerType: 'autoUpdate'`'s documented "no stale index.html after a
  deploy" behavior at all — it only injects a bare
  `navigator.serviceWorker.register('/sw.js')` call with zero update-
  detection logic.** IMPLEMENTATION-PLAN.md Phase 5's PWA bullet ("cache
  strategy must never serve a stale index.html after a deploy (standard
  autoUpdate registration)") reads as if setting `registerType: 'autoUpdate'`
  alone is sufficient; it isn't — that option only changes which template
  the `virtual:pwa-register` *client* module generates
  (`node_modules/vite-plugin-pwa/dist/client/build/register.js`: an `auto`
  branch that listens for the SW's `activated` event and calls
  `window.location.reload()` itself with no prompt, vs. a `prompt` branch
  that waits for the app to call `updateServiceWorker()`). Nothing calls
  that module at all under the default `injectRegister: 'auto'` bare
  snippet, so `registerType` had no observable effect. Caught empirically,
  not by reading docs first: a Playwright repro that rebuilt the app while
  a tab stayed open, then reloaded that tab once, kept loading the OLD
  bundle (`scriptSrc` unchanged, a build-time `console.info` marker never
  fired) — the new service worker had installed and activated in the
  background (`clientsClaim`/`skipWaiting` both fired correctly), but
  nothing ever told the open page to reload onto it. Fixed by setting
  `injectRegister: false` (`vite.config.ts`) and explicitly registering via
  `import { registerSW } from "virtual:pwa-register"` in `src/main.tsx`
  (`registerSW({ immediate: true, onRegisteredSW })`), which pulls in the
  real `workbox-window`-backed client with the `autoUpdate` reload listener.
  A second, related gap the same repro surfaced: this app is a long-lived
  SPA tab that may never navigate again on its own, and a browser's
  automatic "check sw.js for changes" step is tied to registration/
  navigation, not a background timer — so `onRegisteredSW` also starts an
  hourly `registration.update()` poll, otherwise a tab left open for days
  would never notice a deploy at all. Verified with Playwright: rebuild
  while a tab is open, force one update check (`registration.update()`,
  standing in for the hourly poll so the test doesn't wait an hour), and
  the tab reloads itself with NO manual reload from the test — new script
  hash, new build marker in the console, zero manual intervention. Also
  confirmed (same script family) that `context.setOffline(true)` + reload
  renders the full app shell with zero console errors, and that
  `navigator.storage.persist()` is called exactly once at boot regardless
  of outcome (stubbed both `true`/`false` via `page.addInitScript`).
- **The naive `globPatterns: "**\/*.{js,css,html,...}"` precached all
  ~1250 of `materialIconLoader.ts`'s `import.meta.glob` per-icon chunks —
  1315 precache entries, 3.4MB — even though that loader's entire design
  (see its own header comment, `FileIcon.tsx`'s two-tier doc, and the
  `FileIcon` row in `docs/COMPONENT-BACKLOG.md`) exists specifically so a
  cold boot never fetches that pack.** Caught in review (a peer session
  measured the settled Cache Storage total, not just page-load
  `networkidle` bytes — a real blind spot in this doc's own earlier
  "cold boot payload" measurement recipe, which stops listening before a
  service worker's background precache install is observable at all).
  Unconditional precaching defeated the loader's entire reason to exist,
  and spent ~1300 Cache Storage entries of the very origin quota
  `navigator.storage.persist()` (this same phase) is meant to protect on
  icons that tier is designed to almost never fetch. Fixed with a
  `manifestTransforms` filter in `vite.config.ts`: `computeExcludedIconChunkNames()`
  reads the *actual installed* `material-icon-theme` package's icon
  directory and `materialIcons.curated.ts`'s real import specifiers (not a
  hardcoded count) to compute "every icon name NOT in the curated ~96",
  plus the two full-manifest chunks (`materialIconLoader`, the ~450KB
  `material-icons.json` chunk) — and drops precache entries whose
  build-output basename (hash stripped via a small regex) is in that set.
  Every curated icon (the ones the demo vault's own tree/tabs actually
  render), every lazy view/panel chunk (`SettingsView` — Phase 6.5c's tab
  replacement for the earlier `SettingsDialog`, `SearchPanel`, `DiffView`,
  `CsvTable`, `JsonView`, `HtmlPreview`, `ImageView`, `CodeMirrorEditor`),
  and every CM6 per-language highlighter chunk (Source
  mode needs to work offline for any vault file type, not just the boot
  file) stay precached — this is a real, if smaller than initially built,
  app-shell cache, not `NetworkOnly`. Verified: precache dropped to 134
  manifest entries / 129 unique Cache Storage entries at ~1.55MB (measured
  via `caches.open(name).keys()` + summing each cached response's real
  blob size after `navigator.serviceWorker.ready` — the deterministic sync
  point, since Workbox's precache write runs inside `install`, which must
  finish before `activate`/`ready` can fire); a fresh-context
  `context.setOffline(true)` cold boot still rendered the complete UI
  (Explorer, branch, the default file's Rendered markdown) with zero
  console errors; the rebuild-doesn't-serve-stale-index.html repro above
  still passed unchanged. `vite.config.ts`'s Node-side helper needed
  `@types/node` added as a devDependency (`tsconfig.node.json` gained
  `"types": ["node"]`) — this repo's `vite.config.ts` had never touched a
  Node builtin before this phase.
- **DESIGN-SPEC Amendments item 16's typing-latency bug had FOUR real,
  independently-confirmed causes on the React side, plus one avoidable
  redundant-work cost inside the CM6 mount components — but NOT the
  decoration-recompute breadth the spec's own suspect list led with.**
  Diagnosed with a temporary render-count probe (`lib/renderProbe.ts`, kept
  permanently as a standing regression guard — inert unless a script sets
  `window.__renderProbeEnabled = true` before `page.goto`) plus a
  `setTimeout(fn, 0)`-based main-thread-blocked-time sampler (NOT
  `requestAnimationFrame`, which is coupled to the display's vsync/paint
  cycle and so reports a ~16.6-16.7ms gap on every frame even when the page
  is completely idle — confirmed empirically, a first attempt at this
  harness flagged ~100% of frames as "over 16ms" before any typing even
  started; a macrotask-queued `setTimeout(0)` self-rescheduling loop has no
  such floor and directly measures blocked time) against a 1000-line
  synthetic markdown doc typed continuously in Rendered mode:
  1. **`App.tsx`'s cursor position was lifted into `useState` (`cursorByPane`)
     and threaded down through `EditorArea`/`EditorPane`'s `onCursorChange`
     prop.** Every keystroke in EVERY mode — including Rendered, where the
     value is gated off and never displayed (`StatusBar.tsx` only shows
     Ln/Col for Source/Diff) — called `setState` on `App`, re-rendering the
     entire shell (Sidebar's file tree, the activity bar, every mounted
     `EditorPane`) once per keystroke. Confirmed via the render probe:
     `App`'s render count tracked keystrokes 1:1 (60 renders for 60
     keystrokes) before the fix. Fixed by moving cursor position into its
     own tiny store (`stores/useCursorStore.ts`) that `EditorPane` writes to
     directly (no prop, it already knows its own `paneId`) and that
     `StatusBar.tsx` reads via a targeted `s.byPane[activePaneId]` selector
     — `App` never sees cursor updates at all now (render count: 0 during a
     60-keystroke burst).
  2. **`App.tsx` also called `useFsStore()` and `useBufferStore()` with NO
     selector** — the zustand anti-pattern of subscribing to an entire
     store, which re-renders on ANY change to ANY field in it. Neither
     `fs` nor `buffers` was ever read for anything actually rendered in
     `App` (only for imperative action calls inside event handlers like
     `fs.createFile(...)`, `buffers.rekeyPrefix(...)`), but `buffers`
     changes on every keystroke (`useBufferStore.setContent`) — so this
     alone re-rendered the whole shell once per keystroke even AFTER cursor
     state was fixed (confirmed: render count stayed 60 until this was also
     fixed). Every call site now reads `useFsStore.getState()`/
     `useBufferStore.getState()` directly instead of subscribing.
  3. **`EditorPane.tsx` subscribed to `useBufferStore((s) => s.buffers)`**
     (the whole map again) just to read ITS OWN tabs' `dirty` flags for the
     tab bar — so every pane's `EditorPane` re-rendered on every keystroke
     typed into ANY open buffer in ANY pane, not just its own. Fixed with a
     `useShallow`-wrapped selector reading only `{path: dirty}` for this
     pane's own tabs — since a buffer's `dirty` flag flips false->true on
     the FIRST keystroke and then never changes again while typing
     continues, this selector now causes zero re-renders across a whole
     typing burst rather than one per keystroke.
  4. **Draft checkpointing (`fs/drafts.ts`) was debounced but not
     idle-scheduled** — the actual `writeFile`/`pfs.flush()` work ran
     directly inside the `setTimeout(..., 300)` debounce callback, an
     ordinary macrotask with no guarantee the main thread was actually
     free, competing with input handling if the user resumed typing right
     as it fired. Fixed: the debounce still fires at 300ms (unchanged
     coalescing behavior), but now hands the actual write to
     `requestIdleCallback` (with a 500ms `timeout` so a continuously-busy
     tab still checkpoints, and a bare `setTimeout(fn, 0)` fallback for
     browsers without `requestIdleCallback`, e.g. Safari at time of
     writing) instead of running inline. Verified this doesn't reopen the
     "reload loses unsaved work" gap the `pfs.flush()` fix above closed:
     `flushDraftSave` (the `visibilitychange` safety net's escape hatch)
     cancels both the debounce timer AND the pending idle handle before
     writing immediately, so a tab closing mid-idle-wait still flushes
     synchronously.
  5. **`LivePreviewEditor.tsx`/`CodeMirrorEditor.tsx` each paid for TWO full
     `doc.toString()` calls (plus a full string-equality check) per
     keystroke on a large document** — one in the `updateListener` to hand
     the new content to `onChange`, and a second, redundant one in the
     content-sync effect that fires right after (triggered by that same
     content round-tripping back down through `useBufferStore`), which
     re-serialized the identical document just to confirm it already
     matched what had just been emitted. Fixed with a `lastEmittedRef` that
     remembers the exact string just emitted; the content-sync effect skips
     its `doc.toString()` + comparison entirely whenever the incoming
     `content` prop is recognizably that same echo, while still running the
     full check (needed for correctness) whenever content changes for any
     OTHER reason — a second pane editing the same shared buffer, a
     discard, an external rename-driven reload. Verified this doesn't break
     the multi-pane shared-buffer mechanism: `tests/e2e/split-grid.spec.ts`'s
     "same file source|rendered in two panes shares one buffer" test (which
     types a marker in one pane and asserts it appears in the other) still
     passes unchanged.
  6. **The decoration-recompute breadth suspect the spec's own list led
     with was investigated and NOT confirmed as a significant contributor
     at this document size** — `editor/livepreview/plugin.ts`'s
     `buildLivePreviewDecorations` does walk the ENTIRE `@lezer/markdown`
     syntax tree via an unbounded `syntaxTree(state).iterate()` on every
     `docChanged`/selection-changed transaction, which is a real,
     legitimate O(document size) cost per keystroke and does NOT scale —
     this is flagged here as a genuine future optimization candidate (the
     standard fix: bound the `iterate({from, to})` call to the union of the
     transaction's changed ranges + old/new selection, each fully expanded
     by Lezer's own "any node overlapping the range is visited in full"
     semantics so multi-line constructs like blockquotes/fenced code still
     decorate completely correctly, then stitch the previous decoration set
     — mapped through `tr.changes` — back in outside that window via
     `RangeSet.update({filterFrom, filterTo, filter: () => false, add})`).
     It was deliberately NOT implemented this phase: a diagnostic run that
     bypassed the decoration rebuild entirely (`return { focused, deco:
     value.deco.map(tr.changes) }`) on the same 1000-line document showed
     NO measurable improvement over the noise floor of this measurement
     environment (a shared, ARM64 cloud host — repeated runs of the SAME
     build varied by ±15 keystrokes-over-16ms out of 60 just from run-to-run
     jitter), while items 1-5 above collectively cut the blocked-frame count
     roughly in half and eliminated `App`'s per-keystroke re-render
     entirely (a deterministic, noise-free result). Implementing an
     incremental rewrite of the reveal/hide decoration logic without clear
     evidence it's the actual bottleneck would have added real correctness
     risk to DESIGN-SPEC's cursor-reveal contract (the exact `**…**` pair
     COUNT assertions in `tests/e2e/live-preview.spec.ts`) for an
     unconfirmed win — left as-is, worth revisiting with real hardware
     profiling (not a shared cloud VM under a `PerformanceObserver`
     `longtask`/`setTimeout(0)` proxy) if a much larger document than 1000
     lines is ever a real usage pattern.
- **The VSCode-style find widget (Phase 6.5b, DESIGN-SPEC Amendments item 9)
  overlays instead of pushing content down by exploiting two CM6 base-theme
  facts read straight out of `node_modules/@codemirror/view/dist/index.js`
  and `node_modules/@codemirror/search/dist/index.js`, not by fighting CM6's
  panel layout.** (1) `searchHighlighter`'s `highlight({query, panel})`
  returns `Decoration.none` whenever `panel` is falsy — native
  `.cm-searchMatch` highlighting is gated on a `Panel` existing at all, not
  on its DOM shape, which is what makes replacing the panel's markup entirely
  (via `SearchConfig.createPanel`) safe: `editor/findPanel.ts`'s
  `createFindPanel` still returns a real `Panel`, so highlighting is
  untouched. (2) `.cm-editor` is `position: relative !important` (CM6's own
  base theme) and the `.cm-panels` container CM6 mounts `dom` into is
  `position: sticky` — both valid containing blocks for an absolutely-
  positioned child. Setting the panel's own `dom` to `position: absolute`
  pulls it out of `.cm-editor`'s flex-column flow entirely (an absolutely-
  positioned box contributes zero size to its flex parent), so `.cm-panels`
  collapses to zero height and the scroller never shifts, while the card
  still visually anchors to the editor's own top-right corner via that
  `position: relative` ancestor — no portal, no extra wrapper measuring the
  editor's bounding rect by hand. Verified with Playwright: the `.cm-content`
  bounding rect is pixel-identical immediately before vs. after opening find
  in `tests/e2e/find-widget.spec.ts`.
- **The find widget's own React root is a SEPARATE `createRoot()` call
  (`editor/findPanel.ts`'s `Panel.mount()`), not a component inside the
  app's main tree.** DESIGN-SPEC Amendments item 16's perf contract ("a
  keystroke must not re-render the React shell") extends naturally to
  typing into the find/replace inputs too — since `FindWidget` lives in its
  own root, every keystroke there re-renders only that isolated tree, never
  `App`/`EditorPane`. Confirmed via the render probe: typing a query while
  find is open leaves `App`'s render count at 0, same as a normal editor
  keystroke burst.
- **That same separate React root has no `<TooltipProvider>` — a real bug
  caught only via `page.on("pageerror")` during Playwright verification,
  not visible from the DOM alone.** `main.tsx` wraps `<App>` in one
  `TooltipProvider`; `FindWidget`'s `createRoot()` call
  (`editor/findPanel.ts`'s `Panel.mount()`) is a second, independent root
  outside that tree entirely, so `FindWidget`'s `Tooltip` usages (every
  toggle/nav/replace icon button) threw `"Tooltip must be used within
  TooltipProvider"` on mount — an uncaught render error with no error
  boundary anywhere in this second root to catch it, so React silently
  unmounted the whole widget. The symptom this produced was misleading:
  every `getByTestId("find-widget")` assertion in
  `tests/e2e/find-widget.spec.ts` failed with "element not found," which
  reads like a wiring bug (wrong `createPanel`, panel never opening), not a
  context bug — the panel's own `.cm-slate-find-panel` DOM node WAS present
  (confirmed by locating it directly), it just rendered nothing inside.
  Fixed by wrapping `FindWidget` in the library's own `<TooltipProvider>`
  inside `Panel.mount()`'s `root.render(...)` call — cheap (no extra
  network/bundle cost; `TooltipProvider` is already loaded, since the app's
  own root uses it) and scoped to exactly the tree that needs it.
- **Diff mode's unified/split toggle (DESIGN-SPEC Amendments item 13) moved
  from `editor/DiffView.tsx`'s own `useState` into `EditorPane.tsx`, which
  is a small, deliberate behavior change worth recording: the layout
  preference is now per-PANE, not per-file.** Previously `DiffView`
  remounted (and its `layout` state reset to `"split"`) every time the
  active file changed, since `EditorContent.tsx` keys it by `path`. Lifting
  `diffLayout` to `EditorPane` so `EditorHeader`'s icon-only
  `SegmentedControl` can sit next to the mode toggle (the spec's explicit
  placement) means that reset no longer happens — flipping between several
  diffs in the same pane keeps whichever layout was last picked. Treated as
  a UX improvement ("my preference sticks") rather than a regression; noted
  here since it's an observable behavior change from before this phase.
- **Right-click → Rename never focused the inline `<Input>` — a real bug
  the Phase 7 suite's own comment flagged without fixing (`tests/e2e/fs-
  git.spec.ts`'s rename test used `.fill()` specifically to sidestep it).**
  `App.tsx`'s `handleRequestRename` is a synchronous `setRenamingId` call,
  so `ExplorerTree.tsx`'s row re-renders with the rename `<Input>` mounted
  (previously relying on its `autoFocus` prop) in the SAME tick Radix's
  `ContextMenu` returns focus to its own trigger (this row) as part of ITS
  OWN close lifecycle — a real focus race, and Radix's own
  `requestAnimationFrame`-scheduled focus-restore was winning it often
  enough to matter. ("New File" only ever worked by accident, AT THE TIME:
  `handleCreateFile` `await`ed `fs.createFile()` before setting
  `renamingId`, which pushed the input's mount well past Radix's
  focus-return window entirely — no longer true as of DESIGN-SPEC
  Amendments round 4 item 30, which made `handleCreateFile` synchronous
  (an in-memory draft row, no fs write until a real name is committed —
  see `App.tsx`'s `insertDraftNode` doc); "New File" is now ALSO same-tick
  with the menu closing, same as Rename always was, which is fine because
  the fix below never depended on which flow triggered it.) Fixed in
  `ExplorerTree.tsx`'s `TreeRow` by
  replacing `autoFocus` with an imperative `useEffect` that defers the
  actual `.focus()`/`.select()` call to a `setTimeout(fn, 0)` macrotask:
  since rAF callbacks always run before the next macrotask is picked off
  the queue, this reliably fires after Radix is done fighting for focus,
  regardless of exactly when either side's own effect happens to run within
  that cycle. Verified with a Playwright repro that right-clicks Rename and
  types immediately via `page.keyboard.type()` — no `.fill()` workaround,
  no extra click — in `tests/e2e/fs-git.spec.ts`.
- **The Settings view (Phase 6.5c, DESIGN-SPEC Amendments item 11) fits into
  `useTabsStore`'s existing "content keyed by FILE, view state per PANE"
  shape with a zero-width change to `OpenTab`, by treating it as a file
  whose "content" happens not to live on disk.** `OpenTab` already only
  needed `path`/`name`/`kind` (plus `mode`/`preview`/`pinned`, none of which
  the Settings tab uses meaningfully) — a virtual, never-real path
  (`lib/settingsTab.ts`'s `SETTINGS_TAB_PATH = "settings"`, deliberately not
  `vault/`-prefixed, the one prefix every real `fs/`/`git/` call expects per
  `fs/paths.ts`) plus a new `FileKind = "settings"` was enough. The two
  places that would otherwise treat it like a real file are guarded
  narrowly rather than reworked: `EditorPane.tsx`'s buffer-load/diff-fetch
  effects skip `kind === "settings"` (no fs content, no diff, would
  otherwise mark it spuriously "missing"), and `filetypes/registry.ts`'s
  `modeAvailabilityFor` returns `[]` for it (same treatment as
  "folder"/no-kind) so `EditorPane.tsx` knows to hide the Rendered/Source/
  Diff header entirely rather than show an all-disabled segmented control.
  Because it's a plain tab, the tab-tree's existing `persist` middleware
  restores an open Settings tab across a reload for free — no new
  persistence code was needed, confirmed by reloading with the tab open and
  it reopening still selected. `EditorContent.tsx`'s `kind === "settings"`
  branch is checked before any mode/loaded/missing logic runs, mirroring
  how the pre-existing `kind === "image"` branch already short-circuits
  that same function for a different "not really file-shaped content" case.
- **Two settings-driven CM6 layout properties (`.cm-scroller`'s
  `line-height` for Source/Diff, and `.cm-content`'s `max-width`/`padding` +
  `.cm-scroller`'s `line-height` for Rendered) were made reconfigurable by
  DELETING the hardcoded static rule, not by adding a second, higher-
  precedence one.** The established pattern for a live-reconfigurable CM6
  style value in this codebase (`editorFontSize`'s `fontSizeCompartment`,
  Phase 5a) needed `Prec.highest` specifically because a competing static
  `EditorView.theme()` rule for the exact same property already existed
  (`livepreview/theme.ts`'s old `"&": {fontSize: "17px"}}`) and CM6's
  `StyleModule` doesn't resolve two same-specificity `EditorView.theme()`
  calls by array/registration order the way a plain stylesheet would (see
  this doc's own earlier entry on that). Phase 6.5c's three new settings
  (`editorLineSpacing`, `renderedContentWidth`/`renderedMargin`,
  `renderedLineSpacing`) sidestep that precedence question entirely: the
  properties they control were simply removed from `editor/theme.ts`'s and
  `editor/livepreview/theme.ts`'s static blocks (previously the only place
  those properties were set at all), so the new `lineHeightCompartment`
  (`editor/baseExtensions.ts`) / `renderedLayoutCompartment`
  (`editor/LivePreviewEditor.tsx`) become the SOLE source with nothing left
  to out-rank. Confirmed no visual regression at each setting's default
  (`DEFAULT_EDITOR_LINE_SPACING = 1.6`, `DEFAULT_RENDERED_CONTENT_WIDTH_CH =
  54`, `DEFAULT_RENDERED_MARGIN_PX = 32`, `DEFAULT_RENDERED_LINE_SPACING =
  1.8` — every one copied verbatim from the value it replaced) by comparing
  a fresh boot's Rendered-mode screenshot against the pre-6.5c baseline.
- **`fs/seed.ts`'s Phase 6.5c `metrics.csv` regeneration (DESIGN-SPEC
  Amendments item 15) keeps the working-tree `M` status via the same
  mechanism the original toy fixture used — HEAD content and WORKING
  content are simply different strings — not by preserving any particular
  value.** `generateMetricsCsv(variant)` is one deterministic (no
  `Math.random()`) generator called twice, `"head"` (40 rows, committed)
  and `"working"` (42 rows plus a small per-row price delta, written
  uncommitted); the row-count AND price differences are both real, so the
  two outputs can never accidentally collide even if one delta were
  changed later. `vault.config.json`'s deep-nesting rewrite (same change)
  needed no equivalent care — it was never part of the working-tree diff
  set to begin with (committed once, untouched), so there is no git-status
  invariant riding on its exact content, only that it stays valid JSON
  (checked with `JSON.parse`). Neither file's own git-status letter is
  hardcoded anywhere; both are recomputed live by `git/status.ts`'s real
  `statusMatrix()` walk, so this change was verified correct the same way
  the original seed was: `npm test`'s `fs-git.spec.ts` (`metrics.csv`'s `M`,
  6 changed files, 1 untracked) and `diffStat.test.ts`
  (`architecture.md`'s exact +12/-5, untouched by this change) passing
  unmodified.
- **(Phase 8) The library-theme "texture is invisible" bug (DESIGN-SPEC
  Amendments round 3 item 22(a)) had THREE independent causes stacked on
  each other, and the first fix attempted here was measured to do nothing
  at all — it shipped green only because its own test could not fail.**
  Recorded in full because the failure mode (a green suite over a provably
  broken feature) matters more than the fix.
  Cause 1 (the brief's own lead, confirmed by reading the shipped CSS):
  every `node_modules/my-you-eye/dist/themes/*.css` is imported
  `layer(theme)` (`dist/styles.css`), while `src/index.css`'s `body {
  background-color: var(--app-chrome-bg); }` is UNLAYERED — an unlayered
  rule beats a layered one regardless of specificity, so `body`'s opaque
  fill unconditionally won over `html[data-theme="metallic"] body {
  background-color: transparent; }`.
  Cause 2 (visible only in the rendered page, not the CSS source): even a
  fully transparent `body` shows nothing, because this app's shell tiles
  the ENTIRE viewport edge-to-edge with its own opaque `--app-*-bg` fills;
  there is no gap for the theme's `html::before` texture (`z-index: -1`)
  to show through.
  THE FIRST FIX WAS WRONG. It made the four `--app-*-bg` tokens themselves
  translucent (`color-mix(in oklab, ... 86%, transparent)`) so the texture
  would "bleed through," and shipped with a test asserting fractional alpha
  plus `lumaStdDev > 3` over the ACTIVITY BAR — a region full of icons,
  whose antialiased glyph edges satisfy that threshold whether or not any
  texture exists. Independent re-measurement (orchestrator verification,
  screenshots of five text-free chrome regions decoded with PIL) found luma
  std-dev **0.000 and exactly 1 distinct luma level** in the activity bar,
  editor, sidebar, title bar AND status bar under `metallic` — i.e. a
  perfectly flat fill, zero texture anywhere — against std-dev ~9.0-9.9 /
  ~50-62 levels for the theme's own raw `html` + `html::before` canvas
  measured with the app's DOM hidden. Cause 3 explains why: the real paint
  stack over the editor is FOUR independently-translucent layers
  (`.cm-editor` 0.88 → the editor-pane div 0.88 → the shell root 0.86 →
  `body` 0.86) over an opaque `html`, so transmission compounds
  multiplicatively to `(1-0.88)(1-0.88)(1-0.86)(1-0.86) ≈ 0.00028` — 0.03%.
  Even the shallowest region (activity bar, two 0.86 layers) transmits ~2%,
  ~0.19 luma against a texture of amplitude ~9.7, which rounds away to
  nothing. No alpha value fixes this: raising it enough to transmit texture
  also washes out the four hand-sampled surface depths that are the whole
  point of the Slate palette.
  ACTUAL FIX: each surface paints the theme's own texture directly on
  itself via the library's `TexturedSurface` (`texture="theme"`, which
  reads `--texture-type`/`--texture-opacity-surface`/`--texture-blend` off
  the document), composed as an absolutely-positioned `pointer-events:
  none`, `z-index: -1` sibling behind each region's real content in
  `local/TitleBar.tsx`, `local/ActivityBar.tsx`, `local/StatusBar.tsx`,
  `local/SidebarContainer.tsx` and `EditorPane.tsx`. Each host element gets
  `position: relative` + `isolation: isolate` — without `isolation` a
  negative-z-index child escapes behind the nearest ancestor stacking
  context and stops compositing over its own surface's fill. The four
  `--app-*-bg` tokens therefore go back to fully OPAQUE (the exact
  pre-item-22(a) values), since nothing needs to transmit through anything
  any more. One extra token was needed: CodeMirror paints its own `&`/
  `.cm-gutters` background over `EditorPane`'s texture layer, so
  `editor/theme.ts` and `editor/livepreview/theme.ts` read
  `--app-editor-canvas-bg`, which is `transparent` under every theme except
  Slate (where it stays the exact opaque `#101318`, a boot regression gate).
  A fourth, smaller cause surfaced while verifying: some themes' DARK
  variants never override `--texture-blend`, leaving light-mode `multiply`
  in place, which is nearly a no-op on near-black chrome — comic measured
  std-dev 0.32 that way, versus metallic (whose own dark block switches to
  `screen`) at ~8. `src/theme.css`'s `.dark` block now sets
  `--texture-blend: screen` for dark mode generally; Slate is unaffected
  because its `--texture-opacity-surface` is 0, so nothing paints regardless.
  Final independent measurement, metallic, all five text-free chrome
  regions: std-dev 7.35-8.01 with 38-42 distinct luma levels (was
  0.000 / 1), while Slate/boot stays flat and exact-hex.
  THE TEST WAS ALSO FIXED, not just kept green: `tests/e2e/theme-compat.spec.ts`
  now derives two genuinely text-free regions from live element boxes (the
  sidebar below the tree, the editor's lower-right outside the prose
  column), asserts under Slate that they are dead flat — which is what
  proves they contain no text, failing loudly if a glyph ever creeps in —
  and asserts under each theme BOTH std-dev >= 2 AND >= 8 distinct luma
  levels (`distinctLumaLevels`, `tests/e2e/pngPixels.ts`; the second half
  is what a single hard edge cannot fake). Verified to fail against the
  translucency build and pass against this one.
- **(Phase 8) `--color-primary` is the WRONG per-theme signal to test CM6
  syntax colors against, because it's deliberately theme-invariant by
  design** — `useSettingsStore.ts`'s `applyDomSettings` sets
  `--color-primary`/`--color-ring` as an INLINE style on `<html>` (the
  user's chosen accent color), and an inline style beats every selector-
  based rule in the cascade regardless of specificity, `!important` aside.
  That's correct, intentional behavior (the accent setting is supposed to
  override every theme's own primary color) — but it means
  `--syntax-keyword`/`--syntax-function` (both derived from
  `--color-primary`) never actually change value when `data-theme` changes,
  which looked like a real bug in `theme-compat.spec.ts`'s first draft (a
  metallic-vs-Slate comparison on `--syntax-keyword` failed with "expected
  not to equal, but did") before this was understood. Fixed the TEST, not
  the tokens: `--syntax-type` (derived from `--color-warning`, which has no
  such override) is the one asserted to change per theme; `--syntax-
  keyword`/`--syntax-function` staying pinned to the accent color across
  every theme is correct, matching behavior, recorded here so it isn't
  "fixed" again by mistake later.
- **(Phase 8) DESIGN-SPEC Amendments round 3 item 18 ("Header
  consolidation") needed the Diff-mode unified/split layout preference
  moved OUT of `EditorPane.tsx`'s local `useState` and into
  `useTabsStore.ts`'s `PaneLeaf.diffLayout`, because the title bar
  (`App.tsx`/`components/TitleBar.tsx`) now needs to read AND write that
  same preference for whatever pane is focused — a plain React `useState`
  local to one `EditorPane` instance is invisible to a sibling component
  that isn't its parent.** This is a deliberately narrow, low-frequency
  piece of state (changes only on an explicit toggle click, never per
  keystroke), so lifting it into the existing pane-tree store — rather than
  inventing a THIRD tiny per-pane store alongside `useCursorStore` — was the
  simplest fix that didn't reopen DESIGN-SPEC Amendments item 16's "don't
  lift per-keystroke state into a shared store/App" constraint (this isn't
  per-keystroke state, so the constraint doesn't apply, but it's worth
  recording the reasoning explicitly: `useCursorStore` exists specifically
  because ITS state changes on every keystroke and needed complete
  isolation from React re-render cascades; `diffLayout` has no such
  frequency problem, so folding it into the already-`persist`ed tabs store
  — which now also, as a side effect, persists diffLayout across a reload
  for the first time, previously lost on every remount — was the right
  amount of engineering, not under- or over-built). The single-pane vs.
  multi-pane header split itself (`EditorPane.tsx`'s new `multiPane` prop,
  computed once in `EditorArea.tsx` via `collectLeaves(tree).length > 1`)
  reuses the exact tree-walking helper the split-grid feature already
  exported, so "how many panes are open" has one authoritative definition
  shared by both features instead of two ways to (potentially inconsistently)
  count the same tree.

  **Why this doesn't reopen item 16's typing-latency contract:** `App.tsx`
  now reads `activeTab`/`activeDiff`/`focusedLeaf` to feed the title bar's
  newly-absorbed breadcrumb/diff-chip/mode-toggle cluster — but every one of
  those was ALREADY computed in `App.tsx` before this phase (they fed the
  status bar's diff figure/language id), and none of it is keystroke-
  frequency data: a tab's identity/mode only changes on an explicit mode-
  toggle click or tab switch, and the diff cache only invalidates on save
  or an external git refresh, never on typing. `App`'s pre-existing
  `useTabsStore()` subscription (a bare, unselected full-store subscription
  — a deliberate, already-accepted exception to the "no bare full-store
  subscription" discipline `fs`/`buffers` had to be fixed to follow in
  item 16, since tab operations are inherently low-frequency) already
  re-rendered `App` on every mode/tab change before this phase; the title
  bar reading the SAME data via the SAME subscription adds no new render
  trigger. Verified, not just reasoned about: `tests/e2e/probes.spec.ts`'s
  new "a keystroke burst does not re-render App" test opts into
  `lib/renderProbe.ts` (`window.__renderProbeEnabled`), types a 45-character
  burst into `architecture.md`'s Rendered-mode CM6 view, and asserts
  `window.__renderCounts.App` is IDENTICAL before and after — this is the
  first COMMITTED, repeatable regression test for that probe (Phase 6.5a's
  own investigation used it ad hoc, never as a checked-in assertion).
- **(Phase 8) DESIGN-SPEC Amendments round 3 item 20 ("Sidebar collapse/
  expand") shipped its first pass bound to the Explorer PANEL component
  specifically, then needed a course-correction once verification showed
  `SearchPanel.tsx`/`SourceControlPanel.tsx` each hardcoded their own
  frozen `width: 288` with no resize/collapse of their own at all** —
  switching from a resized Explorer to Search visibly snapped the sidebar
  back to 288px, and Search/Source Control couldn't be dragged or
  collapsed. Width and collapsed-ness are properties of the SIDEBAR REGION,
  not any one activity-bar view (true in real VSCode too) — fixed by
  extracting the width/collapse/border/`ResizeHandle`/header-row shell into
  a new local primitive, `local/SidebarContainer.tsx` (logged in
  `docs/COMPONENT-BACKLOG.md`), which `Sidebar.tsx`/`SearchPanel.tsx`/
  `SourceControlPanel.tsx`, and a new `ExtensionsPanel.tsx` (Extensions
  previously rendered nothing at all — no `activePanel === "extensions"`
  branch existed in `App.tsx`, a blank gap where DESIGN-SPEC's own
  "Extensions (stub)" language promises a real, if inert, view) now all
  mount themselves inside, each reading/writing the SAME `useSettingsStore`
  `sidebarWidth`/`sidebarCollapsed` pair via props `App.tsx` passes down.
  Each view keeps its own historical `data-testid` (`explorer-sidebar`/
  `search-panel`/`scm-panel`/`extensions-panel`) passed as `SidebarContainer`'s
  `testId` prop specifically so every pre-existing spec scoped to one of
  those testids kept working unchanged. Verified with a dedicated
  `tests/e2e/sidebar-resize.spec.ts` test: resize while Explorer is active,
  switch to Search then Source Control and assert the SAME measured width
  each time (not 288), then drag-collapse while Source Control (not
  Explorer) is the active panel and confirm Explorer reflects the same
  restored state afterward — proving one shared region, not three
  independent copies.
- **(Phase 8) CM6 virtualizes long documents by default — only lines near
  the current scroll position exist in the DOM at all — which broke the
  kitchen-sink markdown coverage test's first draft** (DESIGN-SPEC
  Amendments round 3 item 21): asserting `.cm-md-h2` count === 10 against a
  ~110-line note failed with "received 3," not because the live-preview
  plugin only decorated 3 of 10 section headings, but because only the top
  of the document was ever rendered into the DOM at the browser's default
  viewport height — the other 7 headings' decorations genuinely don't
  exist as DOM nodes until scrolled near. This is standard, correct CM6
  behavior (the same mechanism that makes a 50,000-line file editable at
  all), not a bug this phase needed to fix — but it means "assert a
  decoration-class count against the whole document" is the wrong test
  shape for anything longer than a screenful. Fixed by scrolling the real
  `.cm-scroller` element through the whole note in several steps,
  accumulating a Set of which marker classes were seen at ANY step
  (`tests/e2e/rich-demo-data.spec.ts`), rather than asserting counts
  against one static viewport — and by using the real find widget
  (`⌘F` → type → Enter) to deterministically scroll a specific mid-document
  match (the internal `indexer.ts` link) into view before clicking it,
  instead of guessing a scroll offset.
- **(Phase 8) DESIGN-SPEC Amendments round 3 item 19 ("Single-Esc
  fullscreen exit") needed a SECOND listener (`document`'s native
  `fullscreenchange` event), not a fix to the existing `keydown` handler,
  because the browser can intercept the first Escape press before this
  app's own JavaScript ever sees it at all.** When `enterZenMode`'s
  `requestFullscreen()` succeeds, some browsers handle Escape's "leave
  fullscreen" behavior at a level above page JS — the app's `keydown`
  listener either never fires for that keypress or fires after the browser
  has already exited fullscreen, so a handler that only reacted to
  `keydown` needed a SECOND press (once fullscreen was already gone) to
  finally see an Escape it could act on. Fixed with a `fullscreenchange`
  listener that exits zen in the SAME event fullscreen itself ends in —
  deliberately calling `setZenMode(false)` directly rather than
  `exitZenMode()` (which itself calls `document.exitFullscreen()`), since
  by the time this fires fullscreen has, by definition, already ended;
  calling `exitFullscreen()` again would be a no-op at best and a spurious
  rejected promise at worst. The pre-existing `keydown` Escape handler is
  untouched and still covers the other half of the contract ("Esc pressed
  while zen-but-not-browser-fullscreen exits zen directly," e.g. when
  `requestFullscreen()` was denied or unavailable — headless Playwright
  Chromium, notably, which is why `palette-settings-zen-durability.spec.ts`'s
  single-Esc test passes even though real fullscreen may never actually
  engage in that environment: the `keydown` path alone is sufficient there).
- **(Phase 8) `useSettingsStore.ts`'s `uiDensity` needed a real
  `persist` version bump + `migrate`, not just a type/default change,**
  because the pre-Phase-8 default value was the STRING `"comfortable"` even
  though it rendered exactly today's `"default"` pixel values (there was no
  third tier yet) — DESIGN-SPEC Amendments round 3 item 23 introduces a
  genuinely larger `"comfortable"` tier with that same literal string name.
  Without a migration, a session that persisted `uiDensity: "comfortable"`
  before this phase would silently jump to the NEW, taller chrome on next
  load instead of keeping the pixels it always had. `migrate` (version 0 →
  1) remaps a persisted `"comfortable"` to `"default"`; `"compact"` passes
  through unchanged (it always meant the same thing).
- **(Phase 9, backend) `pydantic-settings`' `validation_alias` silently
  drops the Pythonic constructor kwarg it's supposed to alias, unless
  `populate_by_name=True` is also set.** `server/app/config.py`'s
  `Settings` fields each declare `validation_alias="SLATE_DB_URL"` etc. (so
  the real process reads `SLATE_DB_URL` from the environment); the FIRST
  version of `tests/conftest.py`'s fixtures constructed
  `Settings(db_url="sqlite:///...")` directly with the Pythonic field name,
  which pydantic v2 treats as an unrecognized key once a `validation_alias`
  is set (aliasing replaces the field name as an accepted input key, it
  doesn't add to it) — with `extra="ignore"` also set, this failed silently:
  the kwarg was dropped, `db_url` silently fell back to its
  `sqlite:///./slate.db` default, and every test's isolated `tmp_path` DB
  was quietly a lie (confirmed by a two-line repro: `Settings(db_url=...).
  db_url` printed the DEFAULT, not the passed value). Fixed with
  `SettingsConfigDict(..., populate_by_name=True)`, which accepts BOTH the
  alias and the original field name as valid constructor inputs.
- **(Phase 9, backend) An in-memory SQLite engine (`sqlite:///:memory:`)
  needs `poolclass=StaticPool`, or two different threads see two different,
  unrelated empty databases.** `server/app/db.py::make_engine` initially
  just set `check_same_thread=False` (needed either way, since FastAPI's
  `TestClient` runs handlers in a worker thread). That's necessary but not
  sufficient for `:memory:`: SQLAlchemy's default pool checks out a
  **separate connection per caller** by default, and SQLite's `:memory:`
  database is scoped to the single connection that created it — a manual
  repro (`app.db` directly, no HTTP) proved a session opened in the main
  thread and one opened via `TestClient`'s worker thread saw entirely
  disjoint schemas (`sqlite3.OperationalError: no such table: users`
  from the second, despite `create_all` having already run against the
  first). `StaticPool` pins the engine to exactly one shared connection
  regardless of thread, which is the standard fix and has no downside for
  tests (each test already gets its own engine/tmp_path). File-based SQLite
  (every real test's actual DB, and prod) never needed this — the same file
  is visible from any connection/thread already.
- **(Phase 9, backend) Setting a cookie on FastAPI's injected `response:
  Response` parameter is silently discarded if the same endpoint ALSO
  returns its own `Response` object instead of a plain value.**
  `routers/share_public.py`'s `POST /share/{id}/auth` handler originally
  declared `response: Response` and called `response.set_cookie(...)` on
  success, matching the pattern `routers/auth.py`'s `/login` uses — but
  every branch of this specific handler (including the success path)
  returns an explicit `JSONResponse`/`policy.not_found_response()` object,
  and FastAPI only merges an injected `response` parameter's mutated
  headers into the response it BUILDS ITSELF from a plain return value;
  when the endpoint hands back its own complete `Response` object instead,
  that object replaces the injected one entirely and the cookie mutation
  is thrown away. Caught by `tests/test_policy_gate.py::
  test_password_right_sets_cookie_then_get_200` (first draft: `Set-Cookie`
  was simply absent from the real response, and a follow-up GET with the
  cookie jar 401'd instead of 200'ing). Fixed by dropping the separate
  `response: Response` parameter and calling `.set_cookie(...)` directly on
  the actual `JSONResponse` instance the handler returns.
- **(Phase 9, backend) `import app.main` had a real side effect: it built a
  second, default-settings app and wrote a real `server/slate.db` next to
  wherever it ran, unless guarded — and the FIRST guard tried
  (`if "pytest" not in sys.modules`) was itself a heuristic that only
  covered pytest specifically, not "nobody actually asked for the
  instance."** `main.py`'s bottom line originally read
  `app = create_app()` unconditionally, so merely importing the module for
  its `create_app` factory (all any test needs) executed that line as an
  ordinary module-level side effect. The `sys.modules` guard fixed pytest's
  case but would have misfired the same way for ANY other tool that
  imports `app.main` without needing the default instance (caught during
  orchestrator review, which ran a standalone verification script that
  imported the module directly and got a stray `server/slate.db` from it).
  Replaced with PEP 562 module-level `__getattr__`: `app` is no longer
  assigned at module scope at all, so plain `import app.main` never
  references the name — it's only built the first time something does a
  REAL `getattr(app.main, "app")` (which is exactly what
  `uvicorn app.main:app` / `uvicorn.importer.import_from_string` does), and
  the built instance is cached in `globals()` so it's only constructed
  once per process. This is exact by construction (there's no name to
  reference until something asks for it), not a heuristic about which
  importer is currently running. Verified three ways: `python -c
  "import app.main"` alone writes no file; `from app.main import app`
  (or `uvicorn.importer.import_from_string("app.main:app")`, uvicorn's own
  resolution path) does build one and writes `slate.db`, exactly as
  intended; the full pytest suite still passes with zero stray files.
- **(Phase 9, backend) The policy gate's original "existence-oracle
  carve-out" (a distinct 401 password-challenge response for GET, used for
  BOTH a real password-protected share with no session AND a nonexistent
  slug) fixed exactly one oracle and left five others wide open — caught by
  independent orchestrator review, not by this project's own test suite,
  because `test_no_existence_oracle` only ever compared the one pair that
  happened to match.** ROADMAP-SHARING-AUTH.md §1 is literal: "404 for
  missing/revoked/expired/unauthorized-without-identity look identical" —
  ALL of those reasons, not just "missing vs. password-required." The
  orchestrator's probe measured the real, deployed behavior across all six
  GET deny states and found two distinct response classes:
  ```
  missing / password_no_session   -> 401 {"detail":"Authentication required"}
  revoked / expired / restricted /
    token_required                -> 404 {"detail":"Not found"}
  ```
  which is a real, exploitable oracle: a 404 proves the slug names an
  actual record (something with state to revoke/expire/restrict), a 401
  proves it doesn't (or is specifically password-gated) — exactly the
  distinction a capability link's unguessability is supposed to prevent an
  attacker from learning. Fixed by collapsing the gate to exactly ONE deny
  response for every reason and every method: `404 {"detail": "Not
  found"}`, full stop — no second response shape anywhere in `policy.py`
  (see its module docstring for the complete rationale, including why a
  real, live, password-protected share also 404s to a bare GET with no
  session, and `server/README.md`'s "Every deny reason is the SAME 404"
  subsection for the client-side contract this creates: one generic
  "unavailable, or requires a password" state on any 404, always offering
  the password field, never branching on *why* a 404 happened).
  `tests/test_policy_gate.py::test_no_existence_oracle` (the old, too-narrow
  test) was replaced with
  `test_deny_state_equivalence_matrix_raw_route`/`_content_route`, which
  build all nine deny states (malformed, nonexistent, revoked, expired,
  restricted×2, token×2, password-required) against BOTH public GET routes,
  fingerprint every response (status + body + headers minus Date/
  Content-Length/rate-limit), and assert the fingerprint SET has exactly one
  element — proven capable of catching this exact bug class by temporarily
  reintroducing a distinguishable revoked-share response (a 410 instead of
  404), confirming the new test fails RED with a clear grouped diagnostic,
  then reverting and confirming GREEN again.
- **(Phase 10, sharing) An eager, unconditional boot-time reachability probe
  (`GET /api/auth/whoami` fired from `App.tsx`'s top-level boot effect on
  every mount) is a real, provable regression against
  `tests/e2e/probes.spec.ts`'s pre-existing offline-cold-start test — caught
  by that committed test actually failing, not by inspection.** The probe
  itself never threw (`share/api.ts`'s `whoami()` catches the fetch
  rejection and resolves `null`), so this looked safe by the "never throws,
  never blocks boot" standard every other boot-time side effect in this file
  is held to. The test that caught it asserts something stricter: zero
  browser-level console errors during an offline cold start
  (`context.setOffline(true)` then `page.reload()`). Chromium logs "Failed
  to load resource: net::ERR_INTERNET_DISCONNECTED" to the console for ANY
  request that fails at the network layer, independent of whether
  application code catches the rejection — a JS-level `try`/`catch` (or a
  `.catch()`) cannot suppress it, because the log comes from the browser's
  own network stack, not from an uncaught exception. A `navigator.onLine`
  guard was tried next (skip the fetch when the browser already knows it's
  offline) and also failed to fix it — measured directly with a throwaway
  repro spec: `page.evaluate(() => navigator.onLine)` reads `true` even
  immediately after `context.setOffline(true)` + `page.reload()`, because
  Playwright/CDP's `Network.emulateNetworkConditions`-based offline
  emulation blocks requests at the network layer without flipping that
  property the way a real disconnected network interface does — so the
  guard compiled, looked correct, and did nothing. Fixed architecturally
  instead of with a better guard: the probe was moved out of the boot
  effect entirely and now only fires from the three real share-entry points
  (`App.tsx`'s `handleOpenPublish`, reached by the Explorer context menu,
  command palette, and title bar share icon alike) and
  `SettingsView.tsx`'s "Sharing" category's own mount effect — nothing
  about opening/using the vault, editor, or git features has anything to do
  with sharing, so nothing about them should ever cause sharing-related
  network activity. This is also a strictly better fit for CLAUDE.md rule
  3's "server-optional" posture than the eager version was: a user who
  never touches sharing now causes zero sharing-related requests, not just
  zero *failed* ones. Confirmed fixed: `tests/e2e/probes.spec.ts`'s offline
  test passes green with the lazy version, and the full committed e2e suite
  (`tests/e2e/share-*.spec.ts`) still passes — the three real entry points
  still probe reachability exactly when they need to.
- **(Phase 11, real sync) dulwich requires the `thin-pack` capability by default;
  isomorphic-git's `fetch()` never sends it — every real fetch/pull from the browser
  client failed, silently.** Found during this phase's own manual verification (a
  Node script exercising `git/remote.ts` against a live server): `git.fetch()`
  resolved "successfully" (ref discovery/`fetchHead` worked fine — that's a separate
  earlier request) but wrote ZERO pack objects locally, so the very next
  `git.log`/`readObject` against the fetched oid threw `NotFoundError`. Root cause,
  found by logging isomorphic-git's actual request and replaying it with `curl`:
  `dulwich.server.UploadPackHandler.required_capabilities()` hardcodes `thin-pack` as
  REQUIRED; isomorphic-git's want-line never includes it
  (`multi_ack_detailed no-done side-band-64k ofs-delta` — confirmed by logging).
  dulwich raises `GitProtocolError` for the missing capability, but only AFTER the
  HTTP response already started (`200 OK` + real headers sent), so the failure is
  invisible on the wire — a raw `curl` replay of the exact negotiation showed `200`,
  `chunked` encoding, and a `0`-byte body, with the real traceback only visible in
  server logs. `thin-pack` is a pure wire-optimization (server may omit base objects
  the client is assumed to have; it is not required for correctness), so
  `server/app/routers/git_http.py`'s `BrowserCompatibleUploadPackHandler` drops it
  from the required set — dulwich now always sends a complete, non-thin pack, which
  isomorphic-git parses fine; system `git` still requests `thin-pack` on its own and
  is unaffected. Regression-locked by `server/tests/test_git_sync.py::
  test_live_fetch_without_thin_pack_capability_returns_real_objects`, which replays
  the exact thin-pack-less negotiation shape over raw HTTP and asserts a non-empty,
  real-pack-magic response — confirmed to fail RED (the exact `GitProtocolError`
  above) with the handler override removed, then GREEN with it restored.
- **(Phase 11) `git.fetch()` refuses to run without a `remote.origin.fetch` git-config
  entry, even when `url` is passed explicitly — and `git.fastForward()`'s own internal
  re-fetch triggered a separate, real isomorphic-git bug.** First: `fetch()`'s
  `GitRefManager.updateRemoteRefs` always reads `remote.${remote}.fetch` from the
  repo's own config to know where to write remote-tracking refs, with no override in
  the public API — passing `url` is enough for the network request but not enough to
  satisfy that later step, so a repo that never had `git.addRemote()` called on it hit
  `NoRefspecError` on its very first fetch. Fixed with `git/remote.ts::ensureOrigin`
  — an idempotent `git.addRemote({remote: "origin", url, force: true})` at the top of
  every `realFetch`, so a changed Settings URL always wins on the next sync. Second,
  found immediately after fixing the first issue: `realPull`'s fast-forward step
  originally called the library's own `git.fastForward()` (the obvious, "reuse proven
  code" choice per CLAUDE.md rule 7) — but that helper always does its OWN internal
  `_fetch` (see `_pull({..., fastForwardOnly: true})` in isomorphic-git's source),
  which is both a redundant second network round-trip on top of the `realFetch` call
  immediately before it AND, confirmed the hard way in the same manual verification
  session, an outright bug trigger: the redundant fetch's own object negotiation left
  the VERY NEXT `computeSyncStatus` call unable to find the commit object that same
  fetch was supposed to have just written (`NotFoundError`, reproduced twice with two
  different synthetic "someone else pushed" scenarios). Fixed by not calling
  `git.fastForward()` at all: `realPull` already knows exactly which oid to
  fast-forward to (the remote-tracking ref its OWN `realFetch` call just updated), so
  it moves `refs/heads/<branch>` there directly (`git.writeRef`) and checks out
  (`git.checkout({force: true})`) — no second fetch, bug sidestepped entirely. Both
  fixes verified via standalone Node scripts driving `git/remote.ts` against a live
  server (fake-indexeddb + real isomorphic-git, real HTTP to real uvicorn) covering:
  bootstrap push into a nonexistent repo, fast-forward pull from a genuine
  "teammate pushed" state (verified via a real second `git clone` + `git push` from
  system git), divergence refusal in both directions, and auth/offline/not-configured
  error mapping — then re-verified end to end via `tests/e2e/git-sync.spec.ts`
  (Playwright driving a real browser) and `server/tests/test_git_sync.py` (pytest).
- **(Phase 11, real sync's auto-merge) `git.commit()`'s `ref` parameter does NOT
  auto-expand a bare branch name — passing one silently desyncs `HEAD` from the
  branch it's supposed to point at.** Found writing `git/sync.ts::commitMerge`: the
  first version passed `ref: branch` (e.g. `"feat/incremental-index"`, matching how
  `git.resolveRef`/`git.push`/`remoteTrackingOid` are called elsewhere in this
  codebase with bare names, apparently successfully). The resulting merge commit
  itself was correct, `git.resolveRef({ref: branch})` afterward correctly returned the
  new merge oid, and `git.push` correctly pushed it — everything LOOKED right. But
  `useGitStore`'s post-sync ahead/behind stayed wrong (`↑0 ↓1` after what should have
  been a clean 0/0 sync), traced via direct `git.resolveRef({ref: "HEAD"})` calls
  bracketing the commit/push to show `HEAD` STILL resolving to the pre-merge commit
  even though `refs/heads/<branch>` (confirmed via the bare-name resolve) had
  genuinely moved. Root cause: `git.commit()`'s `ref` write does not go through the
  same short-name-expansion path `resolveRef`/`push` use — a bare name is written as a
  loose ref at that EXACT literal path (`.git/feat/incremental-index`, a sibling of
  `.git/refs/`, not `.git/refs/heads/feat/incremental-index`), which
  `resolveRef({ref: branch})` still happens to find (isomorphic-git's ref lookup tries
  an exact loose-file match before trying the `refs/heads/` prefix) — but `HEAD`,
  which symbolically points at the FULLY QUALIFIED `refs/heads/<branch>` specifically,
  never sees the update. Fixed by passing `ref: \`refs/heads/${branch}\`` explicitly
  (matching the convention `remote.ts::fastForwardBranch`'s `git.writeRef` already
  used) — the one call in this codebase that had been the exception. Caught by this
  phase's own e2e test (`tests/e2e/git-sync.spec.ts`'s disjoint-auto-merge case
  asserting `↑0 ↓0` in the status bar after a clean merge, not just "the push
  succeeded") rather than by inspection — a reminder that "the push resolved without
  throwing" is not the same claim as "the local view of ahead/behind is now correct".
- **(Phase 11) ASGI `root_path`/`path` convention: this project's installed Starlette
  version does NOT pre-strip a mount's prefix off `scope["path"]`** — it follows the
  ASGI spec literally (`path` stays the full original request path; `root_path`
  is the prefix already consumed), which is the opposite of an older Starlette
  convention some code examples assume. `git_http.py`'s `GitAuthMiddleware` initially
  assumed a stripped `path` (matching `/{repo}.git/...` directly) and got a `404` for
  every single request, mounted or not — confirmed by a one-off debug print of
  `scope["path"]`/`scope["root_path"]` showing `/git/foo.git/info/refs` /
  `/git` respectively. Fixed by stripping `root_path` off `path` explicitly inside the
  middleware before matching `GIT_REQUEST_RE`; `a2wsgi.WSGIMiddleware` downstream
  already handles this translation correctly on its own for the WSGI environ it
  builds, so this only affected this middleware's OWN routing logic.
- **(Phase 11) dulwich's `FileSystemBackend` was deliberately NOT used, even though it
  looks like the obvious built-in for "serve bare repos from a directory".** Its
  `open_repository` does `os.path.join(self.root, path)` where `path` (dulwich's own
  `url_prefix()` output) always starts with a leading `/` — and `os.path.join` throws
  away its first argument entirely whenever the second is itself absolute
  (`os.path.join("/a/b/", "/c") == "/c"`, confirmed at a Python prompt before writing
  around it — a real stdlib quirk, not a dulwich bug). Left alone, this would silently
  ignore `SLATE_GIT_ROOT` and resolve every repo relative to the real filesystem root
  instead. `gitrepo.py`'s `BareRepoBackend` does its own name extraction + validation
  (`resolve_repo_path`, shared with the pre-push bare-init check) instead of trusting
  that class — see that module's docstring for the full account.
- **(Phase 10.5) `vite.config.ts`'s `shareAuthProxy` only matched the ZERO-relpath
  case, silently swallowing every folder-share file/directory fetch in dev/preview.**
  Phase 10's proxy (`^/share/[^/]+$`) was written when `/share/{slug}` was the only
  same-origin path `ShareApp.tsx` ever fetched. Phase 10.5 added
  `getShareFolderPathSameOrigin`, which fetches `/share/{slug}/{relpath}` (any depth)
  the identical same-origin, `Accept: application/json` way — a request that pattern
  doesn't match, so it silently fell through to Vite's own `appType: "spa"` fallback
  instead of reaching the backend. Caught by `tests/e2e/share-folder.spec.ts`, not by
  inspection: the folder's ROOT listing rendered correctly (that fetch IS the
  zero-relpath case), but clicking into a file inside it 404'd — genuinely confusing
  first read, since the server-side manifest resolution (freshly written, most
  suspected code) was in fact correct; the request for that file never reached it at
  all. Fixed by widening the pattern to `^/share/[^/]+(/.*)?$`, keeping the exact same
  JSON-only `bypass` rule (a real address-bar navigation to a deep folder-share link —
  no `Accept: application/json` — still falls through to the SPA fallback so
  `main.tsx`'s router can parse the relpath and mount `ShareApp` itself, unchanged from
  the root case). Verified fixed by rerunning `tests/e2e/share-folder.spec.ts` green
  after the change (RED beforehand, confirmed against this exact failure, not assumed).

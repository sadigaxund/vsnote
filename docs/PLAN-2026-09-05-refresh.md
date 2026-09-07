# Plan — 2026-09-05 refresh arc

Status: APPROVED 2026-09-05. Decisions: storage = Option B auto-sync; folder
shares = remove fully; blog links = dynamic link map; Markii = full M1-M3.
Design polish (§7) runs LAST in its own commit range so it can be reverted.
Scope requested by the owner on 2026-09-05: durable storage, visual touch-up,
logo, sharing model/modal rework, "blog" via linked shares, Markii extension.

Research baseline (what exists today; verified against source, see cited files):

- Vault lives in the browser: lightning-fs over IndexedDB (`src/fs/client.ts`),
  isomorphic-git on the same fs (`src/git/client.ts`). Server already has
  `VSNOTE_VAULT_PATH` (`server/app/config.py:95-112`, `server/app/vault.py`):
  a real plaintext working tree kept in step with the smart-HTTP bare repo
  (commit disk edits before every git request, checkout HEAD after every
  push). Sync is a manual one-button pipeline plus background fetch.
- Sharing (`server/app/routers/{shares,share_public}.py`, `policy.py`) already
  has: raw vs rendered mode, none/password/token auth, expiry, alias, revoke,
  regenerate, restricted (grants + OAuth), folder shares with manifests.
  Token mode accepts any of the owner's account API tokens (not per-share).
  The public reader (`src/share/ShareApp.tsx`) reuses shell chrome (TitleBar,
  ExplorerTree, EditorTabBar, Rendered/Source toggle) and renders markdown
  through the CodeMirror live-preview editor in read-only mode.
- No markdown-to-HTML pipeline exists (no remark/markdown-it). Rendered
  markdown is CodeMirror decorations via `@atomic-editor/editor`.
- Settings is one 1385-line `SettingsView.tsx` with inline styles, 36rem row
  cap, unbounded page width, and a 9-column shares table with no sizing.
- Logo: `public/favicon.svg` is a purple mark unrelated to the teal brand;
  in-app "logo" is a duplicated CSS gradient chip; PNG icons come from
  `scripts/generate-pwa-icons.mjs` (procedural, not from the SVG).
- Markii: MIT monorepo, `@markii/core` (remark-directive based parse +
  toHast), `@markii/react` / `@markii/html` renderers with a registry and
  `doc.css` tokens, `@markii/host` for completion/hover/fence-lengthening.
  Nothing for CodeMirror beyond syntax regexes. `docs/temp-plan-add-extension.md`
  already sketches the L3 (scripts, Lua worker, grants) host layer.

---

## 1. Storage — get the vault out of browser storage

Decision: Option B.

**Option A — server-authoritative filesystem.** Browser becomes a thin
client. New `/api/fs/*` REST surface (list/read/write/rename/delete, ETag or
mtime for optimistic concurrency); `src/fs/client.ts` swapped for an
HTTP-backed adapter; git operations move server-side (dulwich/pygit2) and
`src/git/*` shrinks to API calls. Effects: no offline editing (CLAUDE.md rule
3 and ARCHITECTURE would be amended), no isomorphic-git, simpler mental model,
vault editable by any tool on the host directly. Cost: largest rewrite of the
six items; touches every fs and git module.

**Option B — keep the browser working copy, make the server path the durable
source of truth (recommended).** `VSNOTE_VAULT_PATH` already is the fs-with-
env-var. What is missing is that the browser copy is the only place recent
edits live until the user presses Sync. Work:

1. Auto-sync policy in Settings → Git & Sync: `Off / On save (debounced) /
   Interval`, default On save with ~5s debounce; commit uses the existing
   template, then the existing fetch→ff→merge→push pipeline. Failures surface
   in the status bar, never block editing.
2. Pull on boot and on window focus when behind.
3. Status bar "durability" indicator: local-only edits count + last push time.
4. Onboarding: if backend reachable and vault empty, offer clone of
   `VSNOTE_VAULT_PATH` repo (exists as "Restore from remote…"; promote it).
5. Server: nothing new; document that `VSNOTE_VAULT_PATH` is the durable copy
   and how to back it up (docker volume → host path).

Option B keeps local-first, keeps offline, and reduces exposure to "edits since
last debounce". Option C (write-through to server when online, IndexedDB queue
offline) is deferrable on top of B if B is not enough.

**Shipped (2026-09-05):**

1. Auto-sync stayed the existing three combinable toggles
   (`gitSyncOnInterval`/`gitSyncOnOpenClose`/`gitSyncOnSave`,
   `src/git/autoSyncPolicy.ts`) rather than the exclusive `Off/On save/
   Interval` enum sketched above (that shape predates round 7 item 54's
   rework, already in main before this pass) — this item instead changes
   the DEFAULTS: finishing Settings → Git & Sync's setup wizard
   (`gitSyncSetupComplete` flipping true) now turns on-save and
   on-interval (15 min default, unchanged) ON by default, unless the user
   already explicitly set either one (`useSettingsStore.ts`'s
   `setGitSyncSetupComplete`, new `*Touched` fields). A v5 persist
   migration applies the same one-time default to sessions that had
   already completed setup before this shipped. Manual sync (all toggles
   off) stays fully available.
2. "Pull on boot" already existed (App.tsx's boot `refresh()`); "on window
   focus" is new — a fourth trigger, `onFocus`, added to
   `git/autoSyncPolicy.ts`'s `SyncTriggers`/`AutoSyncScheduler`
   (`triggerFocus`), wired from `App.tsx`'s `visibilitychange`-to-visible
   and `window` `focus` listeners, gated on its own toggle (default ON once
   setup completes, same `*Touched` discipline as item 1) and on the last
   completed sync being older than the coalescing queue's
   `SYNC_QUIET_WINDOW_MS` — repeated tab-switching triggers zero extra
   syncs once one has run recently, never even queuing a pending run the
   way the other three triggers can.
3. Status bar durability indicator shipped in `StatusBar.tsx`'s sync
   segment: "N unsynced" (local commits ahead plus one more if the working
   tree has uncommitted changes, from `useGitStore`'s existing `ahead`/
   `changedCount`/`untracked` fields — no second status computation) and
   "last pushed Xm ago" (`lib/relativeTime.ts::formatLastPushedLabel`,
   replacing the old "synced Xm ago" wording), both with a tooltip stating
   edits are durable once pushed to the server vault.
4. **Shipped (2026-09-06).** Settings → Storage now offers "Restore from
   remote" as a prominent one-click card at the top of the category
   whenever the backend is reachable, sync setup is complete
   (`gitSyncSetupComplete`), and the local vault is empty or holds only
   the non-demo starter seed (`welcome.md`) — `settings/Storage.tsx`. The
   existing restore flow (`src/git/restore.ts::restoreFromRemote`,
   `App.tsx`'s `restoreConfirmOpen`/`handleRestoreRemoteConfirmed`) is
   reused verbatim, reached through a new `onRestoreFromRemote` callback
   threaded down the same way `onExportVault`/`onRequestResetVault`
   already are. Hidden in demo builds exactly like the palette command it
   wraps (DESIGN-SPEC item 45). See DESIGN-SPEC item 89.
5. Server needed no code changes (`VSNOTE_VAULT_PATH` already existed) —
   documented instead: server/README.md's new "Durable storage" section
   (bind-mount example, backup advice) and docs/ARCHITECTURE.md's new
   "Storage durability model" section. Settings → Git & Sync's copy (the
   setup wizard's intro, and the post-setup "Vault identity" card) now says
   in plain text that the server vault path is the durable copy and points
   at server/README.md's "Durable storage" section.

## 2. Look and feel touch-up

Principle: fix in `my-you-eye` first (owner owns it), else local component in
library style plus an upstream issue. Every local fix carries a backlog entry.

Settings (`SettingsView.tsx`):
- Content column gets a page max-width (~52rem) centered in the remaining
  space; nav stays 172px. Remove the unbounded stretch.
- Field sizing by type: numbers/short enums ~8–12rem, text ~24rem, textareas
  full row. Add a `SettingsRow` layout primitive (label + description left,
  control right, wraps on narrow) instead of per-row inline styles.
- Shares table → my-you-eye `DataTable` with fixed column widths, truncated
  link with copy button, relative dates, actions in an overflow menu. If
  `DataTable` lacks column sizing / truncation / row actions, build
  `local/SharesTable` and file an upstream issue with the exact API gap.
  Also move share management to a "Shared" view reachable from the activity
  bar (roadmap §5.1 already asks for this); Settings keeps only sharing
  defaults (OAuth, default mode).
- Same treatment for `VaultSetupPanel`'s remotes table.
- Split `SettingsView.tsx` into `settings/{Appearance,Editor,Rendered,Git,
  Sharing,Storage,Keyboard}.tsx` to make later passes cheap.
- Screenshot-driven review per `skills/design-review-checklist.md` before and
  after (Playwright ui-audit spec already exists).

Upstream issues to file on `sadigaxund/my-you-eye` (only after confirming the
gap in `skills/my-you-eye/components.json` and the installed dist):
DataTable column sizing/truncation/row-actions; settings layout primitives
(`SettingsSection`/`SettingsRow` or a `FormField` horizontal variant); a
`ColorField` (native `<input type=color>` still hand-rolled here).

**Shipped (2026-09-06) — Settings layout + `VaultSetupPanel` table:**

1. Content column now caps at ~52rem, centered next to the fixed-172px nav
   (`SettingsView.tsx`); the old unbounded stretch and the `ROW_MAX_WIDTH`
   ("36rem") per-row cap are gone.
2. `SettingsRow`/`SettingsSection` (`src/components/local/SettingsRow.tsx`)
   built locally — upstream gap already filed as sadigaxund/my-you-eye#34,
   not re-filed (`docs/COMPONENT-BACKLOG.md` §2.11). `controlWidth`
   (`"narrow"` ~12rem, `"text"` ~24rem, `"full"` 100%) drives field sizing
   by type from one place.
3. `SettingsView.tsx` split into a thin shell (nav, search, routing) plus
   `src/components/settings/{Appearance,Editor,Rendered,Git,Sharing,
   Storage,Keyboard}.tsx`, each a `use<Category>Rows()` hook. Every
   `data-testid` carried over unchanged.
4. `VaultSetupPanel`'s remotes table moved to `DataTable` (fixed widths,
   truncated URL, relative "Last run", quick actions + an overflow menu) —
   same treatment the Shared view's share table already had. `tests/e2e/
   vault-setup.spec.ts` updated in the same change (row lookups by visible
   text instead of a per-row `data-testid`, which `DataTable` doesn't
   emit).
5. Screenshot review done per `skills/design-review-checklist.md` (see
   `docs/DESIGN-SPEC.md`'s round 10 items 84-89).
6. DESIGN-SPEC items 51 (no flash on refresh) and 52 (Git and sync setup
   gate) verified intact after the split.

Share management is already out of Settings (round 10 item 83, shipped
earlier) — nothing left to move.

## 3. Logo

Concept: a document sheet with a folded top-right corner (the markdown/file
glyph) wrapped by the VS Code ribbon shape (two angled bands meeting at the
right edge), teal accent on near-black, single-color variant for monochrome
contexts. Deliverables:
- `public/favicon.svg` (master, 512 viewBox), plus `public/logo-mono.svg`.
- `scripts/generate-pwa-icons.mjs` rewritten to rasterize the SVG (use the
  already-installed Playwright Chromium, no new dependency) → 192/512/512-
  maskable PNGs; add `apple-touch-icon` and `<meta name="theme-color">`.
- `src/components/local/Logo.tsx` replacing the duplicated gradient chips in
  `TitleBar.tsx`, `ShareApp.tsx`, and adding the mark to `LoginGate.tsx`.
- README hero and `vite.config.ts` manifest updated.

**Shipped (2026-09-05).** All four deliverables landed. `generate-pwa-icons.mjs`
rasterizes `public/favicon.svg` on `#0e1015` via the already-installed
Playwright Chromium (192/512/maskable-512 at 62%, apple-touch 180); `index.html`
gained `apple-touch-icon` and `theme-color`; `src/components/local/Logo.tsx`
(size/mono/title props) replaced the duplicated gradient chips in `TitleBar`,
`ShareApp` and `LoginGate`, and the lucide `Layout` placeholder is gone. The
orchestrator visually verified both PNGs (mark centred, maskable inside the
safe zone). Round-10 items were renumbered 47/48 -> 62/63 on landing, since
47/48 were already taken.

## 4. Sharing model and modal

Server-side changes:
1. **Raw = bytes.** Raw shares of text stay `text/plain; charset=utf-8`;
   binary blobs are served `application/octet-stream`. Both keep `nosniff`,
   `default-src 'none'; sandbox` CSP, and gain `Content-Disposition:
   inline; filename="<basename>"` (`?download=1` → `attachment`). Never
   `text/html`. `curl -H 'Authorization: Bearer …' <url> | sh` shape works.
2. **Per-share bearer tokens.** Today token mode accepts any owner API token,
   so one leaked script token unlocks every token share and the API. Add
   `share_tokens` (share_id, token_hash, label, created_at, last_used_at,
   revoked_at); publish dialog mints one, shows it once, allows rotate/revoke.
   Owner API tokens keep working for the owner's own automation (scope
   `share-admin`), not as visitor credentials.
3. **Rendered = content only.** Public reader route returns a document page
   with zero chrome: no TitleBar, no tabs, no tree, no mode toggle. Markdown
   is statically rendered (see §6: one unified/remark pipeline shared with
   Markii, raw HTML dropped, URLs sanitized); code files are a static
   highlighted `<pre>` with line numbers via `@lezer/highlight
   highlightTree` on the already-loaded language. Editor role (write-back)
   is dropped from the public reader; the reader is read-only by definition.
4. **Single-file only.** Folder shares removed: publish tree, manifest
   routes, listing pages. Decision: delete the tables/routes; a migration
   revokes existing folder shares.
5. **Audit of expiry / alias / general access** with tests: alias uniqueness
   and reserved words (`api`, `share`, `git`, `assets`), alias regex, expiry
   as UTC with clock skew tolerance, restricted + OAuth round trip, uniform
   404 preserved for every deny path, password throttling.
6. Auth matrix enforced server-side, not just in the dialog:
   raw → `none | token`; rendered → `none | password | restricted (sign-in)`.
   Password on raw is rejected (no UI to type it); token on rendered is
   allowed but not offered by default.

Publish dialog (`local/PublishDialog.tsx`) rebuilt as a stepped form:
`Mode` (Raw / Rendered, with a one-line description of each) →
`Who can open` (Anyone with the link / Only people I list) →
`Protection` (filtered by mode) → `Link` (alias, expiry) → result card with
copy, and for token mode the one-time token with a ready-made `curl` line.
Same form drives "edit policy". Uses my-you-eye `RadioGroup`, `FormField`,
`Input`, `Combobox`; nothing hand-rolled.

**Shipped (2026-09-05 to 2026-09-06).** Folder shares removed entirely,
server and client, with no migration by explicit owner directive (a stale
database is an operator concern). Raw content is bytes: a NUL-scan plus strict
UTF-8 decode picks exactly one of two content types, with RFC 6266 escaped
filenames, `?download=1`, and `nosniff` plus a `default-src 'none'; sandbox`
CSP. Per-share tokens replaced API tokens as visitor credentials, scoped to one
share, with owner tokens explicitly rejected. The publish dialog was rebuilt as
a five-step flow (Mode, Who can open, Protection, Link, Result) filtered to
exactly match the server's auth matrix, and share management moved out of
Settings to its own full-width Shared tab.

## 5. "Blog" from linked shares — how serving works

A share is a slug (or alias) → one pinned blob. A relative link in your
markdown (`[next](./part-2.md)`) means nothing at `/share/<slug>`, so a blog
needs link resolution. Three options:

- **Dynamic link map (recommended).** When the reader requests a rendered
  share, the server also returns a map `{vault-relative target → share URL}`
  built by matching the *owner's other active shares* by `source_path`
  (a stored share field, no filesystem lookup, so the security posture holds).
  The renderer rewrites resolvable links to `/share/<alias-or-slug>` and
  renders unresolvable ones as plain text with a `title="not shared"`. No
  republish needed when you share a new post; revoking one breaks its links
  everywhere, immediately.
- **Publish-time rewrite.** Rewrite links into the snapshot when publishing.
  Stale as soon as another post is shared later; needs the existing
  auto-republish machinery to chase changes. Rejected.
- **Site/collection share** (a folder share with navigation). Owner rejected;
  keeps single-file only.

Navigation: your markdown. Write an index note, give it alias `blog`, link the
posts. The reader adds no panel. Two small opt-in affordances worth having,
both off by default, both set per share: `Show title` (H1 as `<title>` + OG
tags, TODO §5.7) and `Back link` (one line at the top pointing to a chosen
share, typically the index).

Visitor experience is identical to a single-file share: same chrome-less page,
links between shared files just work, browser back button is the navigation.
Owner-side: the publish dialog (rendered mode) lists relative links found in
the file with `shared as /share/x` or `not shared` + "Share too" (same policy);
the Shared view shows links-to / linked-from per share. Password mode gives one
prompt per slug (cookie scoped per share), so blogs should use `none` or
`restricted`; the dialog says so when a password is chosen on a file with
outgoing links.

Convention: no subvault, no new extension. Sharing state is already visible
as the link glyph in the explorer; a filter "Shared files" in the explorer
and the new Shared view are enough. If you want a physical grouping, a plain
`blog/` folder in the vault is your own choice and the app stays agnostic.
Aliases: allow a `/`-free prefix convention (`blog-hello-world`); nested alias
paths (`blog/hello`) would collide with the folder-share URL shape we are
removing and complicate the gate, so not now.

**Shipped (2026-09-06).** `server/app/linkmap.py` computes the map purely
lexically (no realpath, no filesystem, ever). Restricted and password-protected
targets ARE included in a public share's link map, deliberately: a capability
URL still enforces its own policy on click, and excluding them would silently
break an owner's blog. `show_title` and `back_link` shipped, with OG/title meta
injected only when `show_title` is on AND `auth_mode` is none AND access was
granted, asserted with both a positive and a negative case. The public reader
was rewritten as a chrome-less document page with its own `.share-reader` token
scope and no CodeMirror on the route.

## 6. Markii extension

Phased; decision: all three phases in this arc.

**Phase M1 — parse + render (L0/L1).**
- Add `@markii/core` and `@markii/react` (+ `@markii/react/components`,
  `doc.css`). Map `--mk-*` tokens to `--color-*`/`--markdown-*` in
  `theme.css`.
- Register filetype `.mk.md` in `src/filetypes/registry.ts` (markdown
  language for Source mode).
- New `src/markdown/render.tsx`: one static renderer for `.md` and `.mk.md`
  used by the public reader (§4.3), print export (replacing the hand parser in
  `src/lib/printDocument.tsx`), and the `.mk.md` Rendered mode. Plain `.md`
  goes through the same pipeline with the directive registry enabled anyway;
  a `:kbd[x]` in a `.md` renders too, which is the point of an extension.
- Rendered mode for `.mk.md`: side-by-side or toggle Source / Preview (the
  playground pattern) with 200ms debounce. Live preview inside CodeMirror
  for directives is Phase M2.
- Completion and hover in Source mode via `@markii/host` `completionAt` /
  `hoverAt` wired as a CM6 `autocompletion` source and `hoverTooltip`;
  "Insert component" command with fence lengthening.

**Phase M2 — live preview.** Lezer `MarkdownExtension` for the three directive
forms (regexes from the VS Code grammar), block-widget decorations that
render container/leaf directives with `renderMarkNode` when the cursor is
outside the block (Obsidian rule from DESIGN-SPEC), inline `:name[...]{}`
decorations. Contribute upstream to markii as `@markii/codemirror` if it
stabilizes.

**Phase M3 — bundles + scripts (L2/L3).** Follow
`docs/temp-plan-add-extension.md`: Worker isolate with watchdog, grant store,
trigger tiers, value persistence, `.mkz` bundles, pack settings panel.
Render stays side-effect-free; scripts run only on explicit action.

**Shipped (2026-09-06 to 2026-09-07), all three phases.**

**M1** — `src/markdown/render.tsx` is the single static renderer (share reader,
print/export, `.mk.md`), with links rewritten in the mdast because
`@markii/react` exposes no link hook, and fenced code routed through a
synthetic directive so VSNote's own highlighter survives. `@markii/host` is
unpublished upstream, so its pure functions are vendored with MIT attribution.

**M2** — `src/markdown/directiveLezer/` adds a Lezer `MarkdownExtension` for the
three directive forms plus block widgets from a `StateField` and inline widgets
from a `ViewPlugin`. `.mk.md`'s Rendered mode became the same live-preview
editor plain `.md` uses; the static split preview was deleted. The module has
zero VSNote imports and is liftable as `@markii/codemirror`.

**M3** — scripts run ONLY inside a dedicated Web Worker running `@markii/lua`,
under a main-thread `terminate()` watchdog that sits above the library's own
in-VM limits (those run between Lua instructions and cannot see a hang while
Lua is suspended in a host call). wasmoon's `glue.wasm` ships as a same-origin
Vite asset, because the default would fetch unpkg.com at runtime and break rule
3. Tier enforcement is at the host: an auto or scheduled run never has a `post`
allowlist constructed for it, whatever the stored grant says. Grants are keyed
by a content hash, so editing a script invalidates its grant. `.mkz` bundles
load with a structurally enforced path jail. Packs register namespaces and
resolve Lua modules, but their `webview.js` is never executed and their
components render as labelled placeholders (owner-confirmed; see the handover's
limitations).

**Not shipped, declared rather than hidden**: a `.mkz` Explorer browsing and
editing surface (bundles load by sibling-path convention only), and any actual
auto or scheduled trigger. The host-side tier gate for a non-manual trigger is
built and tested, but nothing calls it, so no "run automatically" control ships
either. Attribute-VALUE completion for pack-declared enums is still trimmed out
of the vendored host.

## 7. Design polish (last, revertable)

Owner verdict: "too crude and sharp on the edges, but organized nicely". Pass
over tokens only where possible: radii scale (chips 6px, panels 8px, dialogs
10px), border alpha lowered on nested surfaces, one shadow scale for popovers
and dialogs, 4/8px spacing rhythm audit, focus ring softened, tab and tree row
hover states. Recorded as DESIGN-SPEC amendment round 10. Before/after
screenshots via the ui-audit spec. Isolated commit range.

---

## Execution order and gates

1. Logo (§3) — small, unblocks visual work.
2. Storage (§1) per decision.
3. Sharing server changes (§4.1, 4.2, 4.4, 4.5, 4.6) with pytest.
4. Static markdown/code renderer + Markii M1 (§6) — shared by the reader.
5. Public reader rewrite (§4.3) + dynamic link map (§5).
6. Publish dialog + Shared view + Settings refresh (§2, §4 dialog) with
   screenshot review.
7. Markii M2, then M3.
8. Design polish (§7), own commit range.

Every step: `npm run build`, `npm run lint`, `npm run typecheck`, vitest,
Playwright for UI, pytest for server. Docs updated in the same change:
ROADMAP-SHARING-AUTH (§5.1 folder shares superseded), DESIGN-SPEC (reader,
logo, settings layout), ARCHITECTURE (renderer pipeline, storage policy),
COMPONENT-BACKLOG (every local component).

**Shipped (2026-09-07).** Round 10 items 98 to 107. Radii 4/6 -> 6/8 with
dialogs unchanged at 10; the shadow scale kept its three-tier shape but raised
alpha, because the library's values are tuned for a near-white canvas and
composited to almost nothing on this near-black shell; a new
`--app-border-nested` softens only dividers nested inside an already-bordered
surface, leaving structural dividers alone; off-grid paddings snapped to the
4/8 rhythm; the focus ring was softened AROUND rather than weakened, since the
ui-audit WCAG gate measures the ring itself (10.07:1 against a 3:1 floor); tabs
gained a hover state and lost their boxing dividers; toasts became an elevated
panel with a status accent bar.

Two items went beyond tokens, each committed separately so it can be reverted
alone: a local `Toast` component (the library hardcodes its variants as a solid
fill with no restyle lever, filed as my-you-eye#40) and the Shared-view column
split. Reviewed against before/after screenshots over two rounds; round 1 was
judged too subtle to answer the verdict and round 2 added the toast, tab and
palette work.

# Design spec — "VSNote"

Source of truth: originally `app-preview.png` (removed from the repo 2026-08-17,
user request, along with `search.png`; available in git history pre-removal —
this doc is now the standalone authority). This doc translates that image into
buildable detail. When in doubt, open the image and match it.

## Overall look

- Dark, near-black theme. Three surface depths: window chrome / activity bar (darkest,
  `#0e1015`), editor (`#101318`), sidebar (lightest of the three, `#15171c`) — the
  sidebar reads as the "elevated" panel, not the editor (corrected against
  app-preview.png; the editor is the darkest content surface, one step above the
  activity bar).
- Accent: teal/cyan (used for: active tab underline, selected mode toggle, headings in
  rendered markdown, links, folder icons, branch icon).
- Git colors: modified = yellow/amber `M`, added = green `A`, deleted = red `D`
  (name struck through), untracked = purple/violet `U`.
- UI chrome and code use a monospaced font (JetBrains Mono feel); rendered markdown
  body uses a clean sans/serif-ish reading font.
- Density: compact, VSCode-like. Rounded corners are subtle.

## Layout regions (top → bottom)

### 1. Title bar
- ~~macOS traffic lights (decorative),~~ app glyph + `VSNote` — `vault` (workspace
  name). (superseded by Amendments item 2 — no traffic lights, no placeholder; the
  bar starts directly at the glyph.)
- Centered global search field: placeholder "Search files, symbols, commits…", `⌘K` kbd
  hint. Opens the command palette.
- Right: icon buttons — toggle sidebar, split editor (may be non-functional stub),
  settings gear.

### 2. Activity bar (far-left vertical rail)
- Icons top→bottom: Explorer (active state = lighter icon + left indicator), Search,
  Source Control (shows count badge, e.g. `6` = changed files), Extensions (stub).
- Bottom: settings gear.

### 3. Sidebar — Explorer
- Header row: `EXPLORER` label (small caps, muted) + action icons: new file, new folder,
  refresh, filter/collapse.
- "Filter files" input (small, with search icon) filtering the tree live.
- File tree:
  - Folders: teal folder icon, chevron, expandable. Files: per-type colored icon
    (md=teal doc, ts/tsx=blue/cyan code glyph, json=yellow braces, css=purple/blue `#`,
    csv=green table, png=image glyph).
  - Right-aligned git status letter per file (M/U/A/D, colored as above). Deleted files
    stay listed with red strikethrough name.
  - Selected row: highlighted background + accent left edge.
  - Right-click context menu: New File, New Folder, Rename, Delete (confirm dialog),
    Reveal in tree, Copy path.
  - Inline rename (input replaces the label).
- Demo vault contents must match the screenshot: `vault/notes/{architecture.md [M],
  daily-2026-08-14.md [U], reading-list.md}`, `vault/src/{indexer.ts [M],
  searchRank.ts [M], GraphView.tsx [A], theme.css, legacy-parser.ts [D]}`,
  `vault/assets/` (collapsed; contains `cover.png`), `vault/metrics.csv [M]`,
  `vault/vault.config.json`. (`searchRank.ts` postdates the reference screenshot —
  added as a 4-hunk +26/−10 diff showcase; see seed.ts.)

### 4. Editor group
- **Tab bar**: one tab per open file — file-type icon, name, close ×. Dirty (unsaved)
  = amber dot `#eab444` shown *beside* the close ×, not replacing it (corrected against
  app-preview.png). Tab filenames are NOT git-tinted: active = bright `#d8dfe6`,
  inactive = muted `#848a92` (corrected against app-preview.png — the amber in the tab
  bar is the dirty dot only; the file *tree* is where git-modified names go amber).
  Preview tab (single-click open) = italic name (see `cover.png` in the image).
  Active tab: background `#101318` — the same as the editor and *darker* than the
  `#17191f` tab strip, so the active tab merges into the editor below it (corrected
  against app-preview.png; previously described as "lighter background") + teal top
  edge. Overflow `…` menu at right.
- **Editor header row**: left, Breadcrumbs `vault / notes / architecture.md`.
  Right: diff stat chip `+12 -5` (green/red), then a segmented mode toggle:
  `◉ Rendered` | `</> Source` | `⇄ Diff` — active segment is a dark teal wash
  (`color-mix` of the surface and accent, not a solid fill) with teal icon/text
  (corrected against app-preview.png; previously described as "filled teal").
  Segments enable/disable per file type (see Modes below).
- **Content area**: per-mode view, ScrollArea, comfortable max-width column for
  rendered markdown (centered, generous margins as in the image).

### 5. Status bar
- Left: branch `feat/incremental-index` (git branch icon), sync arrows `↑3 ↓1`
  (ahead/behind), cloud icon + `synced 2m ago`, `+12 -5`, `1 untracked`.
- Right: `Ln 14, Col 32`, `UTF-8`, `LF`, language id (`MD`), notification bell.
- Every segment is hoverable (tooltip) and the sync segment is clickable
  (triggers simulated sync with progress → toast).

## Modes (the toggle)

| File type | Rendered | Source | Diff |
|---|---|---|---|
| `.md` | Obsidian-style live preview (default) | CM6 markdown source | CM6 merge vs HEAD |
| `.html` | sandboxed iframe preview | CM6 highlighted | merge vs HEAD |
| `.csv` | DataTable | CM6 plain/highlighted | merge vs HEAD |
| `.json` | tree/pretty view | CM6 highlighted (default) | merge vs HEAD |
| code (`.ts/.tsx/.css/…`) | — (disabled) | CM6 highlighted (default) | merge vs HEAD |
| images | image viewer (only mode) | — | — |

### Markdown live preview (the Obsidian behavior — non-negotiable)
- Editing happens in a CM6 editor whose decorations render markdown WYSIWYG:
  headings styled as headings, bold/italic applied, links clickable, lists bulleted,
  code blocks highlighted, blockquotes styled.
- Raw markdown syntax (`#`, `**`, `[]()` markers) is hidden EXCEPT in the smallest
  region containing the cursor/selection — put the cursor in a bold word and only that
  word reveals `**…**`; leave it and it re-renders. Never dump the whole document as
  raw text in editing mode.
- "Rendered" mode = this live preview. A read-only reading view is this same view with
  editing disabled (optional lock toggle), not a separate renderer, so the two feel
  identical (Obsidian read/write parity).
- Internal links `[text](file.ext)` render accent-colored and open that file in a tab.

### Rendered markdown typography (match image)
- H1 large bright bold (`#d8dfe6`); H2 teal; body light-gray (`#bac1c8`), relaxed line
  height, ~46ch measure; inline code is bare lime-green mono text (`#a8d578`, no chip,
  no border — corrected against app-preview.png, which has no amber chip anywhere in
  the rendered body); bold bright; blockquote with left accent border, italic, muted
  gray text; fenced code blocks sit flush on the editor background (`#101318`, same as
  the page — no raised surface, no border, no rounded box), mono, same lime-green token
  color as inline code (corrected against app-preview.png; previously described as
  amber-tinted on a raised surface).

## Git features

- Real repo in-browser (isomorphic-git + lightning-fs), seeded with history so the
  screenshot's states exist for real: per-file M/A/D/U, `+12 -5` for architecture.md,
  6 total changes (badge), 1 untracked, branch `feat/incremental-index`, ahead 3 /
  behind 1 vs simulated remote.
- Source mode gutter: colored change bars vs HEAD (green added lines, blue/yellow
  modified, red triangle for deletions), VSCode-style.
- Diff mode: side-by-side or unified merge view vs HEAD with word-level highlights.
- Source Control activity view (sidebar panel): changed file list with status letters,
  open-diff on click; commit message box + Commit button (commits locally, updates
  everything live); simulated push/pull adjusting ahead/behind.

## Misc / settings

- Command palette (⌘K): file jump + commands (toggle mode, theme, sync, new file…),
  grouped results.
- Settings dialog: theme (dark default; the library's themes), accent color, editor font
  size, tab size, word wrap, "reading view lock" default mode per file type.
- Empty state when no tab is open (logo + shortcut hints, muted).
- Toasts for sync results, deletes, errors. Tooltips everywhere on icon buttons.
- Keyboard: ⌘K palette, ⌘P file jump, ⌘S save (clears dirty dot, keeps git-dirty),
  ⌘W close tab, ⌘E toggle Rendered/Source (Obsidian muscle memory).

## Amendments — user feedback 2026-08-15 (these OVERRIDE anything above)

1. **File icons = Material Icon Theme (Philipp Kief).** Use the npm package
   `material-icon-theme` (MIT, the VSCode icon theme's SVG set). `FileIcon` maps
   extension/filename → that pack's SVGs (and its folder icons for the tree, including
   open/closed folder states). This replaces any hand-mapped lucide glyphs for
   file/folder identity. lucide-react stays for UI chrome (chevrons, git, gear, …).
   The mockup's flat colored glyphs are superseded by this pack.
2. **No macOS traffic lights.** Remove the three circles from the title bar entirely —
   no placeholder spacer. Title bar starts with the app glyph + name.
3. **~10% slimmer chrome.** Reduce vertical thickness of: title bar, tab bar, editor
   header row (breadcrumbs + mode switcher), sidebar header + tree row height, status
   bar. Target ≈90% of the mockup's heights — tighter than the image, same look.
4. **Zen mode (content-area fullscreen).** A command + toolbar affordance + shortcut
   that expands ONLY the editor content area: hides activity bar, sidebar, tab bar,
   editor header, status bar. `Esc` exits; a subtle floating pill shows filename +
   exit hint on hover. Optionally also request browser fullscreen (Fullscreen API).
5. **Own the browser shortcuts.** Global keydown handler with `preventDefault` while
   the app has focus: `Ctrl/⌘F` opens OUR search (editor search panel in
   Source/Diff; note-text search in Rendered), never the browser's. Same for `⌘S`
   (save), `⌘K`/`⌘P` (palette). `⌘W` is best-effort (browsers may reserve it) —
   provide `Ctrl/⌘⇧W`-style fallback and document it in the palette.
6. **Statefulness is a hard requirement.** Persist and restore across reloads:
   settings; open tabs + order + active tab + per-tab mode + pinned/preview state;
   and **unsaved buffers** — every dirty editor buffer is checkpointed (debounced,
   e.g. 300ms) to IndexedDB, so closing/reloading the browser NEVER loses unsaved
   work. On reopen, dirty tabs come back dirty with their draft content intact.
   Vault files already persist via lightning-fs.
7. **Tree drag & drop** (Phase 2, part of file ops). Drag files/folders in the
   explorer to move them: drop ONTO a folder row = move inside (row highlights,
   folder auto-expands on hover); drop BETWEEN rows = precise placement shown by an
   insertion indicator line; Esc cancels mid-drag; invalid targets (into own
   descendant) refuse visibly. Moves are real fs renames, so git status reacts.
8. **Grid split view — better than Obsidian's** (Phase 6). Terminal-multiplexer-style
   power, mouse-first and discoverable, NOT keyboard-only:
   - Drag a tab toward any edge/quadrant of the editor area → a live drop-zone
     preview highlights exactly where the new pane will land (VSCode-style docking);
     release to split. Also available as a button/menu on the tab.
   - Panes form a recursive grid: any pane splits horizontally or vertically,
     dividers drag to resize, double-click a divider to equalize siblings.
   - Each pane has its own tab strip, active file, and mode toggle (so
     source | rendered of the same file side-by-side works naturally).
   - Closing a pane's last tab collapses the pane; neighbors reclaim the space.
   - Layout persists (see item 6). Keyboard shortcuts exist as accelerators only —
     everything must be reachable by mouse alone.

Planned-but-not-yet: sharing/publishing + authentication + a Python/FastAPI backend +
real remote sync (approved) are queued for v2 — see `docs/ROADMAP-SHARING-AUTH.md`.
Do NOT implement any of it until explicitly scheduled; v1 stays fully client-side.

## Amendments round 2 — user feedback 2026-08-15 (from hands-on use; OVERRIDE above)

9. **Find widget, VSCode-style** (replaces the current CM6 search panel — the user
   called it "old looking"; reference image `search.png` at repo root). A floating
   card overlaying the TOP-RIGHT of the focused pane's content area — it must NOT
   push the text down. Row 1: expand chevron (left edge), find input, toggle icons
   `Aa` match case / `ab` whole word / `.*` regex, live counter `1 of N` (or
   "No results" in red), prev/next arrows, close ×. Row 2 (only when chevron
   expanded): replace input + replace-one and replace-all icon buttons. App tokens,
   subtle shadow, rounded. Keys: ⌘F opens (prefilled from selection), Enter/⇧Enter
   next/prev, Esc closes. Implement as a CM6 panel replacement or DOM overlay bound
   to the pane's search state — either way it drives @codemirror/search queries so
   match highlighting stays native.
10. **Resizable sidebar.** Drag the file-tree's right edge (reuse the PaneDivider
    affordance): min ~180px, sensible max (~50vw), width persisted and restored.
11. **Settings become a full view, not a modal.** The current dialog "feels slapped
    in". Open Settings as a TAB in the editor area (VSCode-style): left category
    nav + searchable content, styled entirely with app tokens. Categories & content:
    - *Appearance*: theme, accent, UI density.
    - *Editor*: font size, tab size, word wrap, line spacing.
    - *Rendered view*: content column max-width / left-right margins, line spacing,
      per-file-type DEFAULT MODE (label it explicitly, e.g. "Default view when
      opening Markdown: Rendered | Source" — this is the setting that confused the
      user; name it "Default view mode", never just "mode").
    - *Git & Sync*: branch/repo info (read-only, real ahead/behind), plus a
      remote-URL and HTTPS auth-token field pair. **v1**: presented as
      "Remote sync — coming soon" placeholders (disabled inputs, stored but
      unused). **v2 Phase 11 (current)**: wired up for real — enabled
      inputs, a "Generate token" action, and a "Test connection" action
      reporting a real result; see `docs/ARCHITECTURE.md`'s "Real sync
      (Phase 11)" section and `docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 11.
      NO SSH-key management, in v1 or v2: browsers cannot speak SSH (no raw
      TCP) — sync uses HTTPS + token via isomorphic-git, against the v2
      backend's `/git/*` smart-HTTP endpoint.
    - *Storage*: persistence status (storage.persist() result), Export vault as
      .zip, Reset demo vault.
    - *Keyboard*: read-only shortcut reference.
12. **Selection discipline.** `user-select: none` on all chrome (tree, tabs, bars,
    menus, buttons); text remains selectable ONLY in editor/rendered content and
    form inputs.
13. **Diff unified/split toggle presentation.** Keep the capability, redesign the
    control: when Diff mode is active, a compact icon-only SegmentedControl
    (unified ⧉ / split ⫿⫿ with tooltips) appears in the editor header next to the
    mode toggle, same visual language. Remove whatever ad-hoc control exists now.
14. **Image viewer polish.** Images must not be selectable or ghost-draggable:
    `user-select: none`, `draggable={false}`, `-webkit-user-drag: none` on the img
    and its container.
15. **Representative demo data.** Replace the toy CSV/JSON: `metrics.csv` gets 12+
    columns × 40+ rows with mixed types (dates, URLs, floats, long text cells) to
    exercise truncation/scrolling/sticky header; `vault.config.json` gets deep
    nesting, arrays of objects, and long string values. CRITICAL: the seeder must
    still reproduce the screenshot git states (metrics.csv keeps its `M`, +12 −5 on
    architecture.md, 7 changes, 1 untracked, ahead 3 / behind 1; "7" grew from the
    screenshot-era 6 when `searchRank.ts` was added as a multi-hunk diff showcase).
16. **Typing latency (performance bug, not a feature).** Typing feels subtly
    delayed. Profile the keystroke path and fix the cause(s); likely suspects:
    per-keystroke React re-renders of the whole shell (e.g. cursor Ln/Col state
    lifted into App), store update cascades, draft checkpoint work on the input
    path, live-preview decoration recompute breadth. Requirements: a keystroke must
    be handled inside CodeMirror without re-rendering the React shell; Ln/Col
    updates reach the status bar via a targeted subscription only; draft
    checkpointing stays debounced AND off the critical path (idle-scheduled).
    Verify with a performance trace before/after: no long tasks > 16ms per
    keystroke while typing continuously in a 1k-line markdown doc in Rendered mode.


## Amendments round 3 — user feedback 2026-08-15 evening (OVERRIDE above)

17. **Zen mode hides EVERYTHING, title bar included.** Only the text/content area
    remains (plus the floating filename/exit pill on hover). Supersedes the round-1
    five-region list, which wrongly omitted the title bar.
18. **Header consolidation — remove the inner editor-header row.** The title bar
    absorbs the focused pane's controls: breadcrumbs, diff-stat chip, mode toggle,
    unified/split diff toggle, zen button. The global search field shrinks to a
    single icon button on the right cluster (it opens the command palette — that
    is its only job); the shortcut lives in its tooltip only, not as a separate
    visible `⌘K` badge next to the icon (corrected during implementation — an
    icon *and* a literal "⌘K" badge both read as "this is the search shortcut,"
    which is redundant, and every sibling action in the same cluster — sidebar
    toggle, split, settings — is already a bare icon button with its shortcut
    in the tooltip only; matching that pattern instead of being the one
    exception). Rule for the pane grid: with >1 pane, each pane keeps a
    slim per-pane header (per-pane modes require it) and the title bar mirrors the
    FOCUSED pane; with a single pane, no inner header exists at all — the title bar
    carries everything. Net effect: one less horizontal band in the common case.
19. **Single-Esc fullscreen exit.** Currently browser fullscreen swallows the first
    Esc and zen needs a second. Listen to `fullscreenchange`: when browser
    fullscreen ends and zen is active, exit zen in the same event. Esc pressed while
    zen-but-not-browser-fullscreen exits zen directly. One press, always.
20. **Sidebar collapse/expand.** Dragging the sidebar edge below a snap threshold
    (~120px) collapses it to zero (no half-dead sliver). Expand it back by:
    clicking any activity-bar view icon (VSCode behavior — the icon of the current
    view toggles the sidebar, another view's icon opens the sidebar showing that
    view), and a thin grab edge remains draggable. Collapsed state persists.
21. **Two new demo files** (added via seeder, untracked/U or committed — keep
    existing git-state invariants intact): `notes/markdown-kitchen-sink.md`
    exercising EVERY supported element (h1–h6, bold/italic/strikethrough, nested
    lists, task lists, links incl. internal, images, nested blockquotes, inline
    code, fenced code in several languages, tables, horizontal rules), and a simple
    `demo.html` (a small styled page — nothing complex) for the HTML preview.
22. **Theme compatibility + per-theme syntax colors.**
    (a) BUG: switching to the library themes `metallic`, `glass`, `comic` leaves
    `TexturedSurface` inert. Root-cause it: almost certainly the app's `theme.css`
    token overrides (written for the default dark look) clobbering the texture/
    surface variables those themes set. Fix by scoping the app's overrides to its
    own theme (e.g. `:root[data-theme="vsnote"]`) so library themes apply cleanly.
    (b) Per-theme syntax highlighting: drive the CM6 highlight style entirely from
    CSS custom properties (`--syntax-keyword`, `--syntax-string`, …) with the
    current colors as the base definition, redefined per `data-theme` so each theme
    ships its own syntax palette. Live preview code blocks and CodeBlock renderers
    follow the same variables.
23. **Density must be real.** The UI density setting currently only nudges text.
    Make compact/default/comfortable scale the actual chrome tokens — row heights,
    paddings, icon spacing, tab/status-bar heights — visibly different at a glance.
24. **Find widget 30–40% smaller** (font, paddings, control sizes — same layout).

## Amendments round 4 — user feedback 2026-08-16 (hands-on with the full stack; OVERRIDE above)

25. **Full width must be reachable.** The rendered-content max-width slider's top
    position becomes "Full": it removes the `max-width` cap entirely instead of
    clamping to a ch value. With margins at minimum and width at Full, text spans
    the whole editor area on any monitor.
26. **No browser basic-auth popups, ever.** The git smart-HTTP 401 currently
    carries `WWW-Authenticate: Basic` on every response; a browser fetch receiving
    it triggers the native login dialog (the user saw this ~every 60s from the
    background git poll while signed out). Fix both halves: (a) the server sends
    the `WWW-Authenticate` challenge ONLY to git clients (User-Agent starting
    `git/`), never to browser requests; (b) the client suspends /git polling
    entirely while whoami says unauthenticated, resuming on sign-in.
27. **"Test Connection" button** in Git settings: text overflows the button; make
    it fit (size to label, no truncation, no wrap).
28. **UI copy rule (global, permanent): hints, tooltips, and setting descriptions
    are ONE row, concise and simple — drop details rather than wrap. ZERO em
    dashes in any UI copy.** Sweep ALL existing hint/description text to comply,
    not just new strings. Add a lint/test guard if practical (grep for `—` in
    user-facing string sources).
29. **App title is a static "VSNote".** Title bar text and `document.title` show
    exactly `VSNote`; delete the dynamic `- vault` suffix (tree + breadcrumbs
    already show location). No other rebrand — internal names stay.
30. **New-file/rename inline editor.** Creating a file starts with an EMPTY name
    field (no `untitled.md` prefill to fight); confirming an empty name cancels
    the operation silently. The inline editor must be visually natural: same
    position, font, and row size as the final tree row — no oversized box, no
    layout shift.
31. **Publish modal "Sign In" button** must never wrap to two rows.
32. **Fallback-login onboarding.** Today NO user exists and nothing creates one
    (login is dead outside the demo script). Add: `VSNOTE_BOOTSTRAP_USER` +
    `VSNOTE_BOOTSTRAP_PASSWORD` env vars that create that account at startup iff
    no users exist (never overwrite, never log the password), plus a
    `server/scripts/create_user.py` CLI (username prompt + hidden password
    prompt, argon2id). Document both in server/README.md; the Publish modal's
    signed-out state hints at it in one row per item 28.
33. **Big-file safety for CSV/JSON renderers.** Column type inference stays
    per-column (all non-empty values must agree) — cheap, linear, keep it. The
    risk is DOM size: add generated stress fixtures (~50k-row CSV, deep/large
    JSON), measure, then cap rendering ("showing N of M rows" + a load-more or
    virtualized rows via ScrollArea; JSON tree renders lazily on expand). The
    fixtures become committed tests so regressions fail the suite.

## Amendments round 5 — user feedback 2026-08-17 (post-release; OVERRIDE above)

34. **Full rebrand: Slate → VSNote, everywhere.** The internal "Slate" brand is
    retired. Sweep every occurrence that reaches a user or operator: env vars
    `SLATE_*` → `VSNOTE_*` (no back-compat aliases; we are one day past first
    release), `slate.db` → `vsnote.db` default, package.json name `slate` →
    `vsnote`, pyproject `slate-server` → `vsnote-server`, git auth realm,
    cookie names, compose env keys, `.env.example`, CI workflow, server/README
    and docs prose. **Amended 2026-08-17: the browser-side persistence keys
    rename too** (lightning-fs DB name and every zustand persist key →
    `vsnote-*`), explicitly WITHOUT migration — the user accepts that
    pre-rename local browser data is orphaned (a fresh store simply starts;
    the old IndexedDB/localStorage entries are just never read again). Note it
    in CHANGELOG as breaking. Internal identifiers/test ids may keep `slate`
    only where renaming them would churn tests for zero user benefit — but
    nothing user-visible or operator-visible says Slate afterwards. Record the
    breaking env rename in CHANGELOG's Unreleased.
35. **Remove the commented cloudflared sidecar from docker-compose.yml.** It is
    one operator's personal topology, not a project default. server/README.md
    may keep ONE sentence noting any HTTPS reverse proxy or tunnel works
    (proxy headers are honored); no vendor-specific config blocks anywhere.
    `CF_ACCESS_*` vars stay (optional, unset = disabled — they implement the
    roadmap §2 Access-JWT feature, independent of any tunnel).
36. **Demo vault becomes opt-in.** Default first boot seeds a minimal clean
    vault (a short `welcome.md`, nothing else). The full demo vault loads only
    (a) when the build sets a demo flag — the GitHub Pages build sets it, so
    the public demo keeps its showcase content — or (b) via an explicit
    palette command ("Load demo vault"), which warns it replaces the current
    vault. "Reset demo vault" semantics stay coherent with whichever mode is
    active. (For clarity: the Pages demo is static; every visitor's vault
    lives in their own browser's IndexedDB — fully isolated per visitor,
    persistent for that visitor across refreshes, invisible to everyone else.)
37. **WITHDRAWN 2026-08-17 (same day, user decision): NO editor right-click
    menu.** The browser's native editor context menu stays untouched. The
    Format/Insert actions originally sketched here move into item 38's
    three-dot overflow menu instead. Do not build an editor ContextMenu.
38. **Three-dot overflow menu: Format, Insert, Export.** A `⋯` icon button in
    the title bar actions cluster (and per-pane header when >1 pane) opens a
    menu (amended per user: this menu is ALSO the home of text actions, not
    just file actions):
    - **Format** submenu (markdown files, editable modes only; disabled
      otherwise): bold, italic, strikethrough, inline code, link — applied to
      the focused editor's current CM6 selection/cursor.
    - **Insert** submenu (same gating): table, code block, horizontal rule.
    - **Export as PDF**: renders the file's Rendered view into a print-clean
      layout (no app chrome, sensible margins, light background,
      syntax-highlighted code) and invokes the browser's print dialog
      (browser print-to-PDF is the engine; no server, no new deps). "Export as
      HTML" may ride along if it is a trivial reuse of the same pipeline.
39. **Import into the vault: OS drag-drop + clipboard paste.** (a) Dragging
    files (and, where the browser supplies directory entries, folders) from the
    OS onto the file tree copies them into the vault at the drop location, with
    the same drop-target affordances as internal tree DnD; conflicts prompt
    rename-or-replace. (b) Ctrl+V with files or an image on the clipboard,
    while the tree has focus, pastes them into the selected folder (Chromium:
    files + images; Firefox delivers images only — degrade gracefully, never
    error on an empty clipboard read). Binary files land as-is; a pasted bare
    image gets a timestamped filename.
40. **Share blob limit editable in Settings** (added 2026-08-17, same day):
    the server gains a small DB-backed runtime-settings store for
    admin-adjustable values, first tenant: max share blob size. `GET/PUT
    /api/admin/settings` (admin/owner-scoped, behind the normal auth; PUT
    validates bounds, e.g. 1–100 MB), enforcement reads the DB value, and the
    `VSNOTE_MAX_BLOB_BYTES` env var becomes the initial default written on
    first boot (env changes apply only until an admin has set a value).
    Settings → Sharing (visible when signed in as admin) exposes it with a
    one-row hint. Audit-log the change like other admin actions.
41. **Friendly git configuration management** (added 2026-08-17, same day).
    Facts first: the tree's top folder is the LOCAL vault root directory
    (`/vault`), and the sync remote is separately hardcoded
    `<origin>/git/vault.git` — they match by convention only. Changes:
    - Settings → Git & Sync becomes a real management surface: shows the
      resolved remote URL and branch; **repo name** configurable (default
      `vault`, making the implicit remote `<origin>/git/<repo>.git`); **vault
      display name** renameable (the tree's top-folder label; safe FS-root
      rename or a display-name mapping — worker's choice, but tabs,
      breadcrumbs, and paths must stay consistent).
    - **Advanced: custom remote override** — optional full remote URL +
      token/credential pair for external remotes (GitHub/Gitea/another
      VSNote), off by default. Roadmap §5.4's "no settable server URL" stands
      for the app/API origin; the GIT REMOTE specifically is user-configurable
      per this item (it was always the roadmap's "optionally GitHub/Gitea +
      PAT later"). Same sync semantics on any remote: fast-forward,
      auto-merge with backup refs, never force-push. "Test connection"
      validates whichever remote is active and reports reachability, auth,
      and repo existence concisely.

## Phase 17 amendments — server-mounted vault, login gate, auto-sync (2026-08-17)

42. **App-wide login gate.** On boot, the client reads the public, unauthenticated
    `GET /api/app-config` (`login_required`/`password_login`/`cf_access`). When a
    REACHABLE backend answers `login_required: true` and the caller has no session
    (`whoami().authenticated === false`), the shell never mounts — a login screen
    renders instead: the VSNote wordmark (the title bar's own gradient glyph, larger),
    a `Card` with username/password `Input`s and a `Button` (library components only,
    same dark near-black + teal/cyan accent surface as the shell), a one-row `Alert`
    on a wrong-credentials failure, and a distinct "Working offline" `Alert` state when
    a login attempt itself can't reach the backend. A successful sign-in flips straight
    into the shell with no reload. An UNREACHABLE backend (fetch failed/timed out) or
    `login_required: false` NEVER gates — CLAUDE.md rule 3's local-first guarantee
    wins outright: an already-loaded or PWA-cached app keeps editing its own local
    clone fully offline, gate or no gate. Cloudflare Access in front needs no
    gate-specific client code at all — an Access-authenticated request already
    resolves `whoami()` to authenticated before the gate ever has a reason to render.
    The vault does not seed behind the gate: `App.tsx`'s own boot sequence (seed, fs/git
    store refresh) only starts once the shell itself mounts, so a visitor who never
    signs in never touches local IndexedDB at all. The gate must never flash the shell
    first and must not delay a normal (ungated) boot beyond the one `/api/app-config`
    round trip it already needs to decide.
43. **Auto-sync policies.** Settings → Git & Sync gains an "Auto-sync" row: `Manual,
    click Sync` (today's behavior, still the default), `Every N minutes` (interval
    input, one-minute floor), `On app open and close`, and `After each save`
    (debounced, so a burst of saves collapses into one sync attempt). Every policy
    invokes the exact same one-button Sync pipeline a manual click uses (fetch →
    fast-forward/push → clean auto-merge with backup refs → the resolver only for a
    true conflict) — the setting only decides WHEN it fires, never a second sync
    implementation. An auto-sync attempt never fires while a sync is already running,
    while signed out, or while a previous run is paused on an unresolved conflict (no
    silent auto-resolve, no retry loop), and it never competes with the existing ~60s
    background ahead/behind fetch. One-row hints throughout, no em dashes.
44. **Server-vault setup wizard + mirror-remotes management (Phase 17 Milestone C2).**
    Settings → Git & Sync's new first row ("Server vault") renders one of two shapes,
    inline in this same category, never a modal, never a new route:
    - `GET /api/vault` reports `initialized: false`: a stepped wizard. Step 1 ("Create
      the vault repository") shows the resolved server path and an editable branch
      name defaulting to this client's own default branch, explains in one row that an
      existing repository is never overwritten, and calls `POST /api/vault/init`. Step
      2 ("Connect an external remote", optional, skippable) reuses the exact same
      mirror-remotes table/dialog the management surface below uses to add one remote
      (URL plus either an SSH private key paste or an HTTPS token), with "Test
      connection" and "Mirror now" available immediately; "Skip for now" or "Done"
      either way reveals the management surface. The step-2 gate is a purely
      client-side, this-session affordance (the server has no "wizard progress"
      concept, only `initialized`) — a reload after step 1 completes never re-shows
      the wizard.
    - `initialized: true`: no wizard at all. Shows the server's real reported state
      (path, mounted vs. legacy shape, branch, last commit, whether the server's own
      working tree has uncommitted changes) alongside the existing Git & Sync rows,
      plus the mirror-remotes management table: add / edit / replace credential /
      clear credential (destructive, `ConfirmDialog`) / delete (destructive,
      `ConfirmDialog`) / test connection / mirror now, each row showing its last
      status and error. A submitted SSH key or HTTPS token is write-only end to end
      (never stored, echoed, or redisplayed client-side after it is sent) and copy
      says plainly that keys and tokens stay on the server, never "stored in the
      browser". When the server's own vault repository name differs from this
      client's "Repository name" setting, a one-row `Alert` names both values and
      states explicitly that Sync uses the client setting, not the server's name.
    - Backend unreachable or not signed in: the whole row degrades to a one-row
      explanation (same treatment the Sharing category already gives), never blocking
      the rest of Settings, never a console error. One-row hints throughout, no em
      dashes.

## Amendments round 7 — user feedback 2026-08-17 (hands-on with Phase 17; OVERRIDE above)

Confirmed decisions for this round: Google/OAuth sign-in is DEFERRED to its own later
phase (restricted sharing stays account-based for now); folder shares stay in sync via
client-side AUTO-REPUBLISH (debounced manifest update), not live server reads.

45. **Status bar compact overflow.** In compact density the status bar narrows but its
    text does not adapt, so items overflow. Fix with priority + truncation: low-value
    items drop first, remaining text ellipsizes, nothing ever paints outside the bar.
46. **Settings layout: full-bleed page, capped controls.** The category page stays full
    width, but controls stop stretching with it: each row is label-left / control-right
    (or label-above on narrow), and inputs, selects, sliders, and search cap at a fixed
    comfortable width (~28rem); buttons keep natural size. A full-window slider or
    search field must never occur again.
47. **Accent contrast guard enforced everywhere.** Picking pure black (or any
    unreadable accent) on the dark theme currently reaches the UI raw: button parts
    blend away and accent-tinted markdown (h2 to h6 headings, links) turns invisible.
    The round 6 guard (walk lightness to 4.5:1 before applying) must actually govern
    `--color-primary` on every surface, main app and share app alike, from first paint
    (not only after a settings change). The h1 = foreground / h2+ = accent split is
    deliberate design and stays; it simply must inherit the guarded color.
48. **Active-line highlight respects the gutter boundary.** With a scrollbar present
    the highlight ends correctly; without one it paints over the boundary line. Same
    right-edge inset in both cases.
49. **Login view optical centering.** The wordmark must not push the form down; the
    logo + form group is centered as ONE unit at the eye line (slightly above true
    vertical center), logo sized so the form stays the visual anchor.
50. **Vault init must not 500 on volume permissions.** Root cause: the named volume at
    `/data/vault` is created root-owned while the container runs as uid 1000. The
    container start path must make the vault directory writable (entrypoint chown of
    the vault dir only, never a blanket chown), and if the server still cannot write
    it, `POST /api/vault/init` returns a clear 4xx/503-style JSON error naming the
    path and the fix, never a raw 500 traceback. The wizard surfaces that message
    verbatim in its one-row error state.
51. **Sharing panel refresh must not flash.** Refresh keeps the existing table rows
    mounted, dims them (or overlays a skeleton) until the fetch resolves, then swaps
    data in place. The view never visibly unmounts or reflows during a refetch. Apply
    the same rule to every list refresh in Settings (mirror remotes table included).
52. **Git & Sync: single opt-in setup view when git is absent.** When the vault has no
    repo/sync configured, the Git & Sync category shows NOTHING but a setup invitation
    (what sync does, one button to begin). Nothing sync-related is enabled by default.
    One exception: the "Show git status in explorer" toggle stays visible on both
    sides of the gate; it governs LOCAL-git display over the always-present
    in-browser repo, not sync.
    The guided flow assumes zero git knowledge: plain-language steps, remote repo
    optional; when no explicit remote is configured, NO implicit server URL (for
    example `http://localhost:8787/git/vault.git`) is ever displayed as if the user
    had set it. Sync-to-this-server and mirror-to-external stay distinct, each named
    in plain words at the point of choice.
53. **Vault identity simplified.** Retire the freeform "Repository name" +
    invented-branch prefill (`feat/incremental-index`, a scaffold-era default in
    `src/git/client.ts`). New setups default the branch to `main`. The vault's
    identity (repo name + branch) is server/derived and shown as a crafted read-only
    identity chip/card, not two raw text inputs. Existing vaults keep whatever branch
    they already use (a settings migration must not rewrite history or rename
    branches).
54. **Auto-sync modes combinable with a coalescing queue.** Interval, open/close, and
    after-save are toggles that can all be on at once (Manual = all off). Every
    trigger ENQUEUES a sync request into one queue that coalesces bursts: at most one
    sync runs at a time, and completed runs open a quiet window (~10-15s) during which
    further triggers merge into a single pending run. All existing guards stay (never
    while signed out, mid-sync, or paused on a conflict).
55. **Publish dialog layout.** Segmented controls fill their container width. The
    "Requires" select shares a row with the role selector. "General access" defaults
    to "Anyone with the link".
56. **API-token access must be self-serve.** Choosing "Requires: API token" offers
    inline token generation/management (create, name, revoke) right in the dialog, or
    a one-click path to it; never a dead end.
57. **Share model: delivery format x role, independent axes.** Replace "Raw vs
    Rendered" with two orthogonal choices: DELIVERY — "File only" (pure bytes, no
    HTML, right content type; for scripts, configs, anything) vs "Viewer" (the thin
    share app: code files open in the code editor view, markdown in rendered view);
    and ROLE — Viewer/Editor, selectable wherever the server supports write-back, not
    locked behind a particular delivery mode. Raw byte sharing is a first-class mode
    and must not regress. Better names than Raw/UI are welcome but the split is fixed.
58. **Folder shares follow the folder.** Creating, editing, or deleting a file inside
    a shared folder auto-republishes that share's manifest (debounced, best-effort,
    silent on offline/signed-out; the next successful update self-corrects). The
    chain indicator on a child means "this IS shared", so the share must actually
    reflect it without a manual "Update share".
59. **Share stats must be real.** `Hits` and `Last accessed` increment on every
    counted access path (share page loads included) and the Shared panel shows fresh
    values on refresh. If some access paths are deliberately uncounted, the panel
    copy says what counts as a hit.
60. **Restricted sharing must be discoverable.** With "Restricted to listed people"
    selected, the people-and-roles list (add by account email, pick role, remove) is
    visible in the same dialog with a one-row explanation of how recipients sign in.
    Account-based only for now (OAuth deferred, see round 7 header).

## Amendments round 8 — 2026-08-21 (live-preview engine swap; OVERRIDE above)

61. **Rendered mode runs on the `@atomic-editor/editor` engine.** The Obsidian
    live-preview behavior itself is unchanged and still non-negotiable: one raw-
    markdown document, rendered by default, raw syntax revealed only around the
    cursor, instant re-render on leave. Two user-visible deltas come with the
    hardened package: (a) Rendered mode's Ctrl/⌘F panel is atomic-editor's own
    minimal find bar (same native match highlighting; Source/Diff keep the React
    `FindWidget`) — item 9's "vanilla panel replaced everywhere" intent now reads
    "replaced in Source/Diff; Rendered uses its engine's panel"; (b) the Rendered
    margin slider applies as horizontal page padding (the engine owns vertical
    rhythm). Implementation detail lives in ARCHITECTURE.md's 2026-08-21 deviation
    entry.

## Amendments round 9 — 2026-08-21 (skills-analysis hardening pass; OVERRIDE above)

43. **Sidebar chrome token namespace.** Persistent side-panel chrome — the
    `SidebarContainer` shell and the row surfaces inside the Explorer, Search, and
    Source Control views — paints exclusively from a dedicated `--sidebar-*` family
    (`--sidebar-bg/-border/-item-hover/-item-active/-badge-bg/-badge-fg`) defined in
    `src/theme.css` for every theme (derived block) with exact hand-sampled values in
    the VSNote-default block. Rationale: sidebar hierarchy no longer borrows generic
    `--color-surface-*` tokens, so per-theme side-panel tuning can't drift page
    content; switching `data-theme` + `.dark` alone still restyles everything.
    Text inside the sidebar stays on global fg/muted tokens by design. Initial
    values equal the surfaces these regions already painted — pixel-identical
    migration; shadcn's `--sidebar-*` namespace is the precedent (see
    docs/COMPONENT-BACKLOG.md §2.4).
44. **Resize handles are keyboard-operable.** Both `ResizeHandle` consumers — pane
    dividers and the sidebar edge — are focusable separators (`aria-valuenow/min/max`)
    with arrow stepping (Shift = coarse), Home/End clamped to the extremes, and
    Enter/Space as the primary action (equalize the neighboring panes / restore the
    default sidebar width; while collapsed, Enter is the grab-edge restore). Focus
    ring comes from the global accent-token `:focus-visible` baseline.
45. **Demo builds are sandboxed; no destructive demo command.** A
    `VSNOTE_DEMO_VAULT=1` build never touches the real vault database: the
    filesystem is a separate lightning-fs DB (`vsnote-vault-demo-fs`)
    constructed with `wipe: true`, so every page load deletes it and boot
    re-seeds the showcase — fully interactive in-session, zero lasting
    artifacts, real vault structurally unreachable. The former "Load demo
    vault" palette command (whose only function was destroying the current
    vault to make room for demo content) is removed entirely; "Reset demo
    vault…" stays, wiping only the ephemeral sandbox behind its confirm.
    Supersedes item 36's load-command mechanism; item 36's opt-in seeding
    behavior on fresh boots is unchanged.

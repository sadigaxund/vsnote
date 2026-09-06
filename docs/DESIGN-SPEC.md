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
    renders instead: the VSNote wordmark (the title bar's own `Logo` mark, larger),
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
46. **"Restore from remote…"** — non-demo palette command next to Reset
    vault: wipes the local vault (files, edits, git history) then clones the
    currently-configured sync remote into it via the sync pipeline's own
    fetch/fast-forward primitives. Hidden in demo builds (the sandbox never
    touches a real remote). Failure after the wipe falls back to the welcome
    seed with the sync error surfaced — never a broken half-state. Answers
    "start over from what's on the server" without reset-then-reconfigure-
    then-pull by hand.

## Amendments round 10 — 2026-09-05 (logo wiring)

62. **Real mark, not a placeholder chip.** The VSNote mark is a document
    sheet with a folded top-right corner (the markdown/file glyph) wrapped
    by VS Code's ribbon shape (two angled teal bands meeting at the right
    edge) on near-black, single-color (`currentColor`) variant for
    monochrome contexts. Master artwork: `public/favicon.svg` (512
    viewBox, full color) and `public/logo-mono.svg` (stroke geometry).
    `src/components/local/Logo.tsx` transcribes both verbatim as inline
    SVG (`size`/`mono`/`title` props) and is now the ONLY place the mark's
    path data lives outside the two master files. This replaces every
    prior instance of the generic CSS-gradient square + `lucide-react`
    `Layout` icon placeholder ("logo chip") that stood in for the mark in
    `components/TitleBar.tsx`, `share/ShareApp.tsx`, and
    `components/LoginGate.tsx`'s wordmark — none of those ever actually
    drew VSNote's own mark.
63. **Icon generation rasterizes the master SVG.** `scripts/generate-pwa-
    icons.mjs` no longer procedurally draws a "stacked notes" glyph with a
    hand-rolled PNG encoder; it rasterizes `public/favicon.svg` via the
    already-installed Playwright Chromium (`npm run icons`, still fully
    offline, output PNGs checked into `public/` same as before) at each
    manifest size, centered on the `#0e1015` chrome background. Non-
    maskable icons (`pwa-192x192.png`, `pwa-512x512.png`,
    `apple-touch-icon-180.png`) render the mark at ~76% of the canvas;
    the maskable icon (`pwa-maskable-512x512.png`) shrinks it to ~62% to
    stay inside the OS mask's ~80% safe zone, background bleeding edge to
    edge. `index.html` gained the matching `apple-touch-icon` link and a
    `theme-color` meta.
64. **Folder shares removed — SUPERSEDES item 58.** Item 58 ("folder
    shares follow the folder") is superseded: sharing is single-file only
    again (`docs/PLAN-2026-09-05-refresh.md` §4.4). The `ShareKind` enum,
    `Share.kind` column, `ShareManifestEntry` table, every folder route
    (owner-side manifest CRUD and the public `/share/{id}/{relpath}`
    family), and the folder-browsing client UI are gone. There is
    deliberately NO migration and no compatibility path for databases that
    predate the removal. See `docs/ARCHITECTURE.md`'s "Folder shares
    (Phase 10.5) — SUPERSEDED" section and
    `docs/ROADMAP-SHARING-AUTH.md`'s §5.1 marker for the full history.
65. **Raw sharing hardened, not regressed — item 57's byte-sharing clause
    preserved.** Item 57 required that "raw byte sharing must not regress";
    this round's server-side work (`docs/PLAN-2026-09-05-refresh.md` §4.1)
    is exactly that guarantee made explicit and testable: a raw share's
    `Content-Type` is decided by sniffing the blob's bytes (never the
    client-declared `media_type_hint`, never derived from an extension
    alone) and is always one of exactly two values, `text/plain;
    charset=utf-8` or `application/octet-stream` — `text/html` remains
    structurally unreachable. `Content-Disposition` gained a real,
    sanitized `filename` (the basename of the share's source path, or the
    slug if that sanitizes to empty) and a `?download=1` toggle between
    `inline` and `attachment`. `nosniff` and the locked-down
    `Content-Security-Policy` are unchanged. Also landed in this pass: a
    reserved-word list for aliases (`api`, `share`, `git`, `assets`), an
    explicit 60-second expiry skew tolerance (`expires_at` stays a
    timezone-free epoch value), and server-side enforcement of the auth
    matrix (raw: none/token only; rendered: none/password/token, restricted
    sign-in orthogonal to all three) so a hand-crafted request can't reach
    a state the publish dialog never offers.
66. **Per-share bearer tokens — supersedes item 61's "bearer token"
    shorthand.** `auth_mode="token"` used to accept any of the owner's
    account-wide API tokens, so one leaked script token unlocked every
    token-mode share plus the owner API. Tokens are now minted per share
    (`POST /api/shares/{id}/tokens`, plaintext returned exactly once),
    listed (prefix/label/timestamps only, never the secret), and revoked
    individually; a token only ever authenticates the ONE share it was
    minted for. Rotation is mint-new-then-revoke-old, not a dedicated
    endpoint. The owner's account-wide API tokens keep working for the
    owner's own `/api/*` automation, unchanged — they are explicitly not a
    visitor credential for any share anymore.
67. **Dynamic link map — "blog" needs no new share type.** A rendered
    share's content response now carries a `links` map: every relative
    markdown link that resolves, by vault path, to one of the owner's
    OTHER active rendered shares gets rewritten client-side to that
    share's `/share/<id>` URL. Computed fresh on every fetch from stored
    `source_path` strings only — no filesystem access, ever — so sharing a
    new post makes existing links to it resolve immediately, and revoking
    a share breaks links to it immediately, with no republish step either
    way. Password/token/restricted targets are included in the map by
    design: the link is a capability URL that still enforces its own
    policy on click.
68. **`Show title` and `Back link` — two off-by-default, per-share
    opt-ins.** `Show title` publishes the document's H1 (or filename) into
    the share page's `<title>` and OG meta tags — but ONLY for a `none`-
    auth share where access actually resolved; every password/token share,
    and every deny reason, keeps the exact same content-independent shell
    as before this feature existed, so turning the toggle on can never
    become a way to probe whether a protected link exists. `Back link`
    points one plain navigation line at another of the owner's shares
    (typically a blog's index); if that target is later revoked, expired,
    or renamed away, the line simply stops appearing rather than erroring
    or dangling.
69. **Publish dialog and Shared view surfaces for 66-68 — not built this
    pass.** This round's items 66-68 are server-only
    (`docs/PLAN-2026-09-05-refresh.md` §4.2 and all of §5); the publish
    dialog's token mint/rotate UI, the reader's link-rewriting, and the
    `Show title`/`Back link` toggles are client work for a later pass (the
    plan's step 5, "Public reader rewrite + dynamic link map"). Nothing
    here changes today's rendered `<title>` (there isn't one) or Publish
    dialog fields.
70. **Markii extension, Phase M1 (parse + render).** `docs/PLAN-2026-09-05-
    refresh.md` §6: `@markii/core`/`@markii/react` (+ `@markii/stdlib`)
    installed; one static renderer (`src/markdown/render.tsx`) shared by
    print/export, the future public reader (item 67's link map is its
    `links` option), and the new `.mk.md` filetype. Plain `.md` renders
    through the SAME pipeline with the directive registry enabled — a
    `:kbd[x]` in an ordinary `.md` note renders. `doc.css`'s 19 `--mk-*`
    tokens are mapped in `src/theme.css` (derived block for the library's
    other nine themes, hand-sampled exact values for VSNote-default) —
    remapped, never overriding a rule `doc.css` itself derives from them.
71. **`.mk.md` filetype.** A markdown-plus-directives file, registered in
    `filetypes/registry.ts` as `mkmd` (`inferFileKind` checks the full
    `.mk.md` double-extension suffix before the ordinary single-extension
    switch, so it wins over plain `.md`). Source mode: ordinary CM6
    markdown language, plus directive completion (`::`/`:::`/`:`
    triggers), hover documentation, and an "Insert component" command with
    automatic fence lengthening (`src/editor/markiiCompletion.ts`, built on
    vendored `@markii/host` pure functions — see
    `src/markdown/vendor/markiiHost/`, and docs/ARCHITECTURE.md's markdown-
    rendering-pipeline section for why they are vendored rather than
    imported). Rendered mode: a static, 200ms-debounced render through the
    item 70 renderer (`src/renderers/MarkiiPreview.tsx`) — deliberately NOT
    plain `.md`'s CM6 live-preview engine; that stays untouched by this
    phase, and in-editor live-preview directive decorations are Phase M2.
72. **Unresolved relative link degrade (renderer-level, item 67's client
    half).** Wherever `src/markdown/render.tsx` renders a relative link to
    a `.md` file with no entry in a supplied link map, it shows as body-
    colored-muted, non-clickable text carrying a native `title="Not
    shared"` tooltip — never a dead, clickable link. Absolute/external
    links, and every relative link that DOES resolve, render as ordinary
    clickable anchors.
73. **Static code highlighting for print/share.** `src/markdown/
    codeBlock.tsx`'s `<CodeBlock>`: a `<pre>` with line numbers, syntax-
    highlighted via `@lezer/highlight` over the same CM6 language
    `filetypes/registry.ts` already loads for the file's kind — no
    CodeMirror editor instance, read-only static output for a printed page
    or a shared code file. Degrades to plain, correctly-escaped text for an
    unrecognized language; caps at 5,000 lines (item 33's existing perf-cap
    convention) so a pathological file can never flood the DOM. Wired into
    fenced code blocks embedded inside a rendered markdown document too:
    `@markii/react` itself has no component-override seam for that (see
    docs/ARCHITECTURE.md's "Markii upstream findings" #1), so
    `src/markdown/render.tsx` rewrites every fenced-code mdast node into a
    registered `vsnote-code` directive before rendering — the same AST-
    rewrite technique the link map (item 72) uses — so a `.md`'s own code
    fences print and render highlighted everywhere the one renderer is
    used, no regression from the parser this phase replaced. A relative
    image with no resolvable source (e.g. a vault-relative image inside a
    printed page) degrades the same way: text (`Image: <alt or source>`),
    never a broken-image icon.
74. **Public reader, rewritten chrome-less (§4.3 + §5's client half).**
    `src/share/ShareApp.tsx` no longer reuses ANY of the app shell's local
    components (item 69 explicitly deferred this) — no TitleBar, no tabs, no
    tree, no Rendered/Source toggle, no role badge, no activity/status bar.
    A visitor gets the document and nothing else, dispatched by kind:
    markdown through item 70's `renderMarkdown`, code/text through item 73's
    `<CodeBlock>` (no CodeMirror instance anywhere on this route), `.html`
    through the existing sandboxed iframe unchanged, binary through the same
    "no text view" empty state as before. The editor role's write-back
    (`PUT /share/{id}`) is dropped from this route for good — the reader is
    read-only by definition, with no save button and no draft state; the
    server endpoint and role resolution are untouched, only the client's use
    of them.
75. **The reader follows system light/dark on its own.** `main.tsx` skips
    `applyDomSettings`/`useSettingsStore` on the `/share/<slug>` boot branch;
    `src/theme.css`'s `.share-reader` class maps every `--mk-*` token (plus
    the `--color-*`/`--syntax-*`/`--app-*` subset the reader/CodeBlock/
    `renderMarkdown` read) straight off `prefers-color-scheme`, independent
    of the visitor's own app theme setting and of the static
    `<html class="dark">` in `index.html`.
76. **Reading typography, not chrome density.** A centered column with a
    ~72-character measure, generous line height, and safe-area-aware
    padding — the one surface in this app where reading comfort wins over
    density. The sandboxed HTML iframe case is the one exception: it fills
    the viewport, matching the app's own local HTML Rendered mode, rather
    than being squeezed into the prose measure.
77. **"Blog" visitor experience — identical to a single-file share (item 67
    made visible).** A rendered share's `links` map is forwarded straight
    into `renderMarkdown`: a resolvable relative link becomes a real,
    clickable `/share/<alias-or-slug>` anchor; an unresolved one degrades to
    muted, non-clickable "Not shared" text (item 72). A resolved
    `back_link` (item 68) renders as exactly one plain text line above the
    document — no panel, no breadcrumb bar. Both recompute on every fetch,
    so publishing a new post or revoking one takes effect on the OTHER
    share's page immediately, no republish. Navigation is the owner's own
    markdown plus the browser's back button — there is no index/listing
    view and no folder-share revival.

## Amendments round 10 (continued) — 2026-09-06 (publish dialog rebuild + Shared view)

Item 69 said the publish dialog/Shared-view surfaces for items 66-68 were "not
built this pass" — they are now. Items 78-83 below implement them; item 78
explicitly SUPERSEDES items 55 and 56, which described the old single-form
dialog and its API-token-as-visitor-credential model.

78. **Publish dialog is a stepped form — SUPERSEDES items 55 and 56.** Five
    fixed steps, one screen at a time (a local `Stepper`, see item 80):
    `Mode` (Raw / Rendered, each with a one-line "what a visitor gets"
    description) -> `Who can open` (Anyone with the link / Only people I
    list, with the People list living on this step for restricted access)
    -> `Protection` (filtered by mode — see item 79) -> `Link` (alias,
    expiry, `Show title`, `Back link`, and Rendered mode's "Links in this
    file" — item 81) -> `Result` (the link, and for token protection the
    one-time token — item 82). Item 55's "segmented controls fill their
    container width" carries forward for the Mode step's raw/rendered
    picker; item 56's "API-token access must be self-serve" is superseded
    by item 82 below (a per-share token, not an owner account token).
79. **Protection step mirrors the server's auth matrix exactly.** Raw mode
    offers only "No credential" and "Share token"; Rendered mode additionally
    offers "Password". The dialog can never construct a combination
    `server/app/routers/shares.py::_check_auth_matches_render_mode` would
    reject — there is no password field to even type on a raw share. If a
    password is chosen on a file whose Rendered "Links in this file" list
    is non-empty, an inline warning says a password prompts once PER
    SHARE, so a linked set (a "blog") is better served by no credential or
    restricted access.
80. **`Stepper` — a new local component, not an upstream import.** `my-you-
    eye` has no Stepper/Wizard primitive (`skills/components.json`: zero
    entries for either name; already filed as sadigaxund/my-you-eye#35,
    not re-filed). `components/local/Stepper.tsx`: numbered dots + labels,
    a connecting rule, a checkmark "done" state a user can click back to.
    Deliberately thin — no branching/skip logic, since this dialog's five
    steps are a fixed linear sequence.
81. **"Links in this file" (Rendered mode, Link step) — the owner-side half
    of §5's blog feature.** Every relative markdown-file link found in the
    document being published (`share/linksInFile.ts`, built on
    `markdown/render.tsx`'s own `parseAndRewriteLinks`) shows "Shared as
    /share/x" when it resolves to one of the owner's other active shares,
    or "Not shared" with a "Share too" action otherwise. "Share too" reads
    the sibling file straight from the vault and publishes it with the
    SAME policy currently held in the form (mode, access, protection) —
    one click, no second trip through the dialog.
82. **Per-share tokens are minted and shown IN the dialog, not a separate
    flow. Labeled "Share token" throughout — never "API token"**, since
    the entire point of §4.2 was to stop the owner's account-wide API
    tokens from doubling as visitor credentials; calling a share's own
    token an "API token" would reproduce exactly the confusion the change
    removed. Choosing "Share token" protection, then publishing/saving,
    mints a token via `POST /api/shares/{id}/tokens` (§4.2/item 66) and
    shows it on the Result step with a "you will not see this again"
    warning and a ready-made, copyable `curl -H 'Authorization: Bearer
    <token>' <url>` line. Editing an EXISTING share only mints a fresh
    token when protection is newly switching INTO "Share token" — never
    re-minted on every save (that would spam mints for no reason;
    rotation stays a deliberate mint-new-then-revoke-old action from the
    Shared view).
83. **Shared view — a new activity-bar icon, opening a full-width TAB
    (course-corrected mid-pass, see the "SUPERSEDES" note below).** Share
    management (list, edit policy, regenerate, manage tokens, revoke)
    moves to its own "Shared" icon on the activity bar (`ActivityBar.tsx`).
    **SUPERSEDES this item's own first draft**, which rendered the view
    inside the shared sidebar region (`local/SidebarContainer`, same shell
    as Explorer/Search/Source Control/Extensions): screenshot review
    showed a source/link/mode/access/links-to-from/hits/last-accessed
    table was unusable there — headers overlapped and every cell
    collapsed to a bare truncation chevron, even after widening the
    region past 600px. The icon instead opens a full-width tab exactly
    the way Settings already does (`lib/sharedTab.ts`, `App.tsx`'s
    `handleOpenShared`, `EditorContent.tsx`'s `kind === "shared"` branch —
    the identical virtual-tab mechanism `kind === "settings"` established).
    `SettingsView.tsx`'s "Sharing" category keeps ONLY sharing defaults —
    backend sign-in and the admin-only share blob size limit. The view's
    table (`components/SharedView.tsx`) uses `my-you-eye` `DataTable`'s
    `renderActions`/`onRowClick` (my-you-eye 2026.8.3, upstream #25) with
    FIXED column widths (an `"auto"`-layout attempt hid columns behind an
    invisible horizontal scroll instead, worse at every width tried) — a
    truncated link column with its own copy action, relative dates, a
    "Links to / from" count per share (§5's audit requirement, computed
    client-side from the vault's own files), and a trailing actions cell
    (quick copy-link button + an overflow `DropdownMenu`: copy link, edit
    policy, regenerate, manage tokens, revoke). Per item 51, a refresh
    keeps the table mounted and dims it rather than unmounting to a
    skeleton or empty state.

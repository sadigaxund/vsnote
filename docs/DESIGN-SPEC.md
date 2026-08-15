# Design spec — "Slate"

Source of truth: `app-preview.png` (repo root). This doc translates that image into
buildable detail. When in doubt, open the image and match it.

## Overall look

- Dark, near-black theme. Three surface depths: window chrome / activity bar (darkest),
  sidebar (dark), editor (slightly lighter, ~#0d1117 family).
- Accent: teal/cyan (used for: active tab underline, selected mode toggle, headings in
  rendered markdown, links, folder icons, branch icon).
- Git colors: modified = yellow/amber `M`, added = green `A`, deleted = red `D`
  (name struck through), untracked = purple/violet `U`.
- UI chrome and code use a monospaced font (JetBrains Mono feel); rendered markdown
  body uses a clean sans/serif-ish reading font.
- Density: compact, VSCode-like. Rounded corners are subtle.

## Layout regions (top → bottom)

### 1. Title bar
- macOS traffic lights (decorative), app glyph + `Slate` — `vault` (workspace name).
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
  GraphView.tsx [A], theme.css, legacy-parser.ts [D]}`, `vault/assets/` (collapsed;
  contains `cover.png`), `vault/metrics.csv [M]`, `vault/vault.config.json`.

### 4. Editor group
- **Tab bar**: one tab per open file — file-type icon, name, close ×. Dirty (unsaved)
  = dot instead of / beside ×. Git-modified tabs tint the filename (yellow-ish).
  Preview tab (single-click open) = italic name (see `cover.png` in the image).
  Active tab: lighter background + teal top/underline edge. Overflow `…` menu at right.
- **Editor header row**: left, Breadcrumbs `vault / notes / architecture.md`.
  Right: diff stat chip `+12 -5` (green/red), then a segmented mode toggle:
  `◉ Rendered` | `</> Source` | `⇄ Diff` — active segment filled teal.
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
- H1 large white bold; H2 teal; body light-gray, relaxed line height; inline code in
  amber/yellow mono chips; bold bright-white; blockquote with left accent border,
  italic; code blocks on slightly raised dark surface, mono, amber-tinted tokens.

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

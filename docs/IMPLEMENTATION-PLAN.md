# Implementation plan

Phases are sequential; each ends with quality gates green (build, lint, tsc), a visual
check against `app-preview.png` for UI phases, and a commit. A phase's agent must read
`CLAUDE.md`, `docs/DESIGN-SPEC.md`, `docs/ARCHITECTURE.md`, and the `skills/` manifest
before writing code.

## Phase 1 — Scaffold + static shell
- Vite React-TS scaffold in repo root; Tailwind v4; `my-you-eye` installed;
  `npx my-you-eye init` to populate `skills/`; ESLint; strict tsconfig.
- `src/theme.css`: token overrides for the screenshot palette (dark default at boot).
- Full static shell with hardcoded demo data matching the image: TitleBar, ActivityBar,
  Explorer sidebar (TreeView + filter + header actions), TabBar, EditorHeader
  (Breadcrumbs + DiffStatChip + SegmentedControl), content placeholder, StatusBar.
- Local primitives built as needed → update `docs/COMPONENT-BACKLOG.md` statuses.
- Exit: side-by-side with `app-preview.png`, layout/colors/density visibly match.

## Phase 2 — Virtual FS + real git
- `fs/` service on lightning-fs; idempotent seeder creating the demo vault AND git
  history (commits on `feat/incremental-index`) reproducing every screenshot state:
  M/A/D/U letters, +12 −5 on architecture.md, 6-change badge, 1 untracked, ahead 3 /
  behind 1 (simulated remote), "synced 2m ago".
- `git/` service: status matrix → letters; diff vs HEAD (hunks + line numbers + totals);
  commit; simulated push/pull/fetch.
- Stores wired: tree, tabs (open/close/preview/pin/reorder), git badge, status bar all
  live. File ops with ContextMenu + inline rename + ConfirmDialog. Filter works.
- Tree drag & drop moves (DESIGN-SPEC Amendments item 7): drop-into-folder +
  between-rows insertion indicator + auto-expand + Esc cancel.
- Persistence per Amendments item 6: settings, tab state, and unsaved buffers
  (debounced IndexedDB checkpoints) restore across reloads.
- Exit: create/edit(temp via a crude textarea is fine this phase)/rename/delete a file
  and every indicator updates correctly; reload persists.

## Phase 3 — CodeMirror source + diff
- CM6 base setup themed to design tokens; language per filetype registry (ts/tsx, js,
  json, css, html, md, csv-as-text); line numbers, active line, bracket match, search
  panel, word wrap setting.
- Git gutter extension driven by `git/diff.ts` (added/modified/deleted markers,
  VSCode-style); dirty-tab + ⌘S save flow; Ln/Col/encoding/lang in StatusBar.
- Diff mode via `@codemirror/merge` vs HEAD (unified + side-by-side toggle).
- Source Control sidebar panel: change list, click→diff, commit box (real commit →
  all indicators refresh), push/pull buttons.
- Exit: edit indexer.ts → gutters correct vs HEAD; diff mode matches; commit clears
  states; +12 −5 chip agrees with diff mode line counts.

## Phase 4 — Rendered modes + Obsidian live preview
- `filetypes/` renderer wiring + SegmentedControl logic (per-type availability,
  defaults; images = viewer only).
- **Markdown live preview** (the centerpiece — see DESIGN-SPEC "Modes"): CM6
  decoration plugin, syntax hidden except at cursor's smallest enclosing region;
  styled headings/bold/italic/links/lists/quotes/inline code; fenced code blocks
  syntax-highlighted in place; clickable internal links opening tabs; checkbox toggle
  widgets. Adapt OSS patterns (ixora, codemirror-rich-markdoc) — attribute licenses.
- Read-only lock = same view, editing off (⌘E toggles with Source).
- HtmlPreview (sandboxed iframe), CsvTable (DataTable + header row), JsonView,
  ImageView (checkerboard, zoom fit).
- Exit: architecture.md in Rendered mode reproduces the screenshot typography; cursor
  in the bold word reveals only `**append-only**`; blur re-renders it.

## Phase 5 — Palette, search, settings, sync polish
- CommandPalette (⌘K/⌘P): grouped file jump + commands (mode toggle, sync, new file,
  reset demo vault, theme…). Search activity view: full-text across vault with result
  list → opens at line.
- Settings dialog (persisted): theme + accent, font size, tab size, word wrap,
  default modes. Toasts for sync/delete/errors; Tooltips on all icon buttons;
  EmptyState; full keyboard map from DESIGN-SPEC.
- Simulated sync lifecycle: ahead/behind drift, syncing spinner in status bar,
  "synced Xm ago" relative timestamp ticking.
- Exit: keyboard-only session possible; final pixel pass vs `app-preview.png`.

## Phase 6 — Grid split view
- Implement DESIGN-SPEC Amendments item 8: recursive pane grid, drag-tab-to-edge
  docking with live drop-zone preview, per-pane tab strips + mode, draggable
  dividers (double-click to equalize), pane collapse on last-tab close, layout
  persisted with the rest of tab state.
- Mouse-first: every operation reachable by drag/click; shortcuts are accelerators.
- Exit: split same file source|rendered side-by-side; arrange 2×2 grid of four
  files; resize + equalize dividers; reload restores the exact layout.

## Verification protocol (orchestrator)
After each phase: run gates, review the diff against this plan and the spec, exercise
the app (dev server + browser/screenshot when available), file concrete fix tasks back
to a worker if anything fails, and only then commit/report.

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
| Icons | lucide-react | file-type icons mapped locally |
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
phases 1–5.

Note: `docs/DESIGN-SPEC.md` has a 2026-08-15 "Amendments" section (Material Icon
Theme icons, no traffic lights, slimmer chrome, zen mode, browser-shortcut capture,
persistence of tabs/settings/unsaved buffers) that overrides the base spec.

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

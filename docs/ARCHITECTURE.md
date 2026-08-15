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

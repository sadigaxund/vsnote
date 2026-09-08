# Component Backlog

**Scope (refocused 2026-08-21, consolidated 2026-09-08):** this file tracks ONLY
component-library gaps and component import/abstain decisions — per CLAUDE.md rule 2
it is where a library gap gets logged, not a general notes file for app work.
App-level queued/deferred work (the former `docs/TODO.md`, retired 2026-09-08 —
its still-open items are now issues on `sadigaxund/vsnote`) and per-source skill
reports (`skills/ANALYSIS.md`) live elsewhere. Part 2 is now
the single registry of every local component and gap ever tracked here (the former
`docs/COMPONENT-BACKLOG-Issued_20260821.md` has been merged in and deleted).

Protocol: `planned` → `built-locally` → `upstreamed` → `shipped` → `consumed`. Every
local component under `src/components/local/` gets a row here in the same commit it
lands in.

---

## Part 1 — Import decisions (from elsewhere)

### 1.1 `dnd-kit` — conditional future import for drag-and-drop

- **Status:** planned (conditional trigger, not now)
- **Source:** negative finding — none of the seven skill sources covers DnD mechanics
  at all (`skills/ANALYSIS.md` cross-cutting finding #1). This entry exists so the
  decision isn't re-litigated from scratch each time DnD friction appears.
- **Current state:** ExplorerTree move + EditorTabBar drag-to-dock use native HTML5
  DnD (`draggable`, `application/x-vsnote-tab` payload). Works, but has known ceilings:
  no touch/pen support without extra work, drop-target hit-testing is manual
  (drop-onto-folder vs insertion-line logic in `ExplorerTree.tsx`), no keyboard-driven
  drag equivalent, and Esc-cancel already required a ref-flag hack because the native
  gesture can't be aborted mid-flight.
- **Trigger criteria for importing dnd-kit:** (a) tab dock needs cross-pane reorder
  previews, (b) tree DnD needs multi-select drag, or (c) touch/PWA pen input becomes a
  supported surface. Any one of these justifies the dependency.
- **Constraints if imported:** must be styled to produce the exact same visual
  affordances we have today (2px teal insertion line, red invalid ring, folder
  highlight); keyboard alternative still required regardless (see
  sadigaxund/vsnote#4) because
  WIG's rule ("drag gestures need tap/click and keyboard alternatives unless essential")
  applies to both native and library DnD.

### 1.2 Virtualization: stay local; TanStack Virtual recorded as escape hatch

- **Status:** decision recorded — not importing
- **Source:** kursku `optimize` recommends react-window/react-virtualized (stale advice;
  current default is TanStack Virtual); vercel-labs `react-best-practices` endorses
  virtualization generally.
- **Decision:** our `VirtualList.tsx` + pure `lib/virtualization.ts` windowing stays.
  It composes the library's own `ScrollArea` (CLAUDE.md rule 1), is unit-tested without
  a DOM, and its fixed-row-height model matches the tree's row metrics exactly. A
  general-purpose virtualizer buys variable-height support we don't need yet and costs
  integration risk against `ExplorerTree`'s dual code path (recursive <200 rows,
  flat ≥200).
- **Escape hatch:** if variable-height rows ever arrive (wrapped markdown lines in
  outline view, multi-line git-commit rows), evaluate TanStack Virtual first, then
  extending our spacer/window math second. Do NOT reach for react-window/react-virtualized
  — unmaintained lineage.

### 1.3 Non-import ledger (decisions with reasons — do not revisit without new evidence)

| Rejected import | Why rejected | Would-be source |
|---|---|---|
| Million.js runtime | `block()` wraps components with its own memoization/renderer — fights custom VirtualList windowing, fights CM6 widget-managed DOM, violates the no-wrap-override law | millionco/react-doctor's parent project |
| shadcn/ui components (any) | Copy-the-source ownership model is the inverse of our npm-library-first law; React 19/RSC assumptions; their token names would fragment our theme | shadcn official skill |
| TanStack Table | Headless table machinery is overkill for SharedPanel/VaultSetupPanel tables; the gap is only the *row-actions interaction pattern*, which we compose from my-you-eye `Table` + `DropdownMenu` | shadcn data-table pattern |
| TanStack Query / SWR / Redux Toolkit / Jotai | zustand-only law; server-state lives in services + `useGitStore`; wshobson's skill routes "large app" to RTK — explicitly overridden here | wshobson react-state-management |
| Base UI, motion/react | baseline-ui mandates them for new primitives/animations — different stack than my-you-eye + Radix; DESIGN-SPEC motion rules already govern animation | kursku baseline-ui |
| react-window / react-virtualized | Unmaintained lineage; superseded by TanStack Virtual (itself not needed, see 1.2) | kursku optimize |
| sickn33 tailwind-design-system patterns | Tailwind v3 idioms (config-file, HSL triplets) would break our v4 CSS-first setup; Patterns 1–3 hand-roll primitives | index line 5 |

---

## Part 2 — component registry (local components and library gaps)

One row per local component or upstream gap. State: `open` (issue open, not yet
addressed upstream), `shipped` (upstream fix released, not yet adopted here),
`consumed` (upstream fix released and in use here, local workaround if any removed),
`retired` (local component deleted, feature removed), or `n/a` (not an upstream
candidate). All issues are on `sadigaxund/my-you-eye` unless noted.

| Component / gap | Where used | Upstream issue | State |
|---|---|---|---|
| `ContextMenu` | `ExplorerTree.tsx`, `EditorTabBar.tsx` | [#3](https://github.com/sadigaxund/my-you-eye/issues/3) | consumed (local component stays; issue tracks the upstream ask) |
| `FindWidget` | `editor/findPanel.ts`, `editor/LivePreviewEditor.tsx` | [#4](https://github.com/sadigaxund/my-you-eye/issues/4) | consumed |
| `EditorTabBar` / `Tab` | `TabBar.tsx`, `EditorPane.tsx`, `share/ShareApp.tsx` | [#5](https://github.com/sadigaxund/my-you-eye/issues/5) | consumed |
| `ActivityBar` / `IconRail` | `ActivityBar.tsx` | [#6](https://github.com/sadigaxund/my-you-eye/issues/6) | consumed |
| `StatusBar` | `StatusBar.tsx` | [#7](https://github.com/sadigaxund/my-you-eye/issues/7) | consumed |
| `SplitPane` / `PaneGroup` (+ `ResizeHandle` keyboard a11y) | `EditorArea.tsx`, `SidebarContainer.tsx` | [#8](https://github.com/sadigaxund/my-you-eye/issues/8) | consumed — keyboard nav (arrows/Home/End/Enter) shipped 2026-08-21 per addendum |
| `SegmentedControl` | `TitleBar.tsx`, `EditorHeader.tsx` | [#9](https://github.com/sadigaxund/my-you-eye/issues/9) | consumed |
| `FileIcon` | `ExplorerTree.tsx`, `EditorTabBar.tsx` | [#10](https://github.com/sadigaxund/my-you-eye/issues/10) | consumed |
| `TreeView` inline rename / adornments / drag-drop (`ExplorerTree.tsx`) | `Sidebar.tsx` | [#11](https://github.com/sadigaxund/my-you-eye/issues/11) | consumed |
| `TitleBar` | `TitleBar.tsx` | [#12](https://github.com/sadigaxund/my-you-eye/issues/12) | consumed |
| `SidebarContainer` | `Sidebar.tsx`, `SearchPanel.tsx`, `SourceControlPanel.tsx`, `ExtensionsPanel.tsx` | [#13](https://github.com/sadigaxund/my-you-eye/issues/13) | consumed |
| `DiffStatChip` | `EditorHeader.tsx`, `StatusBar.tsx` | [#14](https://github.com/sadigaxund/my-you-eye/issues/14) | consumed |
| `ConflictResolver` | `App.tsx` | [#15](https://github.com/sadigaxund/my-you-eye/issues/15) | consumed |
| `VirtualList` | `ExplorerTree.tsx` | [#16](https://github.com/sadigaxund/my-you-eye/issues/16) | consumed |
| `Button size="xs"` icon density (was: hand-rolled `Toolbar` workaround) | `Sidebar.tsx` header micro-toolbar | [#17](https://github.com/sadigaxund/my-you-eye/issues/17) | shipped — not yet adopted at the original call site |
| `Input` leading/trailing slot (was: `Kbd` absolutely positioned over `Input`) | none currently (original call site since replaced) | [#18](https://github.com/sadigaxund/my-you-eye/issues/18) | shipped — no current consumer |
| `CheckboxTree` | was `PublishDialog.tsx` folder-publish mode | [#19](https://github.com/sadigaxund/my-you-eye/issues/19) | retired 2026-09-05 — folder shares removed entirely, component and `share/folderManifest.ts` deleted |
| `ColorField` (was: native `<input type="color">`) | `SettingsView.tsx` accent-color row | [#20](https://github.com/sadigaxund/my-you-eye/issues/20) | consumed |
| `DropdownSubmenu` | `local/OverflowMenu.tsx` | [#21](https://github.com/sadigaxund/my-you-eye/issues/21) | consumed |
| `OverflowMenu` | `EditorPane.tsx` (via `EditorTabBar`'s `documentActions`) | [#22](https://github.com/sadigaxund/my-you-eye/issues/22) | consumed |
| `DataTable` row-actions column | `SharedView.tsx` | [#25](https://github.com/sadigaxund/my-you-eye/issues/25) | consumed — `onRowClick`/`renderActions`/`actionsHeader`/`actionsWidth` shipped 2026.8.3, wired into `SharedView.tsx` |
| Sidebar token namespace (`--sidebar-*`) | `SidebarContainer.tsx`, `ExplorerTree.tsx`, `SearchPanel.tsx`, `SourceControlPanel.tsx` | [#27](https://github.com/sadigaxund/my-you-eye/issues/27) | consumed — app-side family shipped 2026-08-21 (DESIGN-SPEC item 43); library-side docs still open upstream |
| Command palette empty/no-results state | `CommandPaletteHost` | [#28](https://github.com/sadigaxund/my-you-eye/issues/28) | closed as moot — `emptyText` prop already covered it |
| Command palette filtered-result-count announcement | `CommandPaletteHost` | [#32](https://github.com/sadigaxund/my-you-eye/issues/32) | consumed — internal `aria-live` region shipped |
| `Logo` | `TitleBar.tsx`, `share/ShareApp.tsx`, `LoginGate.tsx` | none | n/a — VSNote's own brand mark, not a library gap |
| `CodeBlock` external/pluggable highlighter | `src/markdown/codeBlock.tsx` | [#36](https://github.com/sadigaxund/my-you-eye/issues/36) | open |
| `Stepper` segmented-progress variant | `local/Stepper.tsx` (Publish dialog, Git & Sync) | [#35](https://github.com/sadigaxund/my-you-eye/issues/35) | open — comment posted describing this variant, local component in use meanwhile |
| `Switch` unchecked-state dark-theme contrast | n/a (library defect, unpatched) | [#37](https://github.com/sadigaxund/my-you-eye/issues/37) | open |
| Default theme `.dark` missing `--shadow-*` override | n/a (library defect) | [#38](https://github.com/sadigaxund/my-you-eye/issues/38) | open |
| No nested/subtle border tier (`--color-border` only) | n/a (library defect) | [#39](https://github.com/sadigaxund/my-you-eye/issues/39) | open |
| `Toast` variant restyle (solid-fill success/danger, no lever) | `local/Toast.tsx` + `useToast.ts` | [#40](https://github.com/sadigaxund/my-you-eye/issues/40) | open — local component in use meanwhile |
| `SettingsRow` / `SettingsSection` | every `settings/<Category>.tsx` module | [#34](https://github.com/sadigaxund/my-you-eye/issues/34) | open — local component in use meanwhile |
| `SettingsNavRail` (vertical NavList/SideNav/TOC) | `SettingsView.tsx` | [#41](https://github.com/sadigaxund/my-you-eye/issues/41) | open — local component in use meanwhile |
| `SegmentedControl` sr-only radio has no local `position: relative`, so its containing block falls through to whatever positioned ancestor the HOST APP happens to render above it (R5-1: resolved to `EditorPane`'s wrapper, three levels above Settings' own scrollable content) — clicking any option then triggers the browser's native focus-scroll against the WRONG ancestor and can blank the entire app. Worked around with an additive `[role="radiogroup"]{position:relative}` rule in `index.css` (no fork of the component) until fixed upstream. | every `SegmentedControl` call site (visible specifically in `settings/Sharing.tsx`'s Reader appearance group, the deepest one in Settings' continuous scroll) | [#43](https://github.com/sadigaxund/my-you-eye/issues/43) | open — CSS workaround in use meanwhile |
| `SettingsSectionErrorBoundary` (class-component error boundary around one Settings category's rows) | `SettingsView.tsx` (wraps each category section) | none | n/a — error boundaries (`getDerivedStateFromError`/`componentDidCatch`) are a React class-component capability, not a component a UI library ships; same rationale as the untracked `local/PaneErrorBoundary.tsx` precedent it's modeled on |
| Library-side a11y hardening pass (overlay/navigation primitives) | n/a | [#29](https://github.com/sadigaxund/my-you-eye/issues/29) | closed |
| SKILL.md architecture upgrade | n/a | [#30](https://github.com/sadigaxund/my-you-eye/issues/30) | closed |
| Tree-shaking guarantees (sideEffects flag, subpath exports) | n/a | [#31](https://github.com/sadigaxund/my-you-eye/issues/31) | closed |

### Solved by composition (no local primitive, no upstream candidacy)

- `ExtensionsPanel.tsx` — library's own `EmptyState` inside `SidebarContainer`.
- `PublishDialog.tsx` / `SharedView.tsx` — `Dialog`/`FormField`/`Select`/`Switch`/
  `Input`/`Button`/`Badge`/`Alert`/`useToast`/`Table` family, plus the already-listed
  `SegmentedControl` and `Stepper`.
- `VaultSetupPanel.tsx` — `Alert`/`Badge`/`Button`/`ConfirmDialog`/`DataList`/`Dialog`/
  `FormField`/`Input`/`Select`/`Skeleton`/`Switch`/`Table`/`Textarea`/`Tooltip`/`useToast`.
- `ImportConflictDialog.tsx` — `Dialog` primitives directly (`ConfirmDialog` is
  confirm/cancel only, this needs a three-way choice).
- `TexturedSurface` (library component) — composed as a `z-index: -1` layer behind
  `TitleBar`/`ActivityBar`/`StatusBar`/`SidebarContainer`/`EditorPane`; see
  `docs/ARCHITECTURE.md`'s Deviations entry for why translucent tokens alone
  measured zero visible texture.

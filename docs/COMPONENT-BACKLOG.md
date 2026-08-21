# Component Backlog

Derived from the deep analysis of every entry in `skills/index.md` (full per-source
reports: `skills/ANALYSIS.md`). This file is the **canonical** backlog per CLAUDE.md
rule 2; `docs/COMPONENT-BACKLOG-Issued_20260821.md` remains the inventory of
gap-fillers already built in `src/components/local/` — this file adds what that one
deliberately does not track: (1) components/patterns we decided to import from
elsewhere, (2) my-you-eye gaps with enough spec detail to drive an upstream PR or a
local build, (3) improvements to existing components surfaced by the skill analysis,
and (4) a backfill annex (Part 5) restoring detail the first synthesis pass
compressed out of the source reports.

Protocol: same lifecycle as the issued backlog — `planned` → `built-locally` /
`imported` → `upstreamed`. Every entry names its source skill(s) so the reasoning is
traceable.

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
  highlight); keyboard alternative still required regardless (see Part 3.5) because
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

## Part 2 — my-you-eye gaps (upstream candidates)

Each entry: the gap, what's lacking in the closest existing library component, the
spec we'd implement locally or upstream, and the design reference mined from the
skill analysis.

**Upstream tracker map** (sadigaxund/my-you-eye — kept in sync with this file; when
a backlog entry changes materially, update its issue in the same pass):

| Entry | Issue(s) | Issue state |
|---|---|---|
| §2.1 DataTable row-actions | #25 | open, addendum posted |
| §2.2 ResizeHandle keyboard a11y | #8 (+ cross-ref on #13) | open, addendum posted |
| §2.3 ColorField OKLCH spec | #20 | open, addendum posted |
| §2.4 Sidebar token namespace | #27 | open |
| §2.5 Palette empty states | #32 (live region only) · #28 | open · closed-as-moot |
| §3.4 library-side a11y audit | #29 | open |
| §3.8 SKILL.md architecture upgrade | #30 | open |
| §3.2 barrel/tree-shaking findings | #31 | open, evidence posted |

### 2.1 DataTable row-actions column

- **Gap:** `DataTable` has no row-click/actions slot at all (recorded in the issued
  backlog's PublishDialog/SharedPanel notes). SharedPanel needs per-row manage/revoke.
- **What's lacking:** `Table`'s own manifest says to reach for it directly for bespoke
  markup, but nothing standardizes the trailing actions column — every consumer will
  hand-roll alignment, stop-propagation on the actions cell, and menu wiring.
- **Spec (compose, don't import):** last column renders an icon-only ghost `Button`
  opening a `DropdownMenu` (or local `OverflowMenuItems` when actions are document-shaped);
  cell gets `onClick={e => e.stopPropagation()}`; row click opens the Drawer/detail view.
  Keyboard: actions trigger must be reachable in tab order after the row's primary
  action, labeled via `aria-label` naming the row ("Actions for <name>").
- **Design reference:** shadcn's data-table pattern (trailing actions column with
  DropdownMenu trigger) — mine the interaction shape only.
- **Status:** planned (first needed by SharedPanel row management).

### 2.2 ResizeHandle keyboard accessibility (PaneGroup / SidebarContainer)

- **Gap:** our `ResizeHandle` primitive (used by `PaneDivider` for the N-way pane grid
  and by `SidebarContainer` for sidebar width) is pointer-only: wide invisible hit-area,
  hover tint, double-click equalize/reset. No keyboard operation at all.
- **What's lacking:** nothing in the catalog owns resizable panels (issued backlog row),
  and our local fill inherited pointer-only mechanics.
- **Spec:** handle becomes a focused element (`role="separator"`,
  `aria-orientation` perpendicular to the split, `aria-valuenow/min/max` = size %),
  Arrow keys nudge by step (2% or 16px-equivalent), Shift+Arrow large step,
  Home/End clamp to min/max, Enter/Space = equalize (panes) / reset width (sidebar).
  Focus ring uses the accent token like other chrome.
- **Design reference:** shadcn `Resizable` (thin wrapper over react-resizable-panels)
  ships this exact a11y contract; WIG's "gestures need keyboard alternatives".
- **Status:** planned — required before the a11y-hardening pass (Part 3.4) can close.

### 2.3 ColorPicker / ColorField — spec frozen, implementation deferred

- **Gap:** catalog has no `Color*` component (confirmed against full manifest). Settings
  currently uses native `<input type="color">` (issued backlog row: deliberately not
  built locally).
- **Spec when upgraded:** follow shadcn `customization.md`'s OKLCH doctrine — the picker
  writes `--color-accent` / `--color-accent-foreground` OKLCH pairs registered via
  `@theme inline` in the single global CSS file; presets are named OKLCH values, never
  raw hex scattered in components; contrast check between the pair before commit
  (accent-on-accent-foreground must clear WCAG for text usage). Swatch grid +
  recent-colors row are the minimum viable UI; native input stays the fallback.
- **Why deferred:** native control fully satisfies "pick an accent color"; the OKLCH
  token work is the valuable part and can land independently of fancier picker UI.
- **Status:** planned.

### 2.4 Sidebar token namespace

- **Gap:** explorer/sidebar chrome currently rides generic surface tokens. DESIGN-SPEC
  wants near-black surfaces with teal/cyan accents; sidebar hierarchy (active row,
  hover, badge counts, share-chain glyphs) is controllable but fragile against generic
  `surface`/`muted` tokens.
- **Spec:** introduce a dedicated `--sidebar-*` family (bg, border, item-hover,
  item-active, badge-bg/fg) derived from the same OKLCH base hues, scoped so
  `SidebarContainer` and its four activity views consume only these tokens. Mirrors
  shadcn's precedent of separating sidebar chrome from page surfaces; keeps
  "switching `data-theme` + `.dark` restyles everything" true (SKILL.md rule 12).
- **Status:** planned — pair with the next DESIGN-SPEC amendment round.

### 2.5 Command palette empty-state integration

- **Gap:** `CommandPaletteHost` works but has no standardized empty/no-results state;
  shadcn's doctrine ("Empty states use Empty") plus SKILL.md design rule 4 ("the three
  states ship with v1") suggest composing the library's `EmptyState` inside the palette
  dialog for zero-result queries and pre-index states.
- **Status:** resolved 2026-08-21 by inspection — (1) no-results already covered:
  the library `CommandPalette` has an `emptyText` prop and `CommandPaletteHost`
  passes mode-appropriate copy ("No matching files" / "No matching files or
  commands"); (2) indexing state is N/A — file lists come synchronously from
  `useFsStore`, there is no corpus build to show progress for; (3) empty-query shows
  all actions (standard jump-palette behavior, correct). The one genuine gap — a
  polite (`aria-live`) announcement of filtered-result counts — is **not composable
  from outside** the library component (query state is internal, no
  `onQueryChange`), so it was filed upstream as sadigaxund/my-you-eye#32 and is
  closed here pending that. (The earlier upstream issue #28 proposing this whole
  feature was closed as moot once the audit showed three of its four checklist
  items already satisfied or N/A.)

### 2.6 Carried-over planned rows (unchanged, tracked in issued backlog)

`Toolbar` xs icon-button density; `Input` trailing kbd-hint slot. Both remain valid
upstream candidates; no new information from the skill analysis changes their specs.

---

## Part 3 — Improvements to existing components/code

Concrete work items, each traceable to a skill source. Ordered roughly by leverage.

### 3.1 Zustand selector granularity audit (+ v5 equality footgun)

- **Source:** vercel-labs `rerender-derived-state`, `rerender-defer-reads`,
  `rerender-memo-with-default-value`; wshobson Pattern 2 selector hooks.
- **Problem:** hot-path components subscribe too broadly. Row-level components in
  `ExplorerTree`/`VirtualList` should subscribe to booleans (`isExpanded(id)`,
  `isSelected(id)`), never whole-node objects; `EditorTabBar` handlers should read via
  `useStore.getState()` inside callbacks instead of subscribing every tab to the array.
- **Footgun to encode in review checklist:** zustand v5 defaults to `Object.is`
  equality — a selector returning a fresh object/array each call loops forever. Our
  row selectors will hit this first; either select primitives or pass a shallow
  equality fn.
- **Derived-data corollary (wshobson Don't):** flatten PaneNode→visible-rows inside a
  memoized selector (`lib/treeFlatten.ts` already lives outside the store — keep it
  that way); never cache derived rows in store state.
- **Acceptance:** React Profiler shows a single-row expand re-rendering only that row's
  component at 200+ rows; no selector returns fresh references without custom equality.

### 3.2 Barrel-import audit of my-you-eye

- **Source:** vercel-labs `bundle-barrel-imports`, `bundle-analyzable-paths`.
- **Problem:** 114 components behind `my-you-eye`'s main entry is exactly the barrel
  shape the rule warns about; if app imports go through the barrel, tree-shaking
  depends on the package's side-effect flags holding.
- **Action:** audit current imports; prefer per-component subpaths where the package
  exposes them (motion/scenes entries already are); verify with a build stats diff
  (`npm run build` + analyzer) that unused groups (charts, canvas, scenes, video) don't
  leak into the SPA chunk. The `/share/` vault-isolated chunk matters most.
- **Acceptance:** charts/canvas/scenes symbols absent from the main bundle's symbol dump.
- **Findings (2026-08-21 audit):**
  - All 42 library imports use the main barrel; there are no alternative static-UI
    subpaths to switch to (exports map: only `/motion`, `/scenes`, `/present`,
    `/present/player`, `/video`, CSS entries).
  - One shared chunk (`api-*.js`, ~378 KB minified — downloaded by the main app AND
    the `/share/` reader) contains `GraphNode`, `ConnectionLine`, `SequenceDiagram`
    with **zero call sites**: a contiguous ~107 KiB (29%) dead region. Root cause is
    NOT module-level inclusion (a scoped `treeshake.moduleSideEffects` hint was built
    and measured: zero effect) but statement-level: `X.displayName="…"` assignments
    inside the same dist modules as live exports can't be proven pure, so Rollup keeps
    the functions. Fix requires upstream changes — per-module ESM publishing or
    `/*#__PURE__*/` annotations on displayName assignments — documented with full
    evidence on sadigaxund/my-you-eye#31.
  - `Sparkline` in the same chunk is NOT dead: reachable via
    `DataList`/`DataTable` → `CellType`'s `"sparkline"` case. Correct behavior.
  - `package.json#sideEffects` is absent from the published manifest (secondary —
    see root cause above).
- **Verdict:** not fixable app-side without vendoring/forking (forbidden). Re-audit
  after my-you-eye#31 ships; acceptance criterion unchanged.

### 3.3 Dirty-buffer `beforeunload` guard

- **Source:** WIG "warn before navigation with unsaved changes".
- **Problem:** arguably mandatory for a code editor; unverified whether implemented.
- **Action:** when any pane's tab is dirty, register `beforeunload` with
  `event.preventDefault()` (and legacy `returnValue`) — remove when clean. Must not
  fire for the `/share/` reader (read-only). PWA note: also covers reload-during-sync.
- **Status:** done 2026-08-21 (commit `352f5c8`). `lib/dirtyGuard.ts` (pure,
  unit-tested per the fs-isolation invariant) + `lib/useDirtyBeforeunloadGuard.ts`
  (transient store subscription — flips the listener on the clean↔dirty edge only,
  zero re-renders per keystroke), mounted once from `App.tsx`; structurally absent
  from the share route because `main.tsx` reaches App only on the non-share branch.

### 3.4 Accessibility hardening pass (compiled acceptance criteria)

Sources: kursku `fixing-accessibility` (primary structure), WIG, addyosmani WCAG 2.2
patterns, shadcn forms/composition rules. Apply per surface:

**Progress (2026-08-21, Phase B):**
- **Menus — audited, no gaps to fix.** ContextMenu/DropdownSubmenu wrap the Radix
  primitives that supply the full contract natively (arrow traversal, Escape,
  focus restore, `aria-haspopup`/`aria-expanded`/`aria-controls` on
  triggers/subtriggers); every trigger site is already keyboard-reachable because the
  focusable element IS the trigger (tree rows, tabs), so the browser's Menu key /
  Shift+F10 fires a real contextmenu event on them. Icon-only items carry labels.
- **ExplorerTree — done:** ARIA-tree arrow navigation added (Arrow/Right/Left expand-
  or-enter / collapse-or-parent semantics over the flattened visible list,
  selection-follows-focus, Home/End; virtualized off-window jumps move selection but
  not DOM focus — noted limitation), rename input gets an accessible name, and a
  shared polite live region announces "Renamed to …"/"Rename cancelled". Typeahead
  deliberately not implemented: ⌘P file-jump covers it with better UX at vault scale.
- **EditorTabBar — done:** proper roving tabindex (one tab stop; arrows/Home/End move
  focus without activating; Enter/Space activate via the existing click path) and
  accessible names now include dirty state ("notes.md, modified").
- **Still open:** dialogs pass, StatusBar live regions, global focus-visible/
  reduced-motion/color-scheme sweep (B4–B6 below).

- **Menus (ContextMenu, DropdownSubmenu, OverflowMenu):** full arrow/Home/End/Escape
  traversal; triggers expose `aria-haspopup` + `aria-expanded`; submenu triggers get
  `aria-controls`; icon-only items carry `aria-label`.
- **ExplorerTree:** ARIA tree pattern — `role="tree"/"treeitem"/"group"`,
  `aria-expanded`, `aria-level`, `aria-selected`; typeahead; rename-in-place announces
  via `aria-live="polite"`; DnD affordances mirrored by a keyboard path (3.5).
- **Tabs (EditorTabBar):** `role="tablist/tab"` with arrow-key movement, dirty state
  announced in accessible name ("notes.md, modified"), close buttons labeled.
- **Dialogs (PublishDialog, ImportConflictDialog, VaultSetupPanel dialogs,
  ConflictResolver):** focus trap + restore-to-trigger + initial focus inside;
  `DialogTitle` always present (sr-only fallback); field errors wired
  `aria-describedby` + `aria-invalid` (+ `data-invalid` styling hook); disabled submit
  explains why; `overscroll-behavior: contain` so background doesn't scroll.
- **StatusBar async updates:** `aria-live="polite"` region for save/git/sync status
  flips; conflict toast stays assertive only for genuine blockers.
- **Global:** focus-visible rings ≥3:1 against adjacent colors (addyosmani); decorative
  icons `aria-hidden`; no positive tabindex anywhere; every transition honors
  `prefers-reduced-motion` (matches DESIGN-SPEC motion rules and mblode/ui-animation
  guidance); `color-scheme: dark` verified so native inputs/scrollbars render dark;
  hover affordances have focus-visible equivalents so keyboard users see the same
  state changes mouse users do (WIG hover-states group).
- **Tool boundaries (from fixing-accessibility, adopted as-is):** minimal diffs, no
  unrelated refactors, never add ARIA where native semantics suffice, never migrate
  libraries during a11y fixes.

### 3.5 Keyboard alternatives for drag operations

- **Source:** WIG gesture duality rule; fixing-accessibility keyboard category.
- **Scope:** tree move (a "Move to…" command-palette entry operating on the selected
  node), tab dock (keyboard pane-focus cycling + "Move tab to pane" command), OS
  import already has Ctrl+V paste parity (keep it). During any active drag: disable
  text selection and set `inert` on dragged elements (WIG).

### 3.6 Performance micro-items (50k-note push)

- **Source:** vercel-labs `js-*`/`client-*` slices; kursku `optimize`; react-doctor
  categories.
- Items:
  - Passive listeners on the VirtualList scroll region (`client-passive-event-listeners`).
  - Path→node lookups via `Map` (not array scans) in `fileTree.ts`;
    git-status membership via `Set` (`js-index-maps`, `js-set-map-lookups`).
  - Batch reads/writes in `ResizeHandle` drag loop — measure once per frame, write
    transforms/styles once (`js-batch-dom-css`; kursku anti-thrashing snippet).
  - Defer search-corpus/index building with `requestIdleCallback` (`js-request-idle-callback`).
  - Lazy-load candidates: ConflictResolver's `@codemirror/merge` instance and
    `lib/printExport.tsx` PDF renderer (`bundle-dynamic-imports` translated to
    `React.lazy` — neither is needed on boot or in the share chunk).
  - `content-visibility: auto` / `contain` on inactive panes (kursku; validate against
    CM6 measure invalidation before committing).
  - Key stability: never array-index keys for tree rows / tabs (react-doctor
    `no-array-index-as-key`) — rename/DnD identity depends on stable keys.
  - Verify pass: low-end device profile + CPU throttle before/after (kursku Verify).

### 3.7 Settings persistence schema versioning

- **Source:** vercel-labs `client-localstorage-schema`, `js-cache-storage`.
- **Action:** version the persisted `useSettingsStore` (and any lightning-fs metadata)
  payloads now, before v2 sync starts migrating settings across devices; include a
  migration function per version and a discard-on-unknown-version policy.
- **Status:** already satisfied — audit found `useSettingsStore` on zustand `persist`
  with `version: 4` and a full `migrate` chain (v1 density remap, v3 dead-field
  deletion, v4 policy-split + setup-gate), and `useTabsStore` on the same pattern
  (`version: 1`, pre-Phase-6 flat-shape migration). The file's own comments document
  the bump discipline ("pure additions never need a version bump"). Remaining work is
  only to KEEP the discipline for future shape changes — nothing to build.

### 3.8 SKILL.md upgrade for our own skill (meta-item)

- **Source:** shadcn skill architecture (Tier A #2).
- **Action:** evolve `skills/my-you-eye/SKILL.md` toward: (i) a project-context section
  pointing at `components.json` + the `src/components/local/` inventory with the rule
  "check installed/local components first; don't rebuild ContextMenu/SegmentedControl/
  FindWidget/etc."; (ii) Critical-Rules files written as Incorrect/Correct pairs
  (❌ hand-rolled styled button → ✅ library component + root token; ❌ silent inline
  submenu → ✅ local comp + backlog entry); (iii) a need→component table covering all
  ~20 local gap-fillers; (iv) consent-gated workflow for anything that would add a
  dependency or fork a component ("registry must be explicit, ask, never default").
- **Constraint:** keep the file lean (its own maintenance rules say every paragraph
  must earn its keep); detail goes into referenced files, mirroring the thin-SKILL +
  rules/ layout.

### 3.9 One-time react-doctor audit

- **Source:** Tier A #3.
- **Action:** run `npx react-doctor@latest --verbose --no-telemetry` once, read-only;
  triage findings against the hot paths above; lift recurring rule names into the
  review checklist (Part 4). Skip the agent-skill install (remote-drifting playbook)
  and ignore any suggestion to adopt Million.js runtime (ledger 1.3).

---

## Part 4 — Adopted review checklists

Standing checklists for PR review, compiled from the prioritized sources. Not new
law — a condensation of external doctrine aligned with CLAUDE.md.

**React/perf (vercel-labs client slices + react-doctor categories):**
derived state computed in render, not stored; reads deferred to callbacks via
`getState()`; memoized rows get stable/defaulted props; no inline component
definitions in render paths; functional setState for state-dependent updates;
effects only for synchronization (move event logic to events); `useDeferredValue`
for palette/tree filter over large corpora; Map/Set over array scans; passive scroll
listeners; stable keys everywhere.

**Interaction/a11y (WIG + fixing-accessibility + addyosmani):**
icon buttons named; overlays never cover the focused element; errors inline +
focus-first-error; destructive actions confirm-or-undo; gestures have keyboard
alternatives; `tabular-nums` on numeric columns (DiffStatChip counts, diff stats);
flex children `min-w-0` for truncation (tab titles, long filenames); `aria-live`
for async status; reduced-motion honored; no `<div>` click-targets; no
`outline-none` without focus-visible replacement; no `transition: all`.

**State (wshobson Do/Don'ts, zustand-scoped):**
colocate; select primitives; compute derived data in selectors; persist middleware
only for real preferences; never store derived rows; watch `Object.is` equality.

**Theming (shadcn customization doctrine, adapted):**
semantic tokens only — never raw color values in components; adding a color means
editing the global CSS file; accent changes are two OKLCH vars at the root;
sidebar chrome uses its own namespace (Part 2.4).

**Anti-slop (baseline-ui with Stack section struck):**
one accent per view; empty states carry one clear next action; skeletons mirror real
layout; destructive actions use confirm dialogs; `h-dvh` over `h-screen` for PWA
viewport correctness; never block paste; fixed z-index scale; compositor-only
animation properties.

---

## Part 5 — Backfill annex (full-report sweep)

First pass through the seven source reports compressed out roughly a third of
actionable detail. This annex restores everything executable that Parts 1–4 didn't
already carry, grouped into workstreams. Each entry names its source so nothing here
is untraceable. Status: all `planned`.

### 5.1 Tailwind v4 modernization of our own CSS

- **Source:** wshobson `tailwind-design-system` (the v4-correct one, found via finfin);
  shadcn `customization.md`.
- **Items:**
  - Audit how `.dark` is wired: if it's a media/variant hack rather than
    `@custom-variant dark (&:where(.dark, .dark *))`, migrate.
  - Declare keyframes inside `@theme` (`--animate-*` tokens) instead of ad-hoc
    `@keyframes` in component CSS, so animations participate in the token system.
  - Adopt `@starting-style` for Dialog/popover/menu entry transitions — removes
    mount-class hacks and works for the `display`-toggled overlays we compose.
  - OKLCH migration path for `theme.css`: convert hand-picked hex values to OKLCH so
    accent derivations (§2.3/§2.4) can be computed, not guessed.
  - Container-query audit: StatusBar got priority-collapse via `@container`; check
    whether pane headers / sidebar headers should be containers too instead of
    JS-measured breakpoints.
- **Acceptance:** no non-token keyframes outside `@theme`; dialogs animate via
  `@starting-style`; `grep` finds no raw hex outside the token layer.

### 5.2 Motion discipline audit

- **Source:** kursku `baseline-ui` (Stack section struck); mblode `ui-animation`
  (finfin index); DESIGN-SPEC motion rules.
- **Items:** every interactive feedback ≤200ms; entrances ease-out (exits may ease-in);
  compositor-only properties only (`transform`/`opacity`) — audit current transitions
  for `width`/`height`/`top`/`left` animation (ResizeHandle drag already writes width;
  verify it doesn't transition it); loops pause when offscreen (`content-visibility`
  or IntersectionObserver); `text-balance` on display headings, `text-pretty` on body
  paragraphs where wrapping shows raggedness.
- **Acceptance:** a sweep grep + visual pass per DESIGN-SPEC amendment round; reduced-
  motion already covered in §3.4.

### 5.3 Micro-copy & numeric typography

- **Source:** WIG Content & Copy / Typography groups.
- **Items:** keyboard hints use non-breaking space (`⌘⍽K`, `Ctrl⍽S`) so hints never
  wrap mid-combo; truncated labels use the real `…` character (not three periods) —
  audit TitleBar breadcrumb, tab titles, status bar segments; `tabular-nums` extends
  beyond DiffStatChip to every numeric column/comparison: git ahead/behind counts,
  sync progress, match counters in FindWidget ("N of M"), VirtualList row counts.
- **Acceptance:** grep-audit + visual pass; no layout shift when counts tick.

### 5.4 Resiliency: error boundaries & offline states

- **Source:** kursku `harden` (partially un-skipped: its resiliency checklist is
  compatible with DESIGN-SPEC authority even though its taste siblings are not).
- **Items:** per-pane error boundary so one crashing editor pane renders an inline
  error card (library `EmptyState`/`Alert`) instead of unwinding the whole grid;
  offline-first error states for sync/share operations (PWA must degrade gracefully —
  CLAUDE.md rule 3); text-overflow audit across chrome (every truncating surface has
  a `title` tooltip or expansion affordance).
- **Acceptance:** forced-throw test in dev renders the error card in-pane only;
  airplane-mode walkthrough of sync actions degrades with messages, not breaks.

### 5.5 PWA viewport & caching strategy

- **Source:** kursku `optimize`; baseline-ui interaction rules.
- **Items:** `h-dvh` over `h-screen` on the app shell (mobile browser chrome
  correctness); `env(safe-area-inset-*)` padding on chrome edges if phone-sized
  viewports are supported; review service-worker caching strategy against kursku's
  offline guidance (app-shell precache, API/network-only for share fetches) — aligns
  with CLAUDE.md rule 3's "already-loaded or PWA-cached app keeps editing fully
  offline".
- **Acceptance:** Lighthouse PWA checks; manual mobile-viewport pass.

### 5.6 Onboarding polish for VaultSetupPanel

- **Source:** kursku `onboard` (un-skipped subset); SKILL.md design rule 4.
- **Items:** wizard steps get empty-state-with-one-clear-action framing; first-run
  vault detection explains *why* setup is needed before asking for input; completion
  step lands on a concrete next action ("Open notes/architecture.md").
- **Acceptance:** fresh-profile walkthrough; every screen has exactly one primary
  action.

### 5.7 Share-page metadata (v2 tie-in)

- **Source:** kursku `fixing-metadata` — repurposed from SEO marketing to unfurling:
  shared links are meant to be *sent to people*, and link previews are part of that UX.
- **Items:** when the FastAPI backend serves `/share/:id` pages (roadmap §5.x), emit
  OG/Twitter meta tags derived from the share manifest (title = note title, description
  = first heading/excerpt, type=article). SPA shell alone can't do this — it's a
  server-side template concern, so this item lands with v2 server work, tracked now so
  it isn't rediscovered late.
- **Status:** planned (blocked on v2 backend routes).

### 5.8 State tooling upgrades

- **Source:** wshobson Pattern 2 tail + quick-start; vercel-labs `rerender-*`.
- **Items:** add `devtools` middleware to stores in development builds (PaneNode tree
  debugging earns it immediately); adopt `persist` middleware for `useSettingsStore`
  instead of hand-rolled load/save (pairs with schema versioning §3.7 — persist's
  `version`/`migrate` options implement exactly that); transient `subscribe()`
  outside React for ResizeHandle drag — pointermove writes sizes via store.subscribe
  or direct DOM style writes, never re-rendering panes per frame.
- **Acceptance:** drag-resize causes zero React renders in Profiler; settings survive
  reload via persist with migration test.

### 5.9 CI guardrail on this repo

- **Source:** react-doctor GitHub Action mode (`ci install` — PR reviews reporting
  only newly introduced issues), applied to the **vsnote** repo, not the library.
- **Items:** workflow runs `npx react-doctor ci --no-telemetry` in diff mode per PR;
  baseline the current findings once so only regressions gate; keep score-chasing out
  by treating it as a regression tripwire, not a metric.
- **Acceptance:** PR with a deliberately reintroduced anti-pattern gets flagged;
  clean PRs unaffected.

### 5.10 Explicitly evaluated and still skipped

Recorded so the skip survives future sweeps: WIG Locale/i18n group (app is
English-only; revisit if localization ever becomes real — date formatting should then
route through the library's `CellType`/valueFormat doctrine rather than ad-hoc
`toLocaleDateString` calls); WIG hydration-safety group (no SSR); shadcn chat
primitives and registry/MCP machinery; react-doctor runtime profiler (Chrome-trace
based; React Profiler suffices at current scale); kursku taste cluster (bolder/
delight/polish/etc. — fights DESIGN-SPEC authority); Anthropic brand-guidelines;
remotion/RN/game skills; sickn33 entirely (Part 1.3 ledger).

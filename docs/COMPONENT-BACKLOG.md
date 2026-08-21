# Component Backlog

**Scope (refocused 2026-08-21):** this file tracks ONLY component-library gaps and
component import/abstain decisions — per CLAUDE.md rule 2 it is where a library gap
gets logged, not a general notes file for app work. App-level queued/deferred work,
review checklists, and the phase log live in `docs/TODO.md`; per-source skill reports
live in `skills/ANALYSIS.md`. `docs/COMPONENT-BACKLOG-Issued_20260821.md` remains the
inventory of gap-fillers already built in `src/components/local/`.

Derived from the deep analysis of every entry in `skills/index.md`.

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
  highlight); keyboard alternative still required regardless (see docs/TODO.md §3.5) because
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
| Library-side a11y audit (app counterpart in TODO.md §3.4) | #29 | open |
| SKILL.md architecture upgrade | #30 | open |
| Tree-shaking findings (evidence in TODO.md §3.2) | #31 | open, evidence posted |

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
  Arrow keys nudge by step (2% of the branch, or 16px for the sidebar), Shift+Arrow
  large step (8% / 64px), Home/End clamp to min/max (`MIN_FRACTION` 12% for panes;
  the sidebar's `[MIN_SIDEBAR_WIDTH, max]` clamp), Enter/Space fires the
  equalize/reset affordance. Focus ring via the global accent-token baseline.
- **Design reference:** shadcn `Resizable` (react-resizable-panels) a11y contract;
  WIG's "gestures need keyboard alternatives".
- **Status:** done 2026-08-21 — optional `keyboard` prop on the primitive (units stay
  consumer-owned: fractions vs px), wired into both `PaneDivider` and
  `SidebarContainer`; DESIGN-SPEC amendment item 44 records the contract. This also
  closes react-doctor's `interactive-supports-focus` finding from §3.9.

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
- **Why deferred / status update (2026-08-21 audit):** the CONTRAST-GATE half of this
  spec already ships — `lib/accentContrast.ts` (round 6 item 17, unit-tested) derives
  a WCAG-AA-readable `primary` from ANY picked color against the live theme bg,
  derives `primary-fg`, and applies a stricter 7:1 tier for accent-tinted text;
  `applyDomSettings` writes them as root-level CSS vars (the app-side equivalent of
  the OKLCH-pair registration). The delta vs the spec is only the picker UI surface
  (presets/recent/in-app popover) — exactly what my-you-eye#20 says not to build
  until a consumer needs it. Remaining: when built, presets should be named token
  values and the derivation should migrate HSL-lightness math to OKLCH for
  perceptually even adjustments (small, self-contained follow-up in
  `accentContrast.ts`).

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
- **Status: done 2026-08-21** — family defined in both theme blocks (derived aliases +
  exact VSNote-default values), sidebar-scoped consumers migrated (`SidebarContainer`
  TexturedSurface, `ExplorerTree` row active/hover, Search/SourceControl hovers,
  App's Suspense fallback), DESIGN-SPEC amendment item 43 in the same commit.
  Pixel-identical by construction. Upstream tracker: my-you-eye#27 (open — the
  library-side namespace documentation still belongs there).

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

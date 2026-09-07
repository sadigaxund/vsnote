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
| §2.1 DataTable row-actions | #25 | shipped in 2026.8.3 (`onRowClick`/`renderActions`/`actionsHeader`/`actionsWidth`) — not yet consumed, see status note |
| §2.2 ResizeHandle keyboard a11y | #8 (+ cross-ref on #13) | open, addendum posted |
| §2.3 ColorField OKLCH spec | #20 | shipped in 2026.8.3 (`ColorField`/`ColorFieldProps`) — closed, consumed |
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
- **Status:** planned (first needed by SharedPanel row management). **Update
  2026-09-06 (my-you-eye 0.4.0 → 2026.8.3 upgrade):** upstream #25 shipped —
  `DataTable` now has `onRowClick(row, e)`, `renderActions(row)`,
  `actionsHeader`, and `actionsWidth` (confirmed in the installed
  `node_modules/my-you-eye/dist/index.d.ts`). Not consumed yet: this upgrade
  was scoped to the dependency bump alone, and the shares/remotes tables it
  would replace are a separate, later step. This entry stays `planned` until
  that step lands and wires these props in.
  **Update 2026-09-06 (docs/PLAN-2026-09-05-refresh.md §2/§4):** consumed —
  `components/SharedView.tsx` (the new "Shared" activity-bar view,
  replacing the deleted `local/SharedPanel.tsx`) uses `renderActions` for
  its trailing copy-link + overflow-`DropdownMenu` actions cell. Status
  now **done**.

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

### 2.3 ColorPicker / ColorField — resolved 2026-09-06, upstream shipped

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
- **Status: resolved 2026-09-06** — upstream #20 shipped in my-you-eye
  2026.8.3 (`ColorField`/`ColorFieldProps`: `value`, `onChange(hex)`,
  `presets`, `label`). `src/components/SettingsView.tsx`'s accent-color row
  now uses it in place of the hand-rolled native `<input type="color">`,
  keeping the same setting semantics (`useSettingsStore`'s `accent`/
  `setAccent`) and label copy ("Accent color"), seeded with one preset (the
  VSNote default teal, `#27d2c5`). The CONTRAST-GATE half of the spec
  (`lib/accentContrast.ts`) is unchanged by this swap — it derives from
  whatever hex `ColorField` reports, same as it did from the native input.
  Remaining follow-up, still open: named-token presets beyond the single
  default, and the HSL→OKLCH derivation migration in `accentContrast.ts` —
  neither blocks this closure, both are pre-existing self-contained work.

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

### 2.7 `Logo` (2026-09-05, logo wiring) — not an upstream candidate

- **Gap:** none of the three prior sites of the "app identity glyph" (title bar,
  share reader's title bar, login gate wordmark) actually rendered VSNote's own
  mark — each hand-rolled a generic CSS-gradient square with a `lucide-react`
  `Layout` icon standing in for it. This isn't a library gap (`my-you-eye` has no
  way to know this project's brand artwork), so there is nothing to upstream; it's
  logged here per CLAUDE.md rule 2 for the "missing component protocol" record.
- **Built:** `src/components/local/Logo.tsx` — inline `<svg>` (props `size`,
  `mono`, `title`, `className`), transcribing `public/favicon.svg` (default) and
  `public/logo-mono.svg` (`mono`, `currentColor` strokes) verbatim. Wired into
  `src/components/TitleBar.tsx`, `src/share/ShareApp.tsx`, and
  `src/components/LoginGate.tsx`'s `Wordmark`, replacing the gradient chips.
  Full row (props sketch, exact call sites): `docs/COMPONENT-BACKLOG-Issued_20260821.md`'s
  `Logo` entry. DESIGN-SPEC Amendments round 10 item 62.

### 2.8 `CodeBlock` static highlighting for an app-supplied language (Markii Phase M1, 2026-09-06)

- **Gap:** `my-you-eye@2026.8.3` exports `CodeBlock` with a `highlight` prop, but
  it only lights up its own built-in tokenizer — a small, fixed language list
  (`js`/`ts`/`tsx`/`json`/`bash` per its own type doc). There is no way to hand it
  an external parser/highlighter for a language outside that set, or to keep its
  output in sync with whatever CM6 language a *consuming app* already resolves per
  file (VSNote's `filetypes/registry.ts` covers more file kinds than CodeBlock's
  built-in set, and needs the exact same highlighting for both a live CM6 editor
  and a static print/share `<pre>`).
- **Built:** `src/markdown/codeBlock.tsx` (component) + `codeBlockLogic.ts` (pure
  cap/highlight logic, split for `react-refresh/only-export-components`) — a
  local `<CodeBlock code kind maxLines>` running `@lezer/highlight`'s
  `highlightCode` directly over the Lezer parser behind whichever CM6 language
  `filetypes/registry.ts` already loads for `kind`, emitting `@lezer/highlight`'s
  own `tok-*` classes (mapped onto `theme.css`'s `--syntax-*` role tokens — the
  same ones `editor/theme.ts`'s CM6 `HighlightStyle` uses). Caps at 5,000 lines
  (DESIGN-SPEC item 33's perf-cap convention) and degrades to plain, correctly-
  escaped text for an unrecognized language. Used directly for a standalone code
  file share/print, and via `src/markdown/render.tsx`'s `vsnote-code` directive
  rewrite for a fenced code block embedded in a rendered markdown document (see
  `docs/ARCHITECTURE.md`'s markdown-pipeline section).
- **Filed:** sadigaxund/my-you-eye#36 — proposes an `externalHighlight` (or
  equivalent) escape hatch so a consumer with its own Lezer tree/highlighter (or
  pre-tokenized line spans) doesn't need a from-scratch local component just to
  highlight a language `CodeBlock`'s built-in tokenizer doesn't cover.

### 2.9 `Stepper` (Publish dialog rebuild, 2026-09-06; redesigned R5 2026-09-08)

- **Gap:** `my-you-eye` has no Stepper/Wizard/Progress primitive —
  `skills/components.json` returns zero entries for any of the three names.
  Needed for the rebuilt `PublishDialog.tsx` (docs/PLAN-2026-09-05-refresh.md
  §4): a five-step linear form (Mode -> Who can open -> Protection -> Link ->
  Result), and later reused by Settings > Git & Sync's guided connection card.
- **Built (original, 2026-09-06):** `src/components/local/Stepper.tsx` —
  numbered dots + labels, a connecting rule, and a checkmark "done" state.
- **Redesigned (R5, 2026-09-08, owner correction on the fix-1 dialog-height
  pass):** the numbered-circle design does not scale down to a fixed 480px
  width once there are five steps — reported as "step 5 is cut off, badge
  digits aren't centered." Replaced with a compact segmented-progress design:
  one text line ("Step 2 of 5 · Who can open") above a 5-segment bar (4px
  tall, 4px gaps, filled solid up to the current step, done segments
  clickable back). A bar segment has no minimum content width the way a
  circle-plus-digit does, so this scales to any step count at any dialog
  width. Same props interface (`steps`/`current`/`onStepClick`/`ariaLabel`/
  `testidPrefix`) as before — the Git & Sync call site needed no changes.
  Every existing `data-testid="<prefix>-step-<id>"` / `role="tab"` /
  `aria-selected` contract (`tests/e2e/publish-dialog-steps.spec.ts`) is
  unchanged; only what renders INSIDE that element changed.
- **Filed:** ALREADY EXISTS upstream as sadigaxund/my-you-eye#35 (confirmed via
  `gh issue list -R sadigaxund/my-you-eye --state all` before building this) —
  not re-filed; a comment describing this segmented-progress variant (as a
  second possible shape for the requested primitive, alongside the original
  numbered-circle one) was added to that issue instead of opening a duplicate.
  This local component unblocks both dialogs in the meantime, per CLAUDE.md
  rule 2's "missing component protocol."

### 2.10 `Switch` unchecked-state contrast in dark themes (2026-09-06)

- **Gap:** `Switch`'s unchecked track (`bg-secondary`) and thumb (`bg-bg`) resolve
  close enough in VSNote's dark theme that an OFF switch reads as a bare,
  borderless dark circle with no visible track — found while screenshot-reviewing
  the rebuilt Publish dialog's "Never expires"/"Show title" toggles, then
  confirmed reproducible on a PRE-EXISTING, unrelated toggle (Settings → Git &
  Sync's "Show git status in explorer") — so this is the component's own
  contrast behavior in this theme, not something introduced by new consumer code.
- **Not worked around locally** — CLAUDE.md rule 1 forbids patching library
  internals from this app; shipped as-is.
- **Filed:** sadigaxund/my-you-eye#37 — proposes either a persistent track border
  or a thumb color guaranteed to contrast with `bg-secondary` specifically.

### 2.11 `SettingsRow` / `SettingsSection` (Settings layout refresh, 2026-09-06)

- **Gap:** `my-you-eye` has no settings-layout primitive — `skills/components.json`
  has no `SettingsRow`/`SettingsSection`, nor a horizontal "label + description
  left, control right" variant of `FormField`. Needed for the Settings refresh
  (docs/PLAN-2026-09-05-refresh.md §2): every category previously hand-rolled its
  own label/hint/control flex markup per row (`FormField` plus ad hoc
  `style={{...}}`), and the page had no consistent field-sizing-by-type story.
- **Built:** `src/components/local/SettingsRow.tsx` — `SettingsRow` (label +
  hint on the left, control on the right, wrapping to a stacked layout on a
  narrow content column via plain flexbox wrap — same "flex-wrap does the
  responsive work, no media/container query" technique `Stepper.tsx` and
  `SegmentedControl.tsx` already use) and `SettingsSection` (the `gap: 20`
  vertical-rhythm wrapper every category's row list sits in). `controlWidth`
  drives field sizing BY TYPE from one place (plan §2 item 3): `"narrow"`
  (~12rem, numbers/short enums), `"text"` (~24rem, free text), `"full"` (100%,
  textareas/tables/multi-part panels) — replacing the per-call-site inline
  `style={{ width }}` every row used before. Every `settings/<Category>.tsx`
  module (the split of the former 1400-line `SettingsView.tsx`, item 4 of the
  same plan section) uses this primitive for its rows.
- **Filed:** ALREADY EXISTS upstream as sadigaxund/my-you-eye#34 (confirmed via
  `gh issue list -R sadigaxund/my-you-eye --state all` before building this) —
  not re-filed. This local component unblocks the Settings split in the
  meantime, per CLAUDE.md rule 2's "missing component protocol."

### 2.14 `SettingsNavRail` — vertical NavList/SideNav/TOC (Settings nav rail restyle, round 5)

- **Gap:** `my-you-eye` has exactly one navigation-group component, `Tabs`
  (`filing`/`pills`/`underline`), and all three render `role="tablist"`/
  `role="tab"`/`aria-selected` with a filled or underlined "selected" look.
  Settings' category rail (item 119, `SettingsView.tsx`) is a scroll-spy table
  of contents, not a tab switcher: every category's section is always
  mounted, and a rail click just smooth-scrolls to an already-rendered
  section — the design-health critique named the mismatch directly ("rail
  semantics contradict its look: pills + aria-selected over a
  continuous-scroll TOC"). None of `Tabs`' three variants is a plain,
  unfilled current-row look (icon + label, muted when inactive, a leading
  accent bar when current) either, so even the visuals had to be fought.
- **Built:** `src/components/local/SettingsNavRail.tsx` — `<nav
  role="navigation">` wrapping one `role="list"` `<ul>` per group (three
  groups, two `Separator` dividers, no group labels), `<button
  aria-current="true">` on the current row instead of `aria-selected`, and
  roving-tabindex up/down (vertical) / left/right (horizontal) keyboard nav
  (Home/End jump to the first/last row) reimplementing what Radix's
  `Tabs.Root` gave the old version for free. Visuals in `index.css`
  (`.settings-nav-rail__item`/`__list`/`__divider`): no filled background at
  any state, muted text inactive, a hover surface, and a 2px accent bar on
  the row's leading edge (left at the wide/vertical layout, top once the
  rail reflows horizontal below 900px) for the current row.
- **Filed:** sadigaxund/my-you-eye#41 (checked `gh issue list -R
  sadigaxund/my-you-eye --state all` first — highest existing number was
  #40, no duplicate).

### 2.12 `Toast` variant styling (design polish round 2, 2026-09-07)

- **Gap:** `my-you-eye`'s `ToastItem` (`node_modules/my-you-eye/dist/index.js`)
  hardcodes its `success`/`danger` variants as a SOLID color fill —
  `"border-success bg-success text-success-fg"` — via an internal, unexported
  `toastVariants` `cva()` call. `ToastData` (the public type `toast({ ... })`
  takes) has no `className` field (`node_modules/my-you-eye/dist/index.d.ts`),
  so there is no supported prop OR token to restyle it — the color IS the
  fill, not a remappable role token, and recoloring `--color-success`/
  `--color-danger` globally would also repaint git status, alerts, and badges
  everywhere else those tokens carry real semantic meaning. Found during the
  round-2 design-polish pass: a solid saturated green toast was named as the
  single loudest, crudest element on screen in two of the six review
  screenshots.
- **Built:** `src/components/local/Toast.tsx` (+ `useToast.ts`, split out
  only to satisfy `react-refresh/only-export-components` — a module can't
  mix a component export with a plain hook export) — same underlying Radix
  primitive the library itself uses (`@radix-ui/react-toast`, added as a
  direct dependency), restyled with this app's own token vocabulary instead
  of a solid fill: `--color-surface-elevated` background, 1px `--color-border`
  border, `--radius-ui` corners, `--shadow-elevated`, and a 3px left accent
  bar (title text matches the accent) in the status color — teal for
  `default`, `--color-success` for `success`, `--color-danger` for `danger`.
  `ToastData`/`useToast()`/`Toaster` match the library's own shapes
  byte-for-byte, so every existing `toast({ title, description, variant })`
  call site (`App.tsx`, `SourceControlPanel.tsx`, `SharedView.tsx`,
  `PublishDialog.tsx`, `VaultSetupPanel.tsx`, `RunScriptsButton.tsx`,
  `OverflowMenu.tsx`, `boot.tsx`'s `<Toaster>` mount) only needed its import
  source changed, never its call shape. Accessibility behavior — the Radix
  `Provider`'s duplicate visually-hidden `role="status"` announcer alongside
  the visible toast, depended on by `tests/e2e/markii-scripts.spec.ts` — is
  preserved exactly, since it comes from the Radix primitives themselves,
  not from `my-you-eye`'s styling layer.
- **Filed:** NOT YET — this agent does not file upstream issues (CLAUDE.md
  rule 1: the orchestrator files them after confirming the gap). Flagged in
  the round-2 design-polish report for the orchestrator to file; suggested
  shape: either a `className`/`variantClassName` escape hatch on `ToastData`,
  or per-variant CSS custom properties (`--toast-success-bg` etc.) the way
  this app's own token files already do for its local components.

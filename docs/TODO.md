# TODO — VSNote app work queue

Scope split (2026-08-21): `docs/COMPONENT-BACKLOG.md` now tracks ONLY
component-library gaps and upstream decisions, per CLAUDE.md rule 2's intent.
Everything about improving THIS app — queued work, deferred decisions with
reasons, standing review checklists, and the completed log — persists here.
Section numbering from the former COMPONENT-BACKLOG parts is preserved
(§1.x import decisions stayed in that file; §2.x = library gaps there; §3.x /
§5.x = this file) so `skills/ANALYSIS.md`'s references stay valid. Source
citations point at `skills/ANALYSIS.md` (per-source reports).

---

## 5.x — Queued workstreams (backfill annex, full-report sweep)

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


---

## Completed log — Phases A–D (2026-08-21)

| Item | Commit |
|---|---|
| A: beforeunload dirty guard (§3.3) | `352f5c8` |
| A: audit results recorded; §2.5 resolved; §3.7 already-satisfied | `595d24c` |
| A/B: upstream tracker map; #28 closed as moot | `45cbba3` |
| B: tree arrow nav + rename announcements; roving tablist (§3.4) | `0cc162f` |
| B: dialog aria-invalid compensation; status-bar live region; focus-visible + reduced-motion baselines | `9d5758f` |
| C: react-doctor remediation batch (§3.9) | `f78bff6` |
| C: App targeted selectors + storeSelectorHygiene guard (§3.1) | `2159347` |
| D: --sidebar-* namespace (DESIGN-SPEC item 43, §2.4) | `2f95271` |
| D: keyboard resize handles (item 44, §2.2) | `9019c1f` |
| D: keyboard tree move Ctrl+X/V (§3.5) | `943108a` |
| demo: searchRank.ts multi-hunk diff showcase | `b104497` |

---

## 3.x — Improvements to existing components/code

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
- **Results (2026-08-21):**
  - `App.tsx` held the LAST two whole-store subscriptions in the app
    (`useGitStore()`/`useTabsStore()`) — replaced with targeted selectors for exactly
    what App renders (focused-pane identity + eight git summary numbers); every tabs/git
    ACTION now reads `getState()` at call time. A tab rename, mode flip, or sync tick no
    longer re-renders the shell.
  - Fresh-reference selector sweep: none found anywhere (StatusBar's mode selector is a
    primitive; EditorPane's leaf selector returns an immutable-tree node whose identity
    only changes when that subtree does).
  - Both rules are now pinned by `tests/unit/storeSelectorHygiene.test.ts` (static scan,
    fsIsolation-style) so whole-store calls and `(s) => ({...})`/`.map()` selectors fail CI.
- **Deferred as §3.1b (row-level memoization):** rows in `ExplorerTree`'s virtualized path
  are props-driven and NOT `React.memo`-wrapped, and their handler props get fresh
  identities per ExplorerTree render — memo without handler stabilization would be a no-op.
  This is the remaining work for the "single-row expand" Profiler criterion; needs a
  browser-side Profiler session anyway, which this environment can't run honestly.

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
- **Dialogs — audited; partial app-side fix.** All four dialogs (Publish,
  ImportConflict, ConflictResolver, VaultSetupPanel remote dialog) have both
  `DialogTitle` and `DialogDescription`, so Radix auto-wires the dialog-level
  `aria-describedby`, trap/restore/Escape/initial-focus all come from Radix.
  Library gap found: `FormField` renders its `error` prop visually but wires NO
  `aria-invalid`/`aria-describedby` onto the control (verified against dist), so
  field-level errors are silent to screen readers. App-side compensation added:
  `aria-invalid` on the four VaultSetupPanel credential controls (error text
  follows in DOM order); full describedby linking needs upstream support —
  evidence posted on my-you-eye#29.
- **StatusBar live regions — done:** a polite `role="status"` region announces
  sync TRANSITIONS only (started / completed / failed with error text) — never
  the periodic "synced Nm ago" re-derivation, which would chatter every tick.
- **Global sweep — done:** baseline `:focus-visible` accent ring added in
  `index.css` (the library ships no focus-visible styling at all — this was the
  single biggest gap), plus a global `prefers-reduced-motion` guard collapsing
  animation/transition durations. `color-scheme` deliberately left at the
  library's `light dark` default: hardcoding `dark` would break the light
  appearance themes; a per-theme appearance→color-scheme map belongs with §2.4's
  token-namespace work.

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
- **Status: done 2026-08-21, with a simpler shape than first sketched:**
  - **Tree move** = standard cut/paste semantics instead of a bespoke dialog: Ctrl+X
    on a focused row stashes it (announced), Ctrl+V on a resolved target folder moves
    it via the same `onMove` the drag path uses — including handleDrop's
    self/descendant refusal. No new destination-picker UI to maintain.
  - **Tab dock** already had its non-drag affordance all along: the per-tab context
    menu's Split/Move items, reachable from the keyboard since B3 (tabs are focusable;
    Menu key fires a real contextmenu event on them). Documented here so nobody
    rebuilds it.
  - Drag-gesture hardening (`user-select`/`inert` during active drags) remains open —
    low value until multi-select drag lands (§1.1 trigger criteria).

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
- **Results (2026-08-21):** 83 findings. **19 were scanner overreach** — it walked
  `server/.venv` third-party Python (sqlalchemy/dulwich "SQL injection"/"command
  execution"); if CI mode is ever adopted (§5.9), exclude that path. The rest
  triaged as follows.
- **Fixed:** `vaultSearch` chunked-parallel file reads (16-wide, early-exit kept);
  `exportZip` sibling-parallel tree walk; `importEntriesFs` concurrent existence
  checks + writes (order-preserving); App's folder-publish concurrent buffer loads;
  `FileIcon` lazy-manifest promise got its missing `.catch`; `autoRepublish`
  exclusions blob versioned (`{v:1,map}`, legacy bare-map adopted on read); `ShareApp`
  tab-close side effect moved out of the state updater; `useTabsStore.setKind`
  hoists the availability scan out of the per-tab map; `ExplorerTree.findNodeById`
  hoisted to module scope; zen-mode exit overlay made keyboard-operable; SSH-key
  placeholder reworded so the secret-leak heuristic stops flagging a PEM-header
  *example string* in the built bundle.
- **Wontfix, with reasons (standing ledger):** git add/commit loops stay sequential
  (index integrity requires ordering); "giant component" flags on App/SettingsView/
  ExplorerTree etc. are real but are refactor projects, not perf items;
  `no-derived-state` on StatusBar's sync live region is deliberate transition
  detection; `prefer-useReducer` on FindWidget and the eight `.filter().map()`
  single-pass suggestions are style/micro at our list sizes; nested-interactive tab
  (close button inside `role="tab"`) matches VSCode's own accepted pattern;
  `prefer-tag-over-role` misreads the wrapper `<li role="none">` presentation idiom.
  `interactive-supports-focus` on `ResizeHandle` is REAL — subsumed by §2.2's
  keyboard contract (Phase D).

---

## Standing review checklists (adopted from the skill analysis)

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

## 6.x — Phase E0 deep-read findings (2026-08-21)

First full ingestion of the vendored reference bodies (no summaries): all 70
vercel-labs rule files, all composition-patterns bodies, shadcn's
base-vs-radix/forms/styling/icons rules — audited against `src/`. Result counts:
vercel rules **20 applied / 19 NEW / 26 N-A / 5 already-queued**; composition
doctrine audited against 4 local components. New items below.

### 6.1 Perf: from vercel rule bodies (ordered by impact)

Status after the 2026-08-21 implementation pass: **items 1–3 done** (`e49f830`, `1ada982`, `310785d`), item 7's spinner-wrap done in the same batch; rest still open.

1. ✅ **fs read cache** (`server-cache-lru` translated) — Map-based LRU (~500
   entries, TTL) over `fs/operations.ts` `readTextFile`/`listDir` so repeated tree
   renders + search sweeps skip IndexedDB round-trips. Biggest unqueued 50k lever.
   Invalidate on every `writeFile`/delete/rename through the same module.
2. ✅ **SearchPanel rows through existing `VirtualList`** (`rendering-content-visibility`
   extension) — `SearchPanel.tsx` renders `results.map` unwindowed; fixed-row-height
   fits our VirtualList exactly.
3. ✅ **VirtualList scroll rAF-coalesced** (`rerender-transitions`) —
   `VirtualList.tsx` `onScroll → setScrollTop` re-renders synchronously per frame;
   wrap in `startTransition` or rAF-throttle (pair with queued passive-listener).
4. **Single-pass flattens** (`js-combine-iterations`/`flatmap-filter`) —
   `lib/flattenTree.ts` + `lib/filterTree.ts` multi-pass per node; collapse walks.
5. **Preload lazy panels on ActivityBar hover/focus** (`bundle-preload`) — fire
   `void import()` for Settings/SourceControl/Search chunks on intent.
6. **Cheap-guard-before-await audit** (`async-cheap-condition-before-await`) —
   sweep `src/share/*` + `git/sync.ts` for remote awaits preceding local guards.
7. Micro-batch (spinner half ✅ — all 17 wrapped): hoist locals in
   vaultSearch inner loop; primitive-useMemo sweep; hoist static empty-state JSX;
   split fused filter+sort memos if deps mix.
8. Watchlist (post-profile only): `memo()` adoption — deliberately zero today;
   selector granularity + hygiene test is OUR mechanism (see 6.4 contradiction #2).

### 6.2 Component doctrine: PublishDialog variant refactor

`architecture-avoid-boolean-props` + `patterns-explicit-variants` verdict on the
audit: PublishDialog derives `editMode`/`isFolder` from discriminators
(`existingShare`, folder triple) → 4 implicit modes with conditional rendering =
textbook boolean sprawl. Refactor shape: explicit variants
(`PublishFileNew`/`PublishFolderNew`/`EditShareFile`/`EditShareFolder`) composing
shared parts (header, policy section, footer) — "no impossible states".
ExplorerTree/EditorTabBar/SidebarContainer conform or have documented tradeoffs;
ExplorerTree is an exemplar for state-decouple/lift-state.

### 6.3 Forms contract enrichment for my-you-eye#29

shadcn `forms.md` exact pairing (stronger than our current one-sided fix):
**both** `data-invalid` on the Field wrapper (styles label/description) AND
`aria-invalid` on the control (styles input); same for `data-disabled`/`disabled`;
description/error node rendered beneath the control gets an id wired via
`aria-describedby`. Works uniformly across Input/Textarea/Select/Checkbox/
RadioGroupItem/Switch/Slider. Update #29 comment + our VaultSetupPanel usage to
the full pairing once upstream exposes ids. Also from `base-vs-radix.md`: we're
Radix-column conformant (inline SelectItem JSX, placeholder on SelectValue);
ToggleGroup unused; Slider takes array values ✓. Styling-rules audit of src:
zero violations (no space-x-*, no raw status colors, no manual dark:, no manual
overlay z-index outside tokens). `icons.md`'s `data-icon` convention is shadcn-
specific — N/A for my-you-eye; its "no sizing classes on icons" principle does not
apply to lucide-in-my-you-eye sizing.

### 6.4 Contradictions ledger additions (extends INDEX.md register)

1. **content-visibility vs JS windowing**: rule prescribes CSS
   `content-visibility:auto`; repo's threshold-gated VirtualList is the stronger
   choice around CodeMirror measure invalidation — CSS form survives only for
   non-CM long lists (item 6.1.2).
2. **memo()/compiler philosophy vs selector granularity**: skill leans on memo();
   repo enforces subscription granularity via static-scan test instead. Both valid;
   apply memo() only post-profile (6.1.8) so it can't paper over the store invariant.
3. **client-event-listeners prescribes SWR subscription** — rejected: zustand-only
   law; moot anyway (all window/document listeners are app singletons).
4. **useTransition-loading vs SearchPanel's debounced isLoading** — manual state is
   correct where loading wraps a real async sweep; keep.
5. Repo goes BEYOND the skill on unload safety: visibilitychange flush exists
   because beforeunload alone is unreliable in SPAs — don't "simplify" toward
   generic guidance.

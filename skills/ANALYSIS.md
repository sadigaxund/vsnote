# Skills index analysis — curated for VSNote

Analysis of every entry in `skills/index.md`, fetched and read in full (one research
subagent per entry, including sub-skills), then judged against THIS repo: a browser-only
VSCode + Obsidian hybrid whose UI law is **my-you-eye-first** (114-component npm library,
token-level restyling only, no forks/wrap-overrides), CodeMirror 6 as the single editor
stack, React 18 + TS strict + zustand 5 + Tailwind v4 + Radix primitives, isomorphic-git +
lightning-fs entirely in-browser, FastAPI backend (v2) for sharing/auth/sync, PWA offline
editing, and a 50k-note vault performance target.

**Ranking principle (per request):** sources maintained by professional parties are
prioritized as more reliable. Tier A below is the professional top 4; Tier B is community.

| Rank | Source (index line) | Maintainer | Trust | Verdict |
|---|---|---|---|---|
| 1 | vercel-labs/agent-skills (L4) | Vercel (official labs org) | Tier 1 vendor | mine-selectively |
| 2 | ui.shadcn.com/docs/skills (L2) | shadcn team at Vercel | Tier 1 vendor | mine-selectively, do NOT install |
| 3 | millionco/react-doctor (L3) | Million (Million.js company) | Tier 1 vendor | run once as audit; skip skill install |
| 4 | addyosmani/web-quality-skills (via L7) | Addy Osmani (Google Chrome eng lead) | Professional | adopt for a11y/perf checklists |
| 5 | wshobson/agents react-state-management (L1) | Individual (38.9k★ repo) | Community | mine-selectively |
| 6 | kursku/skills frontend (L6) | Individual PT-BR aggregator | Community (re-hosts) | mine-selectively |
| 7 | finfin/awesome-frontend-skills (L7) | Individual curator | Community index | use as index only |
| 8 | sickn33 …tailwind-design-system (L5) | Individual bulk-ingest catalog | Community boilerplate | SKIP |

---

## Tier A — professional-party sources (prioritized)

### 1. vercel-labs/agent-skills — `skills/react-best-practices`, `composition-patterns`, `web-design-guidelines`

**Provenance.** Vercel's official labs org ("Vercel's official collection of agent
skills"). 30,286★ / 2,708 forks; created 2025-12-08; last push 2026-08-18 (days ago);
MIT; agentskills.io format; installable via `npx skills add vercel-labs/agent-skills`.
Each skill = SKILL.md rule index + `rules/*.md` (one file per rule with wrong/right code)
+ compiled AGENTS.md. Highest applicable rule payload of anything examined.

**Inventory.**
- `react-best-practices` — 70 rules / 8 priority categories. Client-applicable slices:
  - `rerender-*`: `derived-state`, `defer-reads`, `memo`, `memo-with-default-value`,
    `dependencies`, `derived-state-no-effect`, `functional-setstate`, `lazy-state-init`,
    `split-combined-hooks`, `move-effect-to-event`, `transitions`,
    `use-deferred-value`, `use-ref-transient-values`, `no-inline-components`
  - `rendering-*`: `content-visibility`, `hoist-jsx`, `conditional-render`
  - `js-*`: `index-maps`, `set-map-lookups`, `batch-dom-css`, `cache-property-access`,
    `cache-function-results`, `cache-storage`, `combine-iterations`, `flatmap-filter`,
    `early-exit`, `hoist-regexp`, `request-idle-callback`, `length-check-first`
  - `bundle-*`: `barrel-imports`, `analyzable-paths`, `dynamic-imports`, `conditional`,
    `defer-third-party`, `preload`
  - `client-*`: `event-listeners`, `passive-event-listeners`, `localstorage-schema`
  - `server-*` (10 rules) + most `async-*` waterfalls assume RSC/Next — dead weight for
    our SPA, cleanly quarantinable by prefix.
- `composition-patterns` — 7 rules: `architecture-avoid-boolean-props`,
  `architecture-compound-components`, `state-decouple-implementation`,
  `state-context-interface`, `state-lift-state`, `patterns-explicit-variants`,
  `patterns-children-over-render-props`. Its `react19-*` tier self-gates off for React 18.
- `web-design-guidelines` — thin wrapper fetching 100+ interaction/a11y/UX rules from
  `vercel-labs/web-interface-guidelines/command.md`. Representative verbatim rules:
  async updates need `aria-live="polite"`; sticky overlays must not cover the focused
  element; errors inline next to fields + focus first error on submit; warn before
  navigation with unsaved changes; lists >50 items virtualize; no layout reads in render;
  drag gestures need tap/click and keyboard alternatives unless essential; during drag
  disable text selection and set `inert`; `font-variant-numeric: tabular-nums` for number
  columns; flex children need `min-w-0` for truncation; destructive actions need
  confirmation or undo — never immediate; `overscroll-behavior` containment on modals;
  `color-scheme: dark` on `<html>`; anti-patterns include `<div>/<span>` with click
  handlers, `outline-none` without focus-visible replacement, `transition: all`.

**Relevance mapped to VSNote.**
- `rerender-derived-state` → ExplorerTree/VirtualList row selectors must subscribe to
  booleans (`isExpanded(id)`), never whole-node objects; same for ConflictResolver.
- `rerender-defer-reads` → EditorTabBar handlers read tab state via
  `useStore.getState()` inside callbacks instead of subscribing every tab to the array.
- `rerender-memo-with-default-value` + `no-inline-components` → virtualized row
  renderers at the 50k-note target (our >200-row threshold path).
- `bundle-barrel-imports` → **audit how we import my-you-eye**: 114 components behind a
  barrel is exactly the shape this rule warns about; prefer per-component paths.
- `client-localstorage-schema` → version settings persistence schemas BEFORE v2 sync lands.
- `js-index-maps` / `set-map-lookups` → path→node Map for the tree; Set lookups for git
  status during isomorphic-git operations; `flatMap` tree flattening.
- `js-request-idle-callback` → defer search-corpus/index building off the interaction path.
- WIG's unsaved-changes guard → dirty-buffer `beforeunload` protection (arguably
  mandatory for a code editor; verify implemented).
- WIG gesture/keyboard duality → OS drag-drop import and tree DnD need keyboard paths.
- `composition-patterns` → API-shape doctrine for local gap-fillers so future promotion
  into my-you-eye stays trivial (compound parts, explicit variants over boolean props,
  context interface `{state, actions, meta}`).

**Concerns.** Server-bias bounded (~15–20% of flagship skill, prefix-quarantined);
framework drift to translate (`next/dynamic`→`React.lazy`, SWR dedup *idea* without the
dep — repo is zustand-only); WIG's deep-link-all-state rule conflicts with local-first
no-router design — apply narrowly to v2 share links only; wrapper fetches rules from a
second repo at runtime (unpinned relative to snapshot).

**Verdict.** Mine-selectively — treat the client-side slices as standing review
checklists for exactly our named hot paths. Three immediate actions: barrel-import audit,
beforeunload dirty guard, selector-granularity pass ahead of the 50k goal.

---

### 2. shadcn/ui official agent skill — `ui.shadcn.com/docs/skills`

**Provenance.** First-party doctrine of the shadcn team at Vercel, living inside the
`shadcn-ui/ui` monorepo (`/skills/shadcn/`), synced to every CLI release; ~272K installs
on skills.sh (#169 all-time); MIT. Auto-triggers on presence of `components.json`;
frontmatter scopes tools (`allowed-tools: Bash(npx shadcn@latest *)`).

**Inventory.**
- Files: `SKILL.md` + `rules/{forms,composition,chat,icons,styling,base-vs-radix}.md` +
  `cli.md` + `registry.md` + `customization.md`.
- Live project-context injection: SKILL.md embeds `` !`npx shadcn@latest info --json` ``
  so every session starts knowing framework, aliases, installed components, Tailwind
  version, resolved paths — with a field table explaining how each changes generated code.
- 4 principles: existing-components-first (search registries before custom UI);
  compose-don't-reinvent; built-in variants before custom styles; semantic colors only,
  never raw values like `bg-blue-500`.
- Critical Rules written as **Incorrect/Correct code pairs**, domain-split: styling
  (className-for-layout-only, `gap-*` not `space-*`, `size-*`, `truncate`, no manual
  `dark:` overrides, no manual z-index on overlays); forms (`FieldGroup`+`Field`
  mandatory, `data-invalid`+`aria-invalid` pairing); composition (DialogTitle required
  even `sr-only`; full Card decomposition; Avatar needs Fallback); icons (`data-icon`,
  no sizing classes).
- Need→component selection table ("Toggle between 2–5 options → ToggleGroup";
  "Command palette → Command inside Dialog"; …).
- Enforced 9-step gated workflow: check installed → search → docs before writing code →
  view/`--dry-run`/`--diff` previews → install → fix third-party paths → review added
  files against Critical Rules → "registry must be explicit, ask, never default" →
  preset switches require explicit consent.
- Smart-merge update protocol: `--dry-run` then per-file `--diff`, preserve local edits,
  `--overwrite` needs explicit approval, never hand-fetch raw files from GitHub.
- Theming module (`customization.md`): CSS-vars→utilities→components pipeline; strict
  `name`/`name-foreground` token convention; **OKLCH everywhere**; class-based dark mode;
  Tailwind v4 registration via `@theme inline`; `--radius` derivation chain
  (`rounded-md = calc(var(--radius) - 2px)`); customization ladder (variants → className
  layout → edit source → wrapper); "adding a color = edit the global CSS file, never
  create a new one"; dedicated `--sidebar-*` variable namespace for sidebar chrome.

**Relevance mapped to VSNote.**
- **SKILL.md architecture itself is the highest-value, zero-risk take.** Our
  `skills/my-you-eye/SKILL.md` should gain: (i) a project-context section pointing at
  `skills/components.json` + the `src/components/local/` inventory with the rule "check
  installed components first; don't rebuild what exists locally"; (ii) Critical-Rules
  files as Incorrect/Correct pairs (❌ hand-rolled styled button → ✅ library component
  restyled via root token; ❌ silent inline submenu → ✅ local comp + backlog entry);
  (iii) a need→component table covering the ~20 local gap-fillers so agents stop
  rebuilding ContextMenu/SegmentedControl/etc.; (iv) consent-gated workflow mirroring
  "registry must be explicit".
- OKLCH token doctrine → ready-made spec skeleton for the planned ColorPicker/accent
  theming: `accent`/`accent-foreground` OKLCH pairs registered in `@theme inline`, single
  global CSS file, radius derivation — "write 2 vars at root + persist preset".
- `--sidebar-*` namespace precedent → give explorer/sidebar chrome its own near-black
  token family in DESIGN-SPEC instead of overloading generic surface tokens.
- Data-table trailing-actions-column pattern (TanStack Table + DropdownMenu trigger) →
  canonical reference for our recorded "DataTable has no row-actions slot" gap; implement
  with my-you-eye DropdownMenu (+ local OverflowMenu/DropdownSubmenu), not TanStack.
- "Command inside Dialog" → validates grouped-items modal architecture for
  CommandPaletteHost; their Empty-state doctrine suggests shared empty-result states.
- Resizable (thin wrapper over react-resizable-panels) → confirms PaneGroup+ResizeHandle
  direction; supplies the resize-handle keyboard-a11y checklist we currently lack.
- Dialog a11y hard requirements (sr-only title fallback, `aria-invalid`+`data-invalid`,
  FieldSet/Legend grouping) → acceptance criteria for PublishDialog /
  ImportConflictDialog / VaultSetupPanel audits.

**Concerns.** Fundamental model conflict: shadcn's mechanic is *copy component source
into your project and own/edit it* — the inverse of our npm-library-first, no-fork law.
Installing this skill into VSNote would coach agents to violate CLAUDE.md rules 1–2
(its ladder step 3 "new variant via editing source" is exactly what we forbid). Wrong-stack
assumptions throughout (React 19/RSC, next-themes, sonner, cmdk, Recharts, their token
names — adopting those would fragment our theme). Chat primitives, preset machinery and
registry authoring ≈ half the payload, irrelevant here.

**Verdict.** Mine-selectively — do NOT install. Clone its SKILL.md architecture for our
own skill/backlog process; mine OKLCH theming, sidebar token namespace, command-palette
and row-action patterns as design references.

---

### 3. millionco/react-doctor

**Provenance.** Million — the company behind Million.js. Professional, funded org.
14.6k★ / 467 forks; 1,374 commits; npm package `react-doctor` (MIT); dedicated site
(react.doctor); changesets + CI + GitHub Action (`action.yml`). Fresh, actively developed.

**Inventory.** BOTH a deterministic CLI auditor/linter (`npx react-doctor@latest` →
0–100 health score, severity-ranked findings) AND an installable agent skill
(`npx react-doctor@latest install` → SKILL.md v1.2.0 into Claude Code / Cursor / Codex /
OpenCode). Plus a GitHub Action mode (`ci install` — PR reviews reporting only newly
introduced issues) and a runtime profiler (`scan <url>` records Chrome DevTools traces
with render outlines). Audit categories: state & effects, performance/re-renders,
architecture, security, accessibility, maintainability, bundle size, plus heuristics for
overly complex functions and repeated JSX trees (composition candidates), and a `design`
sub-audit (composition, typography, interaction, a11y, motion). Concrete example rule:
`no-array-index-as-key`. Per-rule fix recipes live at
`react.doctor/prompts/rules/<plugin>/<rule>.md`; the `/doctor` playbook is fetched live
at run time. Config via `doctor.config.ts` / `package.json#reactDoctor`.

**Relevance mapped to VSNote.**
- Key-stability rules → ExplorerTree/VirtualList rows (>200 virtualized; rename/DnD
  needs stable identity). Strongest match.
- Re-render rules → EditorTabBar (N-tab re-render on active change), StatusBar,
  ActivityBar.
- Repeated-JSX / complexity heuristics → our sibling gap-fillers (ContextMenu,
  OverflowMenu, DropdownSubmenu share structure) as composition candidates.
- A11y rules → menu keyboard handling, tree ARIA roles.
- `--scope changed` mode maps neatly onto our small-scoped-commit hygiene.
- Weak/no coverage: zustand selector discipline; CM6 view lifecycle (non-React; only
  incidental catches like missing `EditorView.destroy()` cleanup).

**Concerns.** Remote playbook drift (`/doctor` curls prompts at run time — behavior can
change server-side post-install; prefer the bare CLI). Score-gaming risk. Blind spots:
ref-held CM6 instances, non-React modules, zustand misuse. **Telemetry default-on**
(Sentry: env, rule counts, stack traces — no file contents); use `--no-telemetry` in a
local-first privacy-sensitive repo. Separately: **Million.js itself is inadvisable here**
— `block()` wraps components with its own memoization/renderer, fighting our custom
VirtualList windowing and CM6 widget-managed DOM, and violating the no-wrap-override law.

**Verdict.** Mine-selectively — run `npx react-doctor@latest --verbose --no-telemetry`
once as a read-only audit; lift its rule categories into the review checklist for
tree/tab/status-bar code; skip the skill install (remote-drifting playbook) and any
Million.js runtime.

---

### 4. addyosmani/web-quality-skills *(discovered through index line 7)*

**Provenance.** Addy Osmani — Google Chrome engineering leader; professional and
actively maintained. A 6-skill suite: `accessibility`, `performance`, `core-web-vitals`,
`seo`, `best-practices`, `web-quality-audit`.

**Inventory (verified).** Accessibility skill carries WCAG 2.2 with concrete patterns:
focus-visible 3:1 contrast, icon-button accessible names, visually-hidden utility class,
POUR tables. The audit skill carries a live Lighthouse v13 migration note (Oct-2025
changes) — current, not stale.

**Relevance mapped to VSNote.** Maps straight onto the a11y-hardening surface of our
hand-built gap-fillers (ContextMenu / EditorTabBar / ExplorerTree) and the keyboard-first
UX goals (command palette, tree navigation). Performance/CWV skills complement the
50k-note and PWA-offline pushes. Ignore `seo` (marketing-site oriented).

**Verdict.** Adopt — source the a11y acceptance criteria and perf checklist items from
here (see `docs/TODO.md` §3.x / checklists).

---

## Tier B — community sources

### 5. wshobson/agents — `react-state-management` (index line 1)

**Provenance.** Individual maintainer (personal blog, no company backing); repo is one
of the largest community agent collections (38,983★ / 4,150 forks, MIT, ~100 plugins);
created 2025-07-24, last push 2026-08-18. Stars reflect breadth, not per-skill depth.

**Inventory.** Thin SKILL.md (~120 lines): when-to-use, state-category table
(local/global/server/URL/form), selection criteria ("small app → Zustand/Jotai; large
app, complex state → Redux Toolkit"), quick-start zustand store with `devtools` +
`persist`, Do's (colocate state, use selectors, normalize data, type everything) and
Don'ts (don't over-globalize, don't duplicate server state, don't mutate directly,
**don't store derived data — compute it**, don't mix paradigms). Real payload in
`references/details.md`: five patterns — RTK with TS; **Zustand slices**
(`StateCreator<Combined, [], [], Slice>` cross-slice composition + exported selector
hooks for selective subscriptions); Jotai atoms; TanStack Query server state incl. full
optimistic-update recipe; combining client+server stores.

**Relevance.** Pattern 2's slice-composition typing is directly usable if `useTabsStore`
(the recursive PaneNode tree) grows past one slice. Selector-hook convention fits the
virtualized tree: per-row micro-selectors (`useTreeNode(nodeId)`) instead of whole-tree
subscriptions — matters at 50k notes. The Do/Don't list works as a cheap review checklist:
"colocate" validates our 4-store split; "don't store derived data" says flatten
PaneNode→visible-rows inside a memoized selector, never cache it in the store;
`persist` middleware is relevant to `useSettingsStore`.

**Contradictions/concerns.** Entire framing is library *choice*; its own criteria route
"large app, complex state" to Redux Toolkit — direct conflict with our zustand-only law.
~75% of the payload (RTK/Jotai/TanStack Query) is deliberately out of stack. Missing
exactly what we need: recursive-tree normalization (flat map + parent pointers vs
immutable nested rebuild — the actual PaneNode question), `subscribeWithSelector`, the
zustand v5 `Object.is` default-equality footgun (selectors returning fresh objects/arrays
→ infinite re-render loops — the #1 v5 trap our row selectors will hit), and transient
updates via `subscribe` outside React for drag-resize in PaneGroup/ResizeHandle.
Genericness high; tutorial altitude throughout.

**Verdict.** Mine-selectively — steal Pattern 2's slice typing and the Do/Don'ts as a
store review checklist; ignore the rest.

### 6. kursku/skills — `frontend/` (index line 6)

**Provenance.** Individual PT-BR aggregator/redistribution repo ("+2.300 skills", 30
categories); mixed-language (PT-BR indexes, EN bodies); several skills are re-hosted
upstreams (its `composition-patterns` frontmatter literally says `author: vercel`;
`brand-guidelines` is Anthropic's own brand skill). Drift-from-upstream risk is real;
attribution preserved in frontmatter where present.

**Inventory.** 26 entries under `frontend/`. Fetched in depth:
- `fixing-accessibility` — nine priority-ranked categories: accessible names (icon-only
  buttons need `aria-label`; decorative icons `aria-hidden`); keyboard access (no
  div/span buttons; no positive tabindex; Escape closes overlays; visible focus); focus
  & dialogs (trap, restore-to-trigger, initial focus inside, no unexpected scroll);
  semantics (native elements before ARIA; no skipped heading levels); forms & errors
  (`aria-describedby`, `aria-invalid`, disabled submit must explain why); announcements
  (`aria-live`, `aria-busy`, `aria-expanded`/`aria-controls`); contrast & states; media &
  motion (`prefers-reduced-motion`); **tool boundaries** — minimal changes, don't
  refactor unrelated code, don't add ARIA where native semantics suffice, don't migrate
  UI libraries unless asked. Ends with before/after fix snippets.
- `composition-patterns` — the Vercel skill re-hosted (see Tier A #1); router to
  `rules/*.md` not included in this repo.
- `optimize` — measure (CWV, bundle, runtime, network) → systematic fixes: loading
  (dynamic imports, CSS containment, `font-display: swap`, service worker for offline),
  rendering (**batch reads then writes** anti-layout-thrashing; `contain`;
  `content-visibility: auto`; virtual scrolling), animation (rAF,
  IntersectionObserver), React-specific (memo, avoid inline functions), a NEVER list
  ("measure before optimizing", "don't sacrifice accessibility"), verify on low-end
  Android / 3G throttle.
- `baseline-ui` — opinionated baseline against AI-generated UI slop: accessible
  primitives first ("MUST use the project's existing component primitives first",
  "NEVER mix primitive systems", "NEVER rebuild keyboard or focus behavior by hand");
  AlertDialog for destructive actions; skeletons; `h-dvh` not `h-screen`; never block
  paste; animation none-unless-requested, compositor props only, ≤200ms feedback,
  ease-out entrances, reduced-motion; typography `text-balance`/`text-pretty`,
  `tabular-nums`, truncate/line-clamp; fixed z-index scale; one accent color per view;
  empty states get one clear next action.
- Rest: taste cluster (`bolder`/`colorize`/`delight`/`distill`/`polish`/`quieter`/
  `critique`/`audit`/`onboard`/`animate`/`adapt`/`harden`/`normalize`/`extract`),
  `brand-guidelines` (Anthropic palette!), react-native/remotion/game/meta — off-platform
  or in conflict with DESIGN-SPEC authority.

**Relevance.** `fixing-accessibility` is the gem: framework-agnostic HTML/ARIA that maps
1:1 onto our a11y-hardening need across ContextMenu/DropdownSubmenu/OverflowMenu
(keyboard reachability, `aria-expanded`/`aria-controls`), EditorTabBar/ActivityBar (tab
semantics, focus visibility), ExplorerTree rename/DnD (keyboard equivalents), and the
three dialogs (trap/restore, `aria-describedby` errors). Its tool-boundaries section
independently codifies our own law — rare alignment. `optimize` yields a useful subset
for the 50k/PWA push (validates VirtualList; `content-visibility`/`contain` for split
panes; read/write batching relevant to ResizeHandle drag loops; lazy-load candidates).
`baseline-ui` works as a review checklist ONLY with its Stack section struck (it mandates
Base UI and motion/react — different stack than my-you-eye + Radix + DESIGN-SPEC).

**Concerns.** Redistribution drift; staleness markers in `optimize` (lists retired FID;
recommends react-window/react-virtualized rather than current defaults); taste cluster
would fight DESIGN-SPEC-as-sole-authority; language mix signals aggregation-first nature.

**Verdict.** Mine-selectively — vendor the single `fixing-accessibility` SKILL.md as the
a11y-hardening companion; cherry-pick ~a dozen lines from `optimize`; strike the Stack
section from `baseline-ui` before any use; skip everything else. *(Post-compression
amendment: three entries initially lumped into the skip are partially usable with
DESIGN-SPEC authority intact — `harden`'s resiliency checklist, `onboard`'s
empty-state doctrine for VaultSetupPanel, and `fixing-metadata` repurposed as OG-meta
for v2 share pages. Itemized in `docs/TODO.md` §§5.4/5.6/5.7.)*

### 7. finfin/awesome-frontend-skills (index line 7)

**Provenance.** Individual curator; 183★ / 24 forks / 10 commits; bilingual EN + 繁體中文.
Flat awesome-list; admission bar is just "repo has a SKILL.md"; installs standardized on
Vercel's `npx skills add`. "Official" badges reliably mark vendor primaries (vercel-labs,
shadcn, anthropics, sveltejs, remix-run, prisma, auth0, clerk, expo, microsoft…).
Entries reference current tech (Tailwind v4, TS 5.9, Lighthouse v13) — recency good.

**Inventory.** 13 categories; roughly half is Angular/Vue/Nuxt/RN/Next/Remix — off-stack
noise. Verified highlights beyond entries already covered above:
- `vercel-react-best-practices` — duplicate pointer to Tier A #1 (README says 62 rules;
  upstream ships 70 — list drifts stale vs source).
- `addyosmani/web-quality-skills` — Tier A #4.
- `tailwind-design-system` (wshobson's, distinct from sickn33's!) — the **v4-correct**
  version: `@theme` tokens, OKLCH semantic colors, `@custom-variant dark`,
  keyframes-in-`@theme`, `@starting-style`. Fits our token-level-restyling law; token
  names are shadcn-flavored and need remapping to my-you-eye's contract.
- `mblode/ui-animation` — transform/opacity-only + `prefers-reduced-motion`; matches
  DESIGN-SPEC motion rules.
- `anthropics/webapp-testing` — Python Playwright; our stack is Vitest — marginal.
- Duplicates noted: `ui-ux-pro-max` ×2 under different repos, Remotion ×4, Playwright
  entries ×5+, some rows aren't SKILL.md-native (prompt packs, a literal `cp -r` line),
  prompt-dump flavor entries inflate Design.

**Coverage gaps vs our needs.** Zero entries for drag-and-drop, virtualization,
CodeMirror/markdown editor tooling, PWA/offline/service-workers, command palette /
keyboard UX, or Radix-class headless libraries — our most distinctive surfaces are
entirely uncovered by this ecosystem.

**Verdict.** Use as an index to vendor-primary skills (that's how Tier A #4 and
wshobson's correct v4 skill were found); nothing here is authoritative in itself.

### 8. sickn33/agentic-awesome-skills — `tailwind-design-system` (index line 5)

**Provenance.** Individual account; repo claims 45.2k★ but is a bulk-ingested catalog
("2,005+ agentic skills"; this skill's frontmatter says `source: community`,
`date_added: 2026-02-27`). Repo popularity ≠ this file's quality.

**Inventory.** SKILL.md is template filler (generic Instructions bullets) deferring to
`resources/implementation-playbook.md`: token hierarchy (Brand→Semantic→Component),
component architecture (Base→Variants→Sizes→States→Overrides), CVA pattern, compound
components, form pattern, responsive grid, animation utilities, dark-mode implementation,
cn/twMerge utilities, Do/Don'ts.

**Why SKIP.** This is **Tailwind v3**, not v4: `tailwind.config.ts` JS config,
`@tailwind base/components/utilities` directives (removed in v4), `darkMode: 'class'`
config key (v4: `@custom-variant dark`), HSL channel-triplet variables instead of OKLCH
in `@theme`, `tailwindcss-animate` plugin. Zero mentions of `@theme`, `@custom-variant`,
`@utility`, `@starting-style`, container queries, or CSS-first config — adopting it
would actively break our v4 setup. Worse, Patterns 1–3 instruct hand-rolling
Button/Card/Input via CVA — direct violation of repo law #1. The single transferable
idea (three-tier token hierarchy for the accent picker) is generic design-system
knowledge available from better sources (Tier A #2's `customization.md` does it
correctly in OKLCH/v4).

**Verdict.** Skip.

---

## Cross-cutting findings

1. **The ecosystem is blind on our hardest surfaces.** Across all seven sources: nothing
   substantive on drag-and-drop mechanics, virtualization internals, CodeMirror/markdown
   editor tooling, sync-conflict UX, or PWA/offline patterns. Our distinctive components
   (ExplorerTree DnD, FindWidget, ConflictResolver, PaneGroup) have no external skill
   coverage — they remain judgment calls documented in our own backlog.
2. **Two skills contradict repo law by design** (shadcn's copy-the-source model;
   sickn33's hand-rolled-CVA patterns) and are quarantined to "design reference only".
3. **One stack-wide footgun no source covers:** zustand v5's `Object.is` selector
   equality. Recorded as an explicit checklist item in the backlog since our row-level
   selectors will hit it first.
4. **Best meta-takeaway:** shadcn's SKILL.md architecture (context injection,
   Incorrect/Correct rule pairs, need→component table, consent gates) is the model our
   own `my-you-eye` skill should evolve toward — see backlog item "SKILL.md upgrade".

---

## Annex — compression backfill

The first synthesis pass compressed the seven source reports; every detail that
survived triage is now itemized as `docs/TODO.md` (§§5.1–5.10, same numbering)
so the written record matches what the reports actually contain:

- **5.1 Tailwind v4 modernization** ← wshobson `tailwind-design-system` (v4-correct
  variant: `@theme`, OKLCH, `@custom-variant dark`, keyframes-in-`@theme`,
  `@starting-style`) + shadcn `customization.md`.
- **5.2 Motion discipline** ← kursku `baseline-ui` (struck-Stack subset) +
  mblode `ui-animation`.
- **5.3 Micro-copy & numeric typography** ← WIG Content&Copy/Typography (nbsp in
  shortcuts, real ellipsis char, `tabular-nums` generalized beyond DiffStatChip).
- **5.4 Resiliency** ← kursku `harden` (per-pane error boundaries, offline states,
  overflow audit).
- **5.5 PWA viewport & caching** ← kursku `optimize` (`h-dvh`, safe-area insets,
  service-worker strategy).
- **5.6 Onboarding** ← kursku `onboard` (VaultSetupPanel one-action framing).
- **5.7 Share-page OG metadata** ← kursku `fixing-metadata` repurposed for v2 `/share/`
  unfurling.
- **5.8 State tooling** ← wshobson Pattern 2 (`devtools`+`persist` middleware,
  transient `subscribe()` for drag-resize).
- **5.9 CI guardrail** ← react-doctor GitHub Action diff mode, run against *this* repo.
- **5.10 Evaluated-and-still-skipped ledger** ← i18n group, hydration rules, chat
  primitives, registry/MCP machinery, runtime profiler, taste cluster, brand pack,
  off-platform skills.

Also promoted into existing sections: hover/focus-visible parity into §3.4's global
bullets. Nothing else from the reports remains unrecorded; future index.md additions
should re-run the same per-source sweep and extend Part 5 rather than opening a new
document.

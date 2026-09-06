# Skills pack — provenance & trust record

> **What this document is and isn't.** A synthesis + pointer layer over the
> frontend agent-skill ecosystem: provenance, inventories, relevance mappings,
> and verdicts for every vendored source. It is NOT a full mirror — per-rule
> detail bodies live in the vendored copies under `skills/vendor/<id>/`; fetch
> context lives in `skills/vendor.config.json` / `vendor.lock.json`. The
> routing layer ("which skill for which task") is `skills-index.md`.

Every source was fetched and read in full at analysis time, then judged
against a representative consumer: a React + TypeScript + Tailwind v4 +
Radix-based SPA building component-library-driven UI. The judgments below are
stack-relative where they must be — re-verify against your own repo law when
your stack differs.

**Ranking principle:** sources maintained by professional parties are
prioritized as more reliable. Tier A is the professional top 4; Tier B is
community.

| Rank | Source | Maintainer | Trust | Verdict |
|---|---|---|---|---|
| 1 | vercel-labs/agent-skills | Vercel (official labs org) | Tier 1 vendor | mine-selectively |
| 2 | shadcn-ui/ui skills/shadcn | shadcn team at Vercel | Tier 1 vendor | mine-selectively, do NOT install |
| 3 | millionco/react-doctor | Million (Million.js company) | Tier 1 vendor | run once as audit; skip skill install |
| 4 | addyosmani/web-quality-skills | Addy Osmani (Google Chrome eng lead) | Professional | adopt a11y/perf checklists |
| 5 | wshobson/agents react-state-management | Individual (38.9k★ repo) | Community | mine-selectively |
| 6 | kursku/skills frontend | Individual aggregator (re-hosts) | Community | mine-selectively |
| 7 | mblode/agent-skills · design/copy cluster | Individuals | Community | adopt subsets |
| 8 | sickn33 …tailwind-design-system | Individual bulk-ingest catalog | Community boilerplate | SKIP |

---

## Tier A — professional-party sources

### 1. vercel-labs/agent-skills

**Provenance.** Vercel's official labs org ("official collection of agent
skills"); MIT; agentskills.io format. Each skill = `SKILL.md` rule index +
`rules/*.md` (one file per rule with wrong/right code). Highest applicable
rule payload of anything examined.

**Inventory.**
- `react-best-practices` — ~70 rules / 8 priority categories. Client-side
  slices: `rerender-*` (derived state, defer reads, memo discipline,
  functional setState, lazy init, split hooks, effect-to-event, transitions,
  deferred values, refs for transient values, no inline components),
  `rendering-*`, `js-*` (index maps, Set lookups, batch DOM CSS, caching,
  early exit, hoisted regexp), `bundle-*` (barrel imports, analyzable paths,
  dynamic imports, defer third-party), `client-*` (event listeners,
  localStorage schema). `server-*` + most RSC waterfalls quarantine cleanly
  by prefix.
- `composition-patterns` — 7 rules: avoid boolean-prop sprawl, compound
  components, decouple state from implementation, context interface,
  lift-state, explicit variants, children over render props.
- `web-design-guidelines` — thin wrapper fetching 100+ interaction/a11y/UX
  rules from `vercel-labs/web-interface-guidelines/command.md` (vendored
  separately — pin that repo directly).

**Where it pays off.** Row-level selector granularity for virtualized lists;
reading store state via `getState()` inside callbacks instead of
subscribing whole components; memoized row renderers with default-value
props; auditing barrel-file imports of a big component library (prefer
per-component paths); versioning persisted-settings schemas BEFORE sync
features land; Map/Set lookups in hot paths; deferring non-urgent work off
the interaction path. `composition-patterns` is API-shape doctrine for any
locally-built gap-filler so future promotion into a shared library stays
trivial.

**Concerns.** Server-bias bounded (~15–20% of the flagship skill,
prefix-quarantined); framework drift to translate (`next/dynamic` →
`React.lazy` etc.); the guidelines wrapper fetches its rules from a second
repo at runtime (unpinned relative to any snapshot — hence direct
vendoring).

**Verdict.** Mine-selectively — treat the client-side slices as standing
review checklists for hot paths and new component APIs.

### 2. shadcn-ui/ui — official agent skill (`skills/shadcn/`)

**Provenance.** First-party doctrine of the shadcn team at Vercel, inside
the `shadcn-ui/ui` monorepo, synced to every CLI release; MIT.

**Inventory.** `SKILL.md` + six domain rule files (`forms`, `composition`,
`icons`, `styling`, `base-vs-radix`, plus chat) + `customization.md` +
registry/CLI machinery. Rules are written as Incorrect/Correct code pairs.
Four principles: existing-components-first; compose-don't-reinvent; built-in
variants before custom styles; semantic colors only, never raw values.
`customization.md`: CSS-vars→utilities→components pipeline, strict
`name`/`name-foreground` token convention, OKLCH everywhere, Tailwind v4 via
`@theme inline`, radius derivation chain, customization ladder (variants →
className layout → edit source → wrapper), "adding a color = edit the global
CSS file".

**Where it pays off.** Its SKILL.md *architecture* is the highest-value
zero-risk take: project-context injection, Incorrect/Correct rule pairs,
need→component tables, consent-gated workflows — a model for any team's own
skill docs. The theming module is a ready-made spec skeleton for token work
(semantic pairs registered in `@theme inline`, single global CSS file,
radius derivation). Dialog/forms hard requirements (`sr-only` title
fallbacks, `aria-invalid`+`data-invalid` pairing, fieldset grouping) are
acceptance-criteria material for any dialog or form audit.

**Concerns.** Fundamental model conflict: shadcn's mechanic is *copy
component source into your project and own/edit it* — the inverse of an
npm-library-first, no-fork law. Its ladder step "new variant via editing
source" is exactly what library consumers must not do. Wrong-stack
assumptions throughout (React 19/RSC, their token names — adopting those
would fragment a theme).

**Verdict.** Mine-selectively — do NOT install. Clone its SKILL.md
architecture for your own process; mine OKLCH theming and form/a11y doctrine
as design references.

### 3. millionco/react-doctor

**Provenance.** Million (the Million.js company); funded org; npm package
`react-doctor` (MIT); changesets + CI + GitHub Action; actively developed.

**Inventory.** Both a deterministic CLI auditor (`npx react-doctor@latest`
→ 0–100 health score, severity-ranked findings) and an installable agent
skill. Audit categories: state & effects, performance/re-renders,
architecture, security, accessibility, maintainability, bundle size, plus
heuristics for overly complex functions and repeated JSX trees (composition
candidates). Per-rule fix recipes are remote by design (react.doctor/prompts)
— fetched live at run time.

**Where it pays off.** Key-stability rules for virtualized rows;
re-render rules for tab bars/status strips; repeated-JSX heuristics to spot
sibling components begging for composition; a11y rules for menu keyboard
handling and tree ARIA roles; `--scope changed` mode maps onto small-scoped-
commit hygiene.

**Concerns.** Remote playbook drift (behavior can change server-side
post-install — prefer the bare CLI); score-gaming risk; blind spots:
ref-held imperative instances (e.g. CodeMirror views), non-React modules,
state-library misuse specifics. **Telemetry defaults ON** — use
`--no-telemetry`. Separately: Million.js's `block()` wrapper fights custom
virtualization and widget-managed DOM — never adopt the runtime alongside a
component library.

**Verdict.** Mine-selectively — run once as a read-only audit
(`--verbose --no-telemetry`); lift rule categories into review checklists;
skip the skill install and the runtime.

### 4. addyosmani/web-quality-skills

**Provenance.** Addy Osmani — Google Chrome engineering leader;
professional, actively maintained. Six skills: `accessibility`,
`performance`, `core-web-vitals`, `seo`, `best-practices`,
`web-quality-audit`.

**Inventory (verified).** Accessibility carries WCAG 2.2 with concrete
patterns (focus-visible 3:1 contrast, icon-button accessible names,
visually-hidden utility, POUR tables). The audit skill tracks current
Lighthouse versions — current, not stale.

**Where it pays off.** A11y-hardening acceptance criteria for hand-built
interactive components; performance checklists complement large-list and
offline/PWA pushes.

**Concerns.** `seo` is marketing-site oriented — ignore for app work.

**Verdict.** Adopt — source a11y acceptance criteria and perf checklist
items from here.

---

## Tier B — community sources

### 5. wshobson/agents — react-state-management

**Provenance.** Individual maintainer; one of the largest community agent
collections (~100 plugins); stars reflect breadth, not per-skill depth.

**Inventory.** Thin SKILL.md (state-category table, selection criteria,
zustand quick-start, Do's/Don'ts). Real payload in `references/details.md`:
five patterns — RTK with TS; **Zustand slices** (`StateCreator<Combined, [], [], Slice>` cross-slice composition + exported selector hooks);
Jotai atoms; TanStack Query server state incl. optimistic-update recipe;
combining stores.

**Where it pays off.** Slice-composition typing when a store grows past one
slice; per-row micro-selectors instead of whole-tree subscriptions for
virtualized UIs; the Do/Don't list as a cheap store review checklist
("colocate", "don't store derived data — compute it").

**Concerns.** Entire framing is library *choice*; routes "large app" to Redux
Toolkit — override with whatever store law your repo has; ~75% of payload
deliberately out of stack; missing exactly the hard parts (recursive-tree
normalization, `subscribeWithSelector`, zustand v5 `Object.is` equality
footgun, transient updates outside React).

**Verdict.** Mine-selectively — steal Pattern 2's slice typing and the
Do/Don'ts as a store review checklist; ignore the rest.

### 6. kursku/skills — frontend/

**Provenance.** Individual PT-BR aggregator/redistribution ("+2300
skills"); several entries are re-hosted upstreams; drift-from-upstream risk
is real; attribution preserved where present.

**Inventory (fetched in depth).**
- `fixing-accessibility` — nine priority-ranked categories: accessible
  names; keyboard access (no div/span buttons, no positive tabindex, Escape
  closes overlays); focus & dialogs (trap, restore-to-trigger, initial focus
  inside); semantics (native elements before ARIA); forms & errors
  (`aria-describedby`, disabled submit must explain why); announcements
  (`aria-live`, `aria-expanded`/`aria-controls`); contrast & states; media &
  motion (`prefers-reduced-motion`); **tool boundaries** — minimal changes,
  no unrelated refactors, no ARIA where native semantics suffice, don't
  migrate UI libraries unless asked. Ends with before/after snippets.
- `optimize` — measure → systematic fixes: loading (dynamic imports,
  containment, `font-display: swap`, service worker), rendering (**batch
  reads then writes** anti-layout-thrashing; `contain`;
  `content-visibility: auto`; virtual scrolling), animation (rAF,
  IntersectionObserver), React-specific memo advice, NEVER list ("measure
  before optimizing").
- `baseline-ui` — opinionated baseline against AI-generated UI slop:
  existing primitives first; never rebuild keyboard/focus behavior by hand;
  confirmation for destructive actions; skeletons; compositor-only motion ≤200ms;
  typography (`text-balance`/`text-pretty`, `tabular-nums`, truncate);
  fixed z-index scale; one accent per view; empty states get one clear next action.
- Rest: taste cluster (`bolder`/`delight`/`polish`/…), brand packs,
  off-platform skills.

**Where it pays off.** `fixing-accessibility` is the gem: framework-agnostic
HTML/ARIA mapping onto menus/popovers (keyboard reachability,
`aria-expanded`/`aria-controls`), tab strips (semantics, focus visibility),
tree DnD (keyboard equivalents), dialogs (trap/restore, error
descriptions). Its tool-boundaries section independently codifies
library-first law — rare alignment. `baseline-ui` works as a review
checklist ONLY with its Stack section struck.

**Concerns.** Redistribution drift; staleness markers in `optimize` (retired
FID metric; react-window-era virtualization advice); taste clusters fight
design-spec-as-authority.

**Verdict.** Mine-selectively — vendor `fixing-accessibility` as the a11y
companion; cherry-pick `optimize`; strike baseline-ui's Stack section before
any use.

### 7. Indexes and the rest

- **finfin/awesome-frontend-skills** — bilingual awesome-list; admission bar
  is just "has a SKILL.md". Use as an index to find vendor primaries
  (that's how two Tier A/B finds surfaced here); nothing authoritative in
  itself. Coverage gaps it exposes: drag-and-drop mechanics,
  virtualization internals, editor tooling (CodeMirror/markdown),
  PWA/offline, command-palette/keyboard UX, headless libraries — the
  hardest frontend surfaces have no external skill coverage anywhere.
- **mblode/agent-skills** — `ui-animation/` (transform/opacity-only +
  `prefers-reduced-motion`) and `typography-audit/` both match standard
  motion/typography discipline; adopt.
- **Design-process & copy cluster** (julianoczkowski/designer-skills,
  rampstackco/claude-skills, content-designer/ux-writing-skill,
  anthropics ux-copy, jakubkrehel better-writing, blader humanizer) — see
  `skills-index.md` for per-skill use-when. Quality varies; the
  design-review checklist, ARIA-contract guidance, and error-message
  patterns earn their keep.
- **bergside/awesome-design-skills** — style presets only; vocabulary,
  never routing.
- **sickn33/agentic-awesome-skills tailwind-design-system** — SKIP. Repo
  popularity ≠ file quality: bulk-ingested catalog entry whose SKILL.md is
  template filler over a **Tailwind v3** playbook (`tailwind.config.ts`,
  removed directives, HSL triplets, `tailwindcss-animate`). Zero mentions of
  `@theme`/`@custom-variant`/OKLCH. Worse, its patterns instruct
  hand-rolling Button/Card/Input via CVA — a direct violation of
  component-library law. The one transferable idea (Brand→Semantic→Component
  token hierarchy) is available from better sources (Tier A #2 does it
  correctly in OKLCH/v4).

---

## Cross-cutting findings

1. **The ecosystem is blind on the hardest surfaces.** Across all sources:
   nothing substantive on drag-and-drop mechanics, virtualization
   internals, code-editor tooling, sync-conflict UX, or PWA/offline
   patterns. Those remain judgment calls documented in your own backlog.
2. **Two source families contradict library-first law by design** (shadcn's
   copy-the-source model; sickn33's hand-rolled-CVA patterns) — quarantined
   to "design reference only".
3. **State-library version footguns are uncovered** (e.g. zustand v5's
   `Object.is` selector equality → fresh-object selectors loop forever).
   Record these as explicit checklist items yourself.
4. **Best meta-takeaway:** shadcn's SKILL.md architecture (context
   injection, Incorrect/Correct pairs, need→component table, consent gates)
   is the model your own skill documents should evolve toward.

Sources drift — upstream repos gain/lose rules within months. Re-run the
per-source sweep whenever a source is added or floated to HEAD
(`skills:update --latest`), and treat the lock diff as the review artifact.

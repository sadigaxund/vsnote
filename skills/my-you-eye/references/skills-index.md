# Skills pack — distilled router for vendored frontend agent skills

The operational entry point for a curated set of third-party agent skills
(React performance, component API design, accessibility, motion, UX copy,
design process). `skills-analysis.md` is the provenance/trust record — who
maintains each source, what is in it, and its verdict; **this file** says
what each source is for, which subskill to open for which task, and what to
do when sources disagree.

These references INFORM. They never override the layers below them in the
precedence chain, and they never override the my-you-eye rules in SKILL.md
(use the library's components; customize by token, never by fork).

## Precedence chain (read first)

Consumer repo law (`AGENTS.md`/`CLAUDE.md`) → that repo's design spec /
visual authority → my-you-eye `SKILL.md` (component protocol) → **these
references**. Where two references disagree, the Conflicts register below
holds the standing resolution — deviate only with a written reason next to
the change.

## How the local copies work

Skill bodies are vendored into `skills/vendor/` (**gitignored**) at pinned
commits; the pins live in `skills/vendor.lock.json` (committed). The source
list lives in `skills/vendor.config.json` (committed, project-agnostic).
Fresh clone or stale refs? Run:

```bash
npx my-you-eye skills:init            # scaffold config + empty lock (skip if present)
npx my-you-eye skills:update          # restore exactly the pinned state
npx my-you-eye skills:update --latest # consciously float every source to HEAD (lock diff = reviewable)
npx my-you-eye skills:update --source <id> [--latest]
```

If a path below is missing, run the update first. To add or drop a source,
edit `vendor.config.json`, run the update, and add/remove this file's row in
the same commit — the config and the router must never drift apart.

## Sources

### vercel-labs/agent-skills — Tier 1 (Vercel official) · `vercel-labs/agent-skills/`

| Subskill | Path | Use when |
|---|---|---|
| react-best-practices | `skills/react-best-practices/SKILL.md` + `rules/*.md` | ANY React perf/correctness work. Client-applicable slices: `rerender-*`, `rendering-*`, `js-*`, `bundle-*`, `client-*`. Ignore `server-*` (RSC-only). Open the specific rule body before implementing — they carry wrong/right pairs |
| composition-patterns | `skills/composition-patterns/` | Designing/changing a component's API — boolean-prop sprawl, compound parts, context interface, explicit variants |

### vercel-labs/web-interface-guidelines — Tier 1 · `vercel-labs/web-interface-guidelines/command.md`

One dense rulebook (a11y, focus, forms, animation, typography, content,
touch, dark mode, anti-patterns). Consult for ANY user-facing interaction
change — it is the fastest way to turn "it works" into "it behaves".

### shadcn-ui/ui skills/shadcn — Tier 1 (official doctrine) · `shadcn-ui/ui/skills/shadcn/`

Never install (copy-the-source model violates library-first law) — mine as
design reference.

| File | Use when |
|---|---|
| `customization.md` | Theming/tokens work (OKLCH pairs, `@theme inline`, radius derivation) |
| `rules/base-vs-radix.md` | Deciding primitive strategy — directly relevant: my-you-eye builds ON Radix |
| `rules/forms.md`, `rules/styling.md`, `rules/icons.md`, `rules/composition.md` | Forms/errors, className discipline, icon conventions, compound structure |
| `registry.md`, `cli.md`, `mcp.md` | Skip (distribution machinery we don't use) |

### millionco/react-doctor — Tier 1 (Million) · `millionco/react-doctor/.agents/skills/react-doctor/`

CLI auditor (`npx react-doctor@latest --no-telemetry`). Local SKILL.md
documents rule categories; per-rule fix recipes are REMOTE by design
(react.doctor/prompts) — fetch only during remediation of a specific
finding. Never adopt a render-wrapper runtime alongside my-you-eye.

### wshobson/agents (community, large) · `wshobson/agents/plugins/frontend-mobile-development/skills/`

| Subskill | Use when |
|---|---|
| `react-state-management/` | Store design reviews — slice-composition typing + Do/Don'ts. OVERRIDDEN wherever it routes "large app" to Redux (keep whatever store law your repo has) |
| `tailwind-design-system/` | Tailwind v4 CSS-first work (`@theme`, OKLCH, `@custom-variant dark`, keyframes-in-theme, `@starting-style`) — this is the CORRECT v4 one; do not confuse with v3 relics (not vendored) |

### kursku/skills frontend (community re-hosts) · `kursku/skills/frontend/`

High-value subset:

| Subskill | Use when |
|---|---|
| `fixing-accessibility/` | 9-priority a11y checklist + tool-boundary rules |
| `optimize/` | Perf workflow — mind its stale bits (retired FID metric, react-window advice) |
| `baseline-ui/` | Anti-slop checklist — STRIKE its Stack section (Base UI/motion/react mandates conflict with any other stack); keep interaction/motion/typography rules |

The rest of its taste cluster (`bolder`, `colorize`, `delight`, …) defers to
the consuming project's design authority — consult only when that authority
is silent, and say so when you do.

### mblode/agent-skills (community) · `mblode/agent-skills/skills/`

`ui-animation/` (compositor-only motion, reduced-motion),
`typography-audit/`. Note typography-audit's scope gotcha: punctuation rules
apply to RENDERED copy, not string literals.

### addyosmani/web-quality-skills — professional (Google Chrome eng lead) · `addyosmani/web-quality-skills/skills/`

Six-skill suite: `accessibility/` (WCAG 2.2 patterns — pairs with the
interface-guidelines rulebook), `performance/`, `core-web-vitals/`,
`best-practices/`, `web-quality-audit/`, `seo/` (skip — marketing-site
oriented).

### Design-process and copy sources (community)

| Source | Path | Use when |
|---|---|---|
| julianoczkowski/designer-skills | `julianoczkowski/designer-skills/<skill>/` (8 skills) | Design process: `design-review` (standing visual-audit checklist), `grill-me` (pre-amendment interrogation), `design-tokens` (incl. motion tokens), `information-architecture` (naming glossary), `design-brief`, `brief-to-tasks`, `design-flow`, `frontend-design` |
| bergside/awesome-design-skills | `bergside/awesome-design-skills/skills/<style>/` | Vocabulary only — pure style-preset library; every preset overrides a design spec's language. Never route to it by default |
| rampstackco/claude-skills | `rampstackco/claude-skills/skills/<name>/` | UI-relevant subset: `accessibility-audit` (zoom/reflow/live-region passes), `frontend-component-build` (per-component ARIA contract for new local components), `design-system` (token evolution), `information-architecture` (nav restructuring), `usability-testing` / `qa-testing` (flow validation gates), `performance-optimization`, `security-baseline`, `onboarding-wizard-design` (first-run), `internationalization` (if strings get extracted). SKIP: art-direction, calculator/comparison-tool design, all SEO/ads/brand/funnel skills |
| content-designer/ux-writing-skill | `content-designer/ux-writing-skill/` | Richest UI-copy source: error/success message patterns + length benchmarks |
| anthropics/knowledge-work-plugins | `anthropics/knowledge-work-plugins/design/skills/ux-copy/SKILL.md` | Consequence-labeled confirm-button pairs (`Delete files`/`Keep files`) |
| jakubkrehel/skills | `jakubkrehel/skills/skills/better-writing/` | Checkable copy standards: capitalization policy, wizard vocabulary, toggle phrasing |
| blader/humanizer | `blader/humanizer/SKILL.md` | De-AI-ing written text |

## Task-routing matrix

| You are touching… | Consult (in order) |
|---|---|
| Virtualized lists / tree rows / tab strips | vercel rerender+js slices → react-state-management selector-hook conventions → fixing-accessibility keyboard section |
| Any dialog / form / settings field | shadcn `forms.md` + customization error contract → web-interface-guidelines forms group → fixing-accessibility §5–6 |
| New local component's API shape | composition-patterns (all 7 bodies) → base-vs-radix.md → existing local component conventions |
| Menus / popovers / overlays | web-interface-guidelines focus+overlay groups → fixing-accessibility §3 → Radix primitives (behavior comes free — don't rebuild) |
| Theming / tokens / accent colors | shadcn `customization.md` → tailwind-design-system → the consuming project's token blocks |
| Perf work (large lists, bundles) | react-best-practices rerender/js/bundle slices → addyosmani `performance/` → kursku `optimize/` → react-doctor scan |
| PWA / offline / storage | addyosmani `best-practices/` + `core-web-vitals/` → optimize service-worker section |
| Motion / animation | mblode ui-animation → baseline-ui animation section (Stack struck) → the project's motion rules |
| UX copy / labels / empty states | ux-writing-skill → anthropic ux-copy → better-writing rules → the project's standing copy rules |
| Visual review of a finished feature | julianoczkowski design-review checklist → web-interface-guidelines anti-pattern list → the project's design spec |
| Zoom/reflow/screen-reader verification | rampstack accessibility-audit stages → addyosmani accessibility skill |
| Pre-PR review | the project's own checklists first; then react-doctor categories as a sweep |

## Conflicts & overlaps register

| Clash | Standing resolution | Re-judge when |
|---|---|---|
| baseline-ui mandates Base UI/motion/react vs a different stack law | Strike its Stack section; keep interaction/motion/typography rules | The stack adopts Base UI primitives upstream |
| shadcn copy-source ownership vs npm-library-first law | Never install; doctrine/reference only | The consumer abandons library-first (unlikely) |
| WIG "deep-link all stateful UI" vs apps without routers | Apply only where real shareable routes exist | A router lands |
| kursku optimize: react-window/react-virtualized vs a local virtualization solution | Keep the local one; treat external virtualizers as escape hatch | Variable-height rows arrive and hurt |
| wshobson "large app → Redux Toolkit" vs the project's store choice | The project's store stays; steal his slice typing + selector-hook conventions | — |
| vercel RSC/server slices vs SPA reality | Quarantined by `server-*` prefix — skip wholesale | The app gains SSR |
| React-19 tiers (composition-patterns, shadcn) vs pinned React 18 | Self-gating sections — skip | Dependency bump decision |
| Multiple a11y sources overlap (WIG ≈ fixing-accessibility ≈ addyosmani accessibility) | fixing-accessibility = structure/priority order; WIG = exhaustive detail; addyosmani = WCAG 2.2 citations. All three may apply; cite what you implement | A source contradicts WCAG 2.2 |

## Maintenance

- Refresh: `npx my-you-eye skills:update --latest` → inspect lock diff →
  commit. Pins make drift a visible decision, never ambient.
- Adding a source: append to `vendor.config.json` (+ row here) → run the
  updater.
- This file changes whenever a source gains/loses relevance to the routing
  matrix — same commit as the config change.

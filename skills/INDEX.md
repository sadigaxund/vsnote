# Skills INDEX — distilled router

The operational entry point for agent skills. (The original raw URL registries
were retired once every source became vendored + pinned here.) `ANALYSIS.md` is
the provenance/trust record; **this file** says what each source is for, which
subskill to open for which task, and what to do when sources disagree.

## Precedence chain (read first)

`CLAUDE.md` repo law → `docs/DESIGN-SPEC.md` (visual authority) → `my-you-eye`
SKILL.md (component protocol) → **these references**. References INFORM; they never
override the layers above. Where two references disagree, the Conflicts register
below holds our standing resolution — deviate only with a written reason next to
the change.

## How the local copies work

Skill bodies are vendored into `skills/references/` (**gitignored**) at pinned
commits by `scripts/update-skill-references.mjs`; the pins live in
`skills/references.lock.json` (committed). Fresh clone or stale refs? Run:

```bash
npm run skills:update            # restore exactly the pinned state
npm run skills:update:latest     # consciously float every source to HEAD (lock diff = reviewable)
node scripts/update-skill-references.mjs --source <id> [--latest] [--force]
```

If a path below is missing, run the update first. Config lives in
`skills/references.config.json` and is deliberately project-agnostic — copy it, the
script, and this file's structure to reuse the system elsewhere. Paths are written
as `<ref-root>/…` relative to `skills/references/`.

---

## Sources

### vercel-labs/agent-skills — Tier 1 (Vercel official) · `vercel-labs/agent-skills/`

| Subskill | Path | Use when |
|---|---|---|
| react-best-practices | `skills/react-best-practices/SKILL.md` + `rules/*.md` | ANY React perf/correctness work. Client-applicable slices: `rerender-*`, `rendering-*`, `js-*`, `bundle-*`, `client-*`. Ignore `server-*` (RSC-only). Open the specific rule body before implementing — they carry wrong/right pairs |
| composition-patterns | `skills/composition-patterns/` | Designing/changing a component's API — boolean-prop sprawl, compound parts, context interface, explicit variants |

### vercel-labs/web-interface-guidelines — Tier 1 · `vercel-labs/web-interface-guidelines/command.md`

One dense rulebook (a11y, focus, forms, animation, typography, content, touch,
dark mode, anti-patterns). Consult for ANY user-facing interaction change; the
dialog/forms group feeds issue my-you-eye#29 acceptance criteria.

### shadcn-ui/ui skills/shadcn — Tier 1 (official doctrine) · `shadcn-ui/ui/skills/shadcn/`

Never install (copy-the-source model violates repo law) — mine as design reference.

| File | Use when |
|---|---|
| `customization.md` | Theming/tokens work (OKLCH pairs, `@theme inline`, radius derivation) |
| `rules/base-vs-radix.md` | Deciding primitive strategy — directly relevant: we build ON Radix |
| `rules/forms.md`, `rules/styling.md`, `rules/icons.md`, `rules/composition.md` | Forms/errors, className discipline, icon conventions, compound structure |
| `registry.md`, `cli.md`, `mcp.md` | Skip (distribution machinery we don't use) |

### millionco/react-doctor — Tier 1 (Million) · `millionco/react-doctor/.agents/skills/react-doctor/`

CLI auditor (`npx react-doctor@latest --no-telemetry`). Local SKILL.md documents
rule categories; per-rule fix recipes are REMOTE by design (react.doctor/prompts)
— fetch only during remediation of a specific finding. Never adopt Million.js
runtime (TODO §1.3).

### wshobson/agents (community, huge) · `wshobson/agents/plugins/frontend-mobile-development/skills/`

| Subskill | Use when |
|---|---|
| `react-state-management/` | Store design reviews — Pattern 2's slice-composition typing + Do/Don'ts. OVERRIDDEN where it routes "large app" to Redux (zustand-only law) |
| `tailwind-design-system/` | Tailwind v4 CSS-first work (`@theme`, OKLCH, `@custom-variant dark`, keyframes-in-theme, `@starting-style`) — this is the CORRECT v4 one; do not confuse with sickn33's v3 relic (not vendored) |

### kursku/skills frontend (community re-hosts) · `kursku/skills/frontend/`

27 skills. High-value: `fixing-accessibility/` (9-priority a11y checklist +
tool-boundary rules), `optimize/` (perf workflow — mind its stale bits: FID,
react-window advice), `baseline-ui/` (anti-slop checklist — STRIKE its Stack
section: Base UI/motion/react mandates conflict with our stack). The taste cluster
(`bolder`, `colorize`, `delight`, …) defers to DESIGN-SPEC authority — consult only
when DESIGN-SPEC is silent and say so.

### mblode/agent-skills (community) · `mblode/agent-skills/skills/`

`ui-animation/` (compositor-only motion, reduced-motion), `typography-audit/`.

### addyosmani/web-quality-skills — professional (Google Chrome eng lead) · `addyosmani/web-quality-skills/skills/`

Six-skill suite: `accessibility/` (WCAG 2.2 patterns — pairs with WIG),
`performance/`, `core-web-vitals/`, `best-practices/`, `web-quality-audit/`,
`seo/` (skip — marketing-site oriented).

### UXUI list additions (`index-UXUI.md`)

| Source | Path | Use when |
|---|---|---|
| julianoczkowski/designer-skills | `julianoczkowski/designer-skills/<skill>/` | Pre-build design process: `design-brief`, `design-review`, `design-tokens`, `frontend-design`, `information-architecture` (14 skills) |
| bergside/awesome-design-skills | `bergside/awesome-design-skills/skills/<style>/` | Aesthetic direction library (brutalism, bento, …) — ONLY within DESIGN-SPEC bounds |
| rampstackco/claude-skills | `rampstackco/claude-skills/skills/<name>/` | 103 product/UX/marketing skills; UI-relevant: `accessibility-audit`, `art-direction`, `calculator-design`, `comparison-tool-design`, `competitor-experience-audit` |
| content-designer/ux-writing-skill | `content-designer/ux-writing-skill/` | UI copywriting rules |
| anthropics/knowledge-work-plugins | `anthropics/knowledge-work-plugins/design/skills/ux-copy/SKILL.md` | Official Anthropic UX-copy skill |
| jakubkrehel/skills | `jakubkrehel/skills/skills/better-writing/` | General prose quality |
| blader/humanizer | `blader/humanizer/SKILL.md` | De-AI-ing written text (also installed user-side) |
| uxwritinghub.com microcopy article | EXTERNAL (not vendored) | Microcopy background reading |

---

## Task-routing matrix

| You are touching… | Consult (in order) |
|---|---|
| Tree rows / virtualized lists / tab strips | vercel rerender+js slices → storeSelectorHygiene test → fixing-accessibility keyboard section |
| Any dialog / form / settings field | shadcn `forms.md` + customization error contract → WIG forms group → fixing-accessibility §5–6 → #29 criteria |
| New local component's API shape | composition-patterns (all 7 bodies) → base-vs-radix.md → existing `src/components/local/*` conventions |
| Menus / popovers / overlays | WIG focus+overlay groups → fixing-accessibility §3 → Radix primitives (behavior comes free — don't rebuild) |
| Theming / tokens / accent | shadcn `customization.md` → tailwind-design-system → theme.css blocks + DESIGN-SPEC items 42–44 |
| Perf work (50k notes, bundles) | react-best-practices rerender/js/bundle slices → addyosmani `performance/` → kursku `optimize/` → react-doctor scan |
| PWA / offline / storage | addyosmani `best-practices/` + `core-web-vitals/` → optimize SW section → CLAUDE.md rule 3 |
| Motion / animation | mblode ui-animation → baseline-ui animation section → DESIGN-SPEC motion rules |
| UX copy / labels / empty states | anthropic ux-copy → ux-writing-skill → clarify/harden (kursku) → em-dash ban test |
| Git/sync/share flows | No skill covers these (ecosystem blind spot) — TODO.md + roadmap docs are authoritative |
| Pre-PR review | TODO.md standing checklists + `storeSelectorHygiene` + `fsIsolation` guards |

---

## Conflicts & overlaps register

| Clash | Standing resolution | Re-judge when |
|---|---|---|
| baseline-ui mandates Base UI/motion/react vs my-you-eye+Radix law | Strike its Stack section; keep interaction/motion/typography rules | Library ever adopts Base UI primitives upstream |
| shadcn copy-source ownership vs npm-library-first law | Never install; doctrine/reference only | We abandon my-you-eye-first (unlikely) |
| WIG "deep-link all stateful UI" vs local-first no-router | Apply ONLY to v2 share links | Real router lands |
| kursku optimize: react-window/react-virtualized vs our VirtualList | Keep local VirtualList; TanStack Virtual is the escape hatch (§1.2) | Variable-height rows arrive |
| wshobson "large app → Redux Toolkit" vs zustand-only law | Zustand stays; steal his slice typing + selector-hook conventions | — |
| vercel RSC/server slices vs SPA reality | Quarantined by `server-*` prefix — skip wholesale | App gains SSR |
| React-19 tiers (composition-patterns, shadcn) vs pinned React 18 | Self-gating sections — skip | Dependency bump decision |
| Multiple a11y sources overlap (WIG ≈ fixing-accessibility ≈ addyosmani accessibility) | fixing-accessibility = structure/priority order; WIG = exhaustive detail; addyosmani = WCAG 2.2 citations. All three may apply; cite what you implement | A source contradicts WCAG 2.2 |

## Maintenance

- Refresh: `npm run skills:update:latest` → inspect lock diff → commit. Pins make drift a visible decision, never ambient.
- Adding a source: append to `references.config.json` (+ row here) → run updater.
- This file changes whenever a source gains/loses relevance to the routing matrix — same commit as the config change.

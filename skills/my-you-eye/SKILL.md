---
name: my-you-eye
description: Use the my-you-eye component library. Invoke before building ANY UI — buttons, inputs, cards, dialogs, tables, tree views, canvas/graph/pipeline editors — AND before authoring any animation, diagram, chart, or recorded/presented video (coding walkthroughs, architecture diagrams, data flows, stats) in a project that depends on this package. Read the manifest first.
---

# my-you-eye — UI + motion + scenes + video library

One package, one version number, four tiers: static UI components
(`my-you-eye`), frame-driven animation primitives (`my-you-eye/motion`),
data-driven video/presentation scene templates (`my-you-eye/scenes`), and
the renderers that turn scene data into an MP4 or a live click-through
(`my-you-eye/present`, `my-you-eye/video`). **Never hand-roll a styled
`<button>`, `<input>`, `<select>`, `<table>`, `<a>`, a bespoke card/dialog/
menu, or a hand-drawn diagram/chart.** There is almost certainly already a
component for it.

## Step 1 — find the component (always do this first)

Read `components.json` (machine-readable) or `COMPONENTS.md` (human-readable)
at the package root. Both are auto-generated from the library source. Each
entry gives you everything you need to call the component correctly:

- `props` — the full prop signature: `{ name: { type, optional, doc? } }`
- `variants` — the CVA axes and their allowed values (e.g. `variant`, `size`)
- `variantDefaults` — what you get when you pass nothing
- `extends` — inherited surfaces (`HTMLAttributes<...>` means it takes
  `className` and standard DOM props)
- `entry` — the exact import subpath
- `demos` — the named usage examples that exist in the showcase

Or run `npx my-you-eye list` for a terminal overview of all components.

## Step 2 — route the task to the right section/reference

| Task | Read |
|---|---|
| Build a page/app/feature from a user request | **"Request → recipe" playbooks below**, then the catalog |
| Static UI: buttons, inputs, cards, tables, dialogs, overlays, nav | `components.json` entry — usually enough on its own |
| A diagram: architecture, dataflow, state machine, flowchart, sequence | **`references/diagrams.md`** — read it even if you think you know the schema |
| A custom animation: entrance/attention effects, camera pans | `references/motion.md` |
| A whole video or click-through presentation | **"Script → scenes" workflow below**, then `references/scenes.md` |
| Charts, `CodeBlock`/`Terminal`/`DiffBlock`, stat tiles, tables/lists/trees | `references/data-display.md` |

## Step 3 — use it

```tsx
import { Button, Card, Table } from "my-you-eye";
import type { ButtonProps, CardProps } from "my-you-eye"; // every component's Props type is exported
import { Reveal, Stagger } from "my-you-eye/motion";
import { assertVideo, SceneRenderer } from "my-you-eye/scenes";
import { Presenter, SpeakerView, useSteps } from "my-you-eye/present";
import { VideoRoot } from "my-you-eye/video";
import "my-you-eye/styles.css"; // once, at the app root
```

**Setup requirements:**
- `my-you-eye/styles.css` is raw Tailwind v4 source — the consuming app must
  run Tailwind v4 itself. If it doesn't (Remotion, plain bundlers), import
  `my-you-eye/styles.compiled.css` instead: pre-compiled, drop-in, but only
  contains the utilities the library itself uses.
- Wrap your app root in `<TooltipProvider>` if you use Tooltip.
- Render `<Toaster />` somewhere in your app if you use toasts.
- `my-you-eye/motion/remotion`, `my-you-eye/present/player`, and
  `my-you-eye/video` pull in Remotion — only import them in a project that
  renders MP4s or embeds the MP4 timeline. Plain UI, motion primitives, and
  the live `Presenter` never need Remotion installed.

## The rules that matter most

1. **Two different stability contracts — do not cross them.** `my-you-eye/scenes`
   data (a `Video` object) accepts **no** `className`, `style`, color, pixel
   coordinate, or frame count — only plain data and closed unions. Ordinary
   components (the main entry and `/motion`) DO accept `className` for
   one-off layout. Mixing the two habits up is the single most common mistake.
2. **Validate before you render.** `assertVideo(video)` / `validateVideo(video)`
   (`my-you-eye/scenes`) is a required step before `VideoRoot`/`Presenter`,
   not a debugging tool — it catches broken references with a precise path
   before they become a broken frame.
3. **A diagram is data with grid-unit-or-omitted coordinates, not a canvas
   you position by hand.** Read `references/diagrams.md` before writing a
   `diagram`/`sequence` scene, even a small one.
4. **Pick behavior with variant props from the manifest's allowed set.**
   `className` is for one-off layout (width, margin) only — never to restyle.
   If you keep re-adding the same `className`, the right fix is a new variant
   upstream.
5. **Customize by theme, not by fork.** All color/radius/spacing/typography
   come from CSS variables. Override tokens at the app root or set
   `data-theme="<name>"` / `.dark` on `<html>` — never copy component code.

## Request → recipe playbooks (static apps)

How to translate what a user asks for into a component skeleton. Method,
always in this order: (1) match the request to the closest archetype below,
(2) build the layout skeleton first with placeholder-free realistic content,
(3) wire the empty/loading/error states, (4) only then refine visuals.

### "An IDE / editor / knowledge tool" (VS Code, Obsidian, admin workbench)

Full-viewport app shell — the page itself never scrolls, panels scroll
internally (`overflow-auto`; scrollbars are globally styled).

- Skeleton: outer `flex h-screen flex-col` → slim top `Toolbar` (leading
  label, search, actions) → `flex flex-1 min-h-0` row: left rail (`FileTree`
  or `TreeView` in a `ScrollArea`, ~240px), main area (`Tabs` variant
  underline holding `CodeBlock` / `Markdown` / editor panes), optional right
  inspector (`DataList` for properties) or bottom `Terminal`.
- Navigation is keyboard-first: `CommandPalette` bound to ⌘K (show it with
  `Kbd` in the toolbar), `DropdownMenu` for context actions, `Drawer` for
  settings, `ConfirmDialog` for destructive actions.
- Status: thin footer strip with `StatusDot` + `Badge`; toasts for async
  results.
- Use `density`-style compactness (small sizes, `size="sm"` buttons); mono
  font (`data-font="jetbrains"` or `"consolas"`); `default`, `stark`, or
  `contrast` theme.

### "A dashboard / analytics / monitoring view"

- Skeleton: `PageShell` (title, description, actions) → `StatGrid` KPI row
  (4 tiles, `sparkline` on the ones with history, `delta` with
  `positiveIsGood: false` for latency/error metrics) → a 2-column chart row
  (`BarChart` / `LineChart`; every chart already ships axes/legend/tooltip
  via `ChartFrame`) → full-width `DataTable` with typed columns (`CellType`
  handles dates, bytes, statuses, users, progress — pass `type`, don't
  format by hand) and a `rowKey`.
- Filters live in one `Toolbar` above the table: `Select`/`MultiSelect`/
  `Combobox`, active filters as chips.
- Chart choice by data shape: comparison → bar; trend → line; part-of-whole
  → pie/funnel; correlation → scatter; matrix → heatmap; single KPI with
  thresholds → gauge; tiny inline trend → sparkline. Two chart types per
  screen is plenty.
- Loading = `Skeleton` blocks in the same layout; empty = `EmptyState` with
  one action; never a blank div.

### "A landing / marketing / portfolio page"

The one archetype where the page scrolls and personality leads.

- Skeleton: hero (Typography display scale + one primary `Button` + one
  ghost) → feature grid of `Card`s → proof (`StatGrid`, or `Comparison`
  wipe for before/after) → `Image` with `caption` → CTA section → footer of
  `Link`s.
- Pick a personality theme and commit: `brutal` (bold statement), `stark`
  (editorial/minimal), `glass` (modern SaaS), `neon` (dev-tool), `comic`
  (playful). `TexturedSurface` on the hero/section backdrops — `page` layer,
  `subtle` or `medium`, never `strong` everywhere.
- Exactly one primary button per viewport-height of content.

### "A node editor / pipeline / graph view"

- Interactive editing → the `Graph` pattern (drag, connect, delete — one
  component). Static architecture panel → `Canvas` + `GraphNode` +
  `ConnectionLayer` (+ `GraphGroup` rendered *before* the nodes it bounds)
  and let `layered()`/`grid()` (exported from the main entry) place nodes —
  positions are pixels, already grid-snapped.
- Edge `kind` (`sync`/`async`/`data`/`error`) carries meaning — don't leave
  everything on the default. Rules and worked examples: `references/diagrams.md`
  Part 2.

### "A form / settings / onboarding flow"

- Every field is a `FormField` (label + control + help/error text) — never a
  bare `Input` + `Label` pair. Group with `Card` sections or `Tabs`
  (few/many sections respectively).
- `Switch` = takes effect immediately; `Checkbox` = part of a form you
  submit. `RadioGroup` ≤5 options, `Select` beyond that, `Combobox` when the
  list is searchable, `MultiSelect` for many-of.
- Destructive actions: `variant="danger"` + `ConfirmDialog`. Feedback:
  `useToast`, and inline `Alert` for validation summaries.

### "A docs / knowledge-base site"

`Breadcrumbs` on top, `TreeView` nav in a left `ScrollArea`, `Markdown` for
the body (it already handles code blocks), `CommandPalette` for search,
`Pagination` or prev/next `Link`s at the bottom. Serif or sans font, generous
line length (~70ch max), `default` or `stark` theme.

### "A data browser / back-office CRUD"

`Toolbar` (search + filters) → `DataTable` (typed columns, `stickyHeader`,
`rowKey`) → `Pagination`. Row click opens a `Drawer` with a `DataList`
detail view + actions. Bulk import via `FileDrop`. Creation via `Dialog`
with `FormField`s.

## Design rules that make it look professional

1. **Skeleton before decoration.** Layout → states → content → polish. A
   plain page with correct hierarchy beats a decorated page with none.
2. **One primary action per view.** Everything else is `secondary`/`ghost`.
3. **Never write placeholder content.** "Acme Corp / $12,400 / 3 open
   orders" — realistic domain data at every step, no lorem, no foo/bar.
4. **The three states ship with v1.** Empty (`EmptyState` + one action),
   loading (`Skeleton` mirroring the real layout), error (`Alert`). A
   feature without them is half-built.
5. **Density is a per-app decision, not per-component.** Tools: compact/sm
   everywhere. Marketing: normal/lg everywhere. Never mixed in one view.
6. **Apps fill the viewport; documents scroll.** For tools, `h-screen` +
   `min-h-0` + internal `overflow-auto` panels — the body never scrolls.
7. **Typography does hierarchy, color does status.** Size/weight for
   structure; `success`/`warning`/`danger` tokens strictly for meaning —
   never as decoration.
8. **If you're stacking utility classes on a `ui/` component, stop.** More
   than ~3 = you want a variant or a token change, not a local override.
9. **Format values with `CellType`/`valueFormat`, not by hand** — bytes,
   durations, currencies, dates stay consistent app-wide for free.
10. **Motion means something or it goes.** In apps, animation marks state
    change or directs attention (`Reveal` on mount of new content, `Pulse`
    on the thing needing action) — never idle decoration.
11. **Texture is seasoning.** One `TexturedSurface` layer hierarchy per
    page; if two strengths are fighting, lower both.
12. **Trust the theme.** Switching `data-theme` + `.dark` must be enough to
    restyle the whole app. If it isn't, you hardcoded something — fix that.

## Script → scenes: authoring a presentation or video

Use cases: a **live click-through** you narrate in person (`Presenter`) and
a **rendered MP4** (`VideoRoot`). Both consume the *same* `Video` object with
identical pacing — author once, deliver both. Full schema:
`references/scenes.md`. Compile any request in this order:

**1. Write the narration first.** Numbered beats, one spoken sentence or two
each — as the presenter would actually say them. No visuals yet. This script
IS the timing model: each beat becomes a step's `say`, and `say` length
drives that step's duration (there is no duration field anywhere).

**2. Chunk beats into scenes.** Map each run of beats to a scene `kind`:

| The beats are about... | Scene kind |
|---|---|
| Opening, chapter break | `title` |
| Agenda, takeaways, any list | `bullets` |
| Explaining existing code | `code` with `focus`/`highlight` steps |
| Code evolving (refactor, fix) | `code` with per-step `code` (animated diff) |
| CLI usage, installs, deploys, logs | `terminal` |
| Architecture, dataflow, state machine | `diagram` — read `references/diagrams.md` first |
| Request/response between services | `sequence` |
| Metrics with shape (trend, comparison) | `chart` |
| Headline numbers | `stat` |
| Before/after anything | `compare` |
| Touring a real UI (from a screenshot) | `walkthrough` |
| Closing, links, CTA | `outro` |

**3. Author each scene as data.** Each beat → one step; the beat's sentence
→ that step's `say`; something must visibly change every step (a `reveal`,
`focus`, `connect`, new bullet…) — a step with no visual change means merge
it into the previous beat. `caption` only for a key term, not a transcript.
`hold: "slow"` after the landing beat.

**4. `assertVideo(video)` — mandatory.** Fix every error; read every
warning (they encode real failure modes: too many nodes, too many bullets,
missing `say`).

**5. Deliver:**

| Delivery | Component | Needs Remotion? |
|---|---|---|
| Live click-through (talk over it, click/→ to advance) | `<Presenter video={video} />` — Esc = overview, f = fullscreen, built-in speaker view with your `notes` | No |
| MP4 file | `<VideoRoot />` in a Remotion project — see "Rendering to MP4" in `references/scenes.md` | Yes |
| MP4 timeline embedded in a web page | `<PlayerEmbed />` (`my-you-eye/present/player`) | Yes |
| Custom presenter chrome | `useSteps(video)` — headless | No |

**6. Refine like an editor.** Watch end-to-end once before touching details.
Rhythm: alternate heavy scenes (diagram, code) with light ones (title,
stat, bullets) — never three dense scenes back-to-back. A `title` scene per
chapter gives free chapter markers. ~8–15 scenes ≈ a 5-minute video.
Defaults are deliberate (dark appearance, 1080p, 30fps) — override `meta`
only with a reason. For diagrams, run the pre-flight checklist at the end
of `references/diagrams.md`.

## Component catalog (static UI — `my-you-eye`)

### inputs
Button, Checkbox, Combobox, FileDrop, Input, Label, MultiSelect, RadioGroup, Select, Slider, Switch, Textarea

### display
Avatar, Badge, Card, CodeBlock, DeviceFrame, DiffBlock, EmptyState, Image, Kbd, Markdown, ScrollArea, Separator, StatusDot, Terminal

### feedback
Alert, Progress, Skeleton, Spinner, Toast

### overlay
CommandPalette, Dialog, Drawer, DropdownMenu, Popover, Tooltip

### navigation
Breadcrumbs, Link, Pagination, Tabs

### canvas
Annotation, Canvas, ConnectionLayer, ConnectionLine, Edge, Graph, GraphGroup, GraphNode, Port

### charts
BarChart, ChartFrame, Funnel, Gauge, Heatmap, Legend, LineChart, PieChart, ScatterPlot, Sparkline

### data
CellType, DataList, DataTable, Table, Timeline, TreeView

### patterns
Comparison, ConfirmDialog, FileTree, FormField, PageShell, SequenceDiagram, StatCard, StatGrid, TexturedSurface, Toolbar

### typography
Typography

Full prop signatures, variants, and demo names for every one of these live
in `components.json` — this list is only for picking a name to look up.
Every component also exports its `Props` type and (for CVA components) its
`<name>Variants` object from the main entry.

## Multi-part components

Some components export sub-parts. Import them by name:

**Dialog:** `Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter`
**Drawer:** `Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter`
**DropdownMenu:** `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel`
**Popover:** `Popover, PopoverTrigger, PopoverContent, PopoverClose`
**Tooltip:** `TooltipProvider, Tooltip, TooltipContent`
**Select:** `Select, SelectTrigger, SelectContent, SelectItem, SelectValue`
**Tabs:** `Tabs, TabsList, TabsTrigger, TabsContent`
**Card:** `Card, CardHeader, CardTitle, CardContent, CardFooter`
**Table:** `Table, TableHeader, TableBody, TableRow, TableHead, TableCell`
**RadioGroup:** `RadioGroup, RadioGroupItem`
**Toast:** `Toaster, useToast` (hook — `const { toast } = useToast()`)

## Available themes

`default`, `dark`, `neon`, `contrast`, `glass`, `comic`, `brutal`, `stark`,
`frosted`, `metallic`. Dark mode (`.dark` class) is orthogonal — every theme
has a light and dark variant.

```tsx
document.documentElement.dataset.theme = "glass"; // switch theme
document.documentElement.classList.toggle("dark"); // toggle dark mode
```

Character guide: `default` neutral/safe · `contrast` accessibility-first,
data-dense tools · `stark` minimal editorial · `brutal` bold borders, hard
shadows · `neon` vibrant dev-tool energy · `glass` translucent modern SaaS ·
`frosted` softer glass · `comic` hand-drawn playful · `metallic` brushed
industrial. A video/presentation's `meta.theme` (`my-you-eye/scenes`)
supports a subset — see `references/scenes.md`'s "Theme caveat".

## CLI tool

```
npx my-you-eye init [--force]   Copy SKILL.md + references/ + components.json to skills/
npx my-you-eye list             List all components with groups and variants
npx my-you-eye sync             Re-copy SKILL.md + references/ + components.json (overwrite)
npx my-you-eye --help           Show usage
```

## If a component genuinely does not exist

It belongs in the library, not in the consuming app. Add it upstream in
`src/ui/` (or `src/motion/`/`src/scenes/` for animation/scene work)
following that repo's `AGENTS.md`, then consume it here. Do not inline a new
primitive locally.

## Maintaining this document

This file is **hand-curated**; `components.json`/`COMPONENTS.md` are
**generated** (`npm run manifest` — never edit them by hand). Division of
labor: the manifest owns *what exists and its exact API*; this file owns
*judgment* — routing, recipes, design rules. Never duplicate prop lists
here; link to the manifest.

Update this file when — and only when — one of these happens:

1. **A new component ships** → add its name to the catalog list (correct
   group), and to a playbook only if it changes a recipe's best answer
   (e.g. a new Wizard pattern would rewrite the forms playbook).
2. **A new group, tier, entry point, or theme ships** → update the catalog
   headers, Step 3 imports, or themes list + character guide.
3. **An export is renamed or removed** → grep this file AND
   `references/*.md` for the old name; fix every mention. A doc that
   references a dead export is worse than no doc.
4. **A new scene `kind` ships** → add a row to the script→scenes decision
   table here, and full field docs in `references/scenes.md`.
5. **A new multi-part component ships** → add its part list to the
   multi-part section.
6. **A workflow rule proves wrong in practice** → fix the rule, don't stack
   an exception paragraph on top.

After any edit: verify every component name mentioned here exists in
`components.json` (`npx my-you-eye list` is the quick cross-check), keep the
playbooks/decision tables in the same compact format, and don't let this
file grow past roughly its current length — it is loaded into context
whenever the skill triggers, so every added paragraph must earn its keep.
The deep references (`references/*.md`) are the place for detail; this file
is the map, not the territory.

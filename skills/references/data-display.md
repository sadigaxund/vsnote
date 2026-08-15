# Data display — charts, code, tables, stats

Covers the `src/ui/` (`my-you-eye`) components for showing data: the 8
charts, `CodeBlock`/`Terminal`/`DiffBlock`, `StatCard`/`StatGrid`,
`DataTable`/`DataList`/`TreeView`/`CellType`, `Timeline`, and `Comparison`.

These are ordinary `src/ui/` components: variant props for behavior,
`className` for one-off layout (they extend `HTMLAttributes`), same
contract as every other `src/ui/` component. If you're authoring a video
scene instead of a plain React app, prefer `my-you-eye/scenes`'
`ChartScene`/`CodeScene`/`TerminalScene`/`StatScene`/`CompareScene`
(`references/scenes.md`) — they wrap these same components with a
closed-union, `className`-free schema. This file documents the components
you'd reach for directly in a normal app, or that a scene wraps under the
hood (useful when the scene's field names differ from the wrapped
component's — flagged below where that happens).

## Draw-on `progress`

Every chart and `DiffBlock`/`StatCard`'s sparkline accepts an optional
`progress?: number` (0→1, omitted or `1` = fully drawn) and is a pure
function of it — see `references/motion.md`'s "progress-in convention".
This is how a scene animates a chart drawing on without the chart itself
importing motion.

## Charts

All 8 charts + `ChartFrame` (shared axes/grid/legend/tooltip chrome — build
on this directly only if you're making a genuinely new chart type; the 8
existing ones are thin wrappers over it) + `Legend` (standalone swatch list,
`items: { label, token: ChartColorToken }[]`, `swatch: "rect"|"line"|"dot"`,
`orientation`) live under `my-you-eye`. Every chart's color comes from a
closed `ChartColorToken` (`"chart-1"`…`"chart-8"`, derived per-theme from
`--color-primary` — see AGENTS.md TODO D3) — never an arbitrary color prop.

| Component | Key props | Notes |
|---|---|---|
| `BarChart` | `categories: string[]`, `series: {label,data,token?}[]`, `orientation: "vertical"\|"horizontal"`, `mode: "grouped"\|"stacked"` (2+ series only), `valueFormat?`, `progress?`, `focus?: string` | `focus` dims every category except the named one. |
| `LineChart` | `categories`, `series: {label,data,token?}[]`, `area?` (default false), `showPoints?` (default true), `valueFormat?`, `progress?`, `focus?: string` | `progress` reveals left-to-right via a clip rect. |
| `PieChart` | `slices: {label,value,token?}[]`, `innerRadius?` (0=pie, >0=donut), `centerLabel?`, `centerValue?`, `progress?` | Arc sweeps from 12 o'clock. |
| `Gauge` | `value`, `min?`, `max?`, `bands?: {upTo,status:"success"\|"warning"\|"danger"}[]`, `label?`, `valueFormat?`, `progress?` | Threshold bands use status tokens, not chart tokens — a band means good/bad, not series identity. |
| `Heatmap` | `xLabels: string[]`, `yLabels: string[]`, `values: number[][]` (row-major), `valueFormat?`, `progress?` | Cells fade in by value rank as `progress` sweeps. **Naming note:** the scenes-tier `ChartSpec` (`type: "heatmap"`) calls these fields `columns`/`rows` instead of `xLabels`/`yLabels` — same axes, different names at the two tiers. |
| `ScatterPlot` | `series: {label,data:{x,y,label?}[],token?}[]`, `trendLine?` (least-squares, all series pooled), `xFormat?`, `yFormat?`, `loading?`, `progress?` | **Naming note:** the scenes-tier `ChartSpec` (`type: "scatter"`) calls this field `trend?`, not `trendLine?`. |
| `Funnel` | `stages: {label,value}[]` (first = widest), `valueFormat?`, `progress?` | Ordered data — takes the ordinal ramp, not the 8-hue categorical palette (swapping stage order would change the chart's meaning). |
| `Sparkline` | `data: number[]`, `token?`, `area?`, `width?` (default 96), `height?` (default 24), `progress?` | No axes/categories — feeds `StatCard`'s inline trend slot or a table cell. |

### Authoring via the scene schema instead

`my-you-eye/scenes`' `ChartScene.chart: ChartSpec` is a discriminated union
on `type` (`"bar" | "line" | "pie" | "gauge" | "heatmap" | "scatter" |
"funnel"`) that aliases each chart's own series/slice/stage types directly —
see `references/scenes.md`'s chart section for the exact schema shape and
the two field-name differences called out above (heatmap's
`columns`/`rows`, scatter's `trend`).

## `CodeBlock`

```ts
interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  code: string;
  language?: string;
  header?: string;
  wrap?: boolean;
  showLineNumbers?: boolean;
  highlight?: boolean;                          // enable syntax highlighting
  highlightLines?: number[];                    // 1-indexed; implicitly enables line numbers
  highlightColor?: CodeBlockHighlightGroup["color"];
  highlightGroups?: CodeBlockHighlightGroup[];   // multi-color; takes precedence over highlightLines
  highlightRanges?: HighlightRangeDef[];         // substring highlights, 0-indexed char positions
  focusRange?: [number, number];                 // 1-based; lines outside dim to opacity-muted
  lineId?: (lineNumber: number) => string;        // per-line element id, for Camera/Annotation targeting
}
```

`highlightRanges` **forces `wrap={false}` internally** — the overlay assumes
one visual row per logical line, so a wrapped row would misalign every
highlight below it. If you need highlights on a long line, accept the
horizontal scroll rather than fighting `wrap`. `focusRange` and `lineId`
exist specifically for `my-you-eye/scenes`' `CodeScene` — you'll rarely set
them by hand outside that scene's own step-to-camera wiring.

## `Terminal`

```ts
type TerminalPromptGlyph = "$" | ">" | "#" | "❯";

interface TerminalEntry {
  command?: string;   // omit for an output-only entry (banner, log tail)
  output?: string;    // rendered via CodeBlock
  language?: string;
  exitCode?: number;  // badge: 0 = success, non-zero = danger
  spinner?: string;   // in-progress line
  // Per-entry prompt-chrome overrides. Each PERSISTS to every following
  // entry until overridden again (real-shell semantics), falling back to
  // the Terminal-level prop until first set.
  cwd?: string; user?: string; host?: string;
  promptGlyph?: TerminalPromptGlyph;
}
interface TerminalProps {
  entries: TerminalEntry[];
  prompt?: TerminalPromptGlyph;    // default "$"
  cwd?: string; user?: string; host?: string;
  title?: string;                  // window-style title bar caption
  variant?: "default" | "elevated";        // default "default"; "elevated" adds shadow-card
  scheme?: "default" | "matrix" | "amber"; // default "default"; retints text + border only
  chrome?: "dots" | "none";                // default "dots"; traffic-light dots in the title bar
  rows?: number;                            // fixed visible height, in whole text lines
}
```

Composes `CodeBlock` for output bodies — never re-tokenizes.

`rows` is a **fixed** height, not a maximum: the entries body is exactly
`rows` lines tall from the first frame on (measured from the real rendered
line-height plus the body's own padding, never a hardcoded px figure) and
scrolls internally, auto-scrolling newly revealed content into view. Omit it
for grows-with-content behaviour — fine on a static page, wrong for a video
frame, where a box that changes height mid-shot reads as a jump.

`scheme` and `chrome` are decorators on the existing variant axis, not
parallel props. `scheme` composes only tokens that already exist
(`--color-success` / `--color-warning`) and retints text and border while
leaving `--color-code-bg` alone, so no theme file needs updating for it.
`chrome="none"` keeps the caption bar (whenever `title`/`cwd` is set) but
drops the macOS-style dots; it has no effect when there is no title bar.

## `DiffBlock`

```ts
type DiffLineType = "context" | "added" | "removed";
interface DiffLine { type: DiffLineType; content: string; oldLine?: number; newLine?: number }
interface DiffBlockProps {
  lines: DiffLine[];
  language?: string;
  header?: string;
  mode?: "unified" | "split";  // default "unified"
  highlight?: boolean;          // syntax-highlight via CodeBlock's tokenizer
  wordDiff?: boolean;           // word-level diff for a 1:1 removed/added pair
}
```

Reuses `CodeBlock`'s tokenizer/gutter. `my-you-eye/scenes`' `CodeDiff`
animates transitions between two full sources built on top of this — use
`CodeDiff` (from `my-you-eye/scenes`) if you need the animated version, not
a hand-rolled progress prop on `DiffBlock` itself (it doesn't have one).

## `StatCard` / `StatGrid`

```ts
interface StatCardDelta {
  value: string | number;   // number: sign/color/arrow all derived; string: pass direction explicitly
  direction?: "up" | "down"; // required when value is a string
  label?: string;
  positiveIsGood?: boolean;  // default true — false for latency/error-rate style metrics
}
interface StatCardProps {
  label: string;
  value: ReactNode;   // ReactNode, not just string — drop in motion's CountUp for a live tween
  delta?: StatCardDelta;
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  sparkline?: { data: number[]; token?: ChartColorToken; area?: boolean; progress?: number };
}
interface StatGridProps {
  items: (StatCardProps & { style?: CSSProperties })[]; // style is the one intentional escape hatch, for a per-tile computed reveal — never for design values
  columns?: 2 | 3 | 4 | 5 | 6; // default 4
  size?: "sm" | "md" | "lg";
}
```

`value` and `StatGridItem.value` are `ReactNode`, not `string` — this is
what lets `my-you-eye/scenes`' `StatScene` drop a live `CountUp` in per
tile while `StatCard` itself stays a pure presentational component with no
motion import.

## `DataTable` / `DataList` / `TreeView` / `CellType`

`CellType` is the shared value-rendering primitive underneath all three —
one `type` (a 30-member closed union: `text`, `number`, `percentage`,
`bytes`, `duration`, `currency`, `signed`, `date-human`, `date-system`,
`datetime-tz`, `boolean`, `email`, `url`, `json`, `null`, `badge`, `status`,
`array`, `image`, `audio`, `tree`, `sparkline`, `tags`, `code`, `color`,
`hash`, `user`, `progress`, `secret`) picks how a raw `value: unknown`
renders. `DataTable`/`DataList`/`TreeView` all key their columns/items off
this same `CellValueType` union so a value renders identically whichever
container it's in.

```ts
interface DataTableColumn {
  key: string; header: string; type?: CellValueType;
  align?: "left" | "right" | "center";
  width?: "xs" | "sm" | "md" | "lg" | "xl";
  badgeVariant?: "neutral" | "primary" | "success" | "warning" | "danger";
  statusVariant?: StatusVariant | ((value: unknown) => StatusVariant);
}
interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  stickyHeader?: boolean;
  replacements?: UrlReplacement[]; // pattern -> label rewriting for "url" cells
  // layout?: "fixed" | "auto" — "fixed" (default) locks to width hints/equal share; "auto" sizes to content + horizontal scroll
}
```

```ts
interface DataListItem {
  label: string; value?: string | number | boolean | null; type?: CellValueType;
  badgeVariant?: ...; statusVariant?: ...; icon?: ReactNode;
}
interface DataListProps {
  items: DataListItem[];
  // density: "compact" | "normal", labelWidth: "sm" | "md" | "lg", striped?: boolean
}
```

`TreeView` renders a `CellType type="tree"`-shaped nested payload with
expand/collapse, depth guides, and a per-item `trailing` slot; `FileTree`
(patterns group) is `TreeView` + file-type icons + git-status badges, no
new tree logic of its own.

## `Timeline`

```ts
type TimelineEventState = "done" | "active" | "pending" | "error";
interface TimelineEvent {
  at: number;    // plain ordering value (index, timestamp, elapsed ms) — Timeline never draws an axis/scale off it, only relative order/spacing
  label: string; description?: string;
  lane?: string; // omit for a single-lane timeline
  state?: TimelineEventState;
}
interface TimelineProps {
  events: TimelineEvent[];
  orientation?: "horizontal" | "vertical"; // horizontal: lanes as rows (roadmaps, traces). vertical: lanes as columns (git history/changelog read)
  lanes?: string[]; // explicit lane display order; defaults to first-seen order
}
```

## `Comparison` (patterns)

```ts
interface ComparisonProps {
  before: ReactNode; after: ReactNode;
  beforeLabel?: string; afterLabel?: string;
  mode?: "side-by-side" | "wipe"; // default "side-by-side"
  value?: number; defaultValue?: number; onValueChange?: (v: number) => void; // wipe divider, 0-100
  progress?: number; // 0→1 — when set, drives the wipe divider directly and disables dragging
}
```

**Naming note:** the scenes-tier `CompareScene.mode` uses `"columns" |
"wipe"`, not `"side-by-side" | "wipe"` — same two visual modes, different
literal at the two tiers. If you're wiring `Comparison` by hand (not through
`CompareScene`), use `"side-by-side"`.

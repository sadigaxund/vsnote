# Scenes — authoring a `Video`

`my-you-eye/scenes` is the entire authoring surface for a recorded video or
a live click-through presentation. You write **one typed data object** — a
`Video` — and nothing else. No JSX, no timings, no colors, no
`className`/`style`. `<VideoRoot video={video} />` (`my-you-eye/video`)
renders it to MP4; `<Presenter video={video} />` /
`<PlayerEmbed video={video} />` (`my-you-eye/present`,
`my-you-eye/present/player`) render the same object live, with **identical
pacing** — both derive off the same `sceneSteps`/`buildSequence` spine, so
the MP4 and the click-through can never drift apart.

```tsx
import type { Video } from "my-you-eye/scenes";
import { assertVideo } from "my-you-eye/scenes";
import { VideoRoot } from "my-you-eye/video";
import { Presenter } from "my-you-eye/present";

const video: Video = { /* ... */ };
assertVideo(video); // throws with every problem listed if the data is broken — see "Validate" below

<VideoRoot video={video} />        // inside a Remotion composition -> MP4
<Presenter video={video} />        // in a browser -> click-through
```

## Validate before you render — this is not optional

```ts
function validateVideo(video: unknown): ValidationIssue[]; // never throws — returns every problem
function assertVideo(video: unknown): Video;                // throws if any issue is severity:"error"
```

Run one of these on every `Video` object you author, **before** handing it
to `VideoRoot`/`Presenter`. This is the cheapest way to catch your own
authoring mistakes — a bad scene fails loudly with a precise `path`
(`scenes[2].steps[0].flow[1]`) at author time instead of silently rendering
a blank or broken frame. Treat `assertVideo` as a required step in your
workflow, not a debugging tool you reach for only when something already
looks wrong:

```ts
import { assertVideo } from "my-you-eye/scenes";

const safeVideo = assertVideo(video); // narrows unknown -> Video; throws with every error listed
```

`validateVideo` returns issues with `severity: "error"` (the scene cannot
render correctly — reference to a node/edge/participant id that doesn't
exist, a required field missing, an out-of-range value) or `"warning"` (it
renders, but reads badly — e.g. more than 12 diagram nodes, more than 7
bullets, a step with no `say` and nothing else to derive its pacing from,
a stat tile with neither `value` nor `text`). Read the warnings too; they
exist because a previous batch found these exact failure modes in real
authored data.

## `Video` — the top level

```ts
interface Video {
  meta?: VideoMeta;
  scenes: Scene[]; // non-empty
}
```

### `VideoMeta`

| Field | Type | Default | Notes |
|---|---|---|---|
| `fps?` | `24 \| 30 \| 60` | `30` | |
| `size?` | `VideoSize` | `"1080p"` | `"1080p" \| "1440p" \| "4k" \| "square" \| "vertical"` — a closed union, not free `width`/`height`. Resolved via the exported `VIDEO_SIZES` table (`{ width, height }` per size). |
| `theme?` | `VideoTheme` | `"default"` | See "Theme caveat" below — **currently 8 values**, not the full 10-theme set. |
| `appearance?` | `"light" \| "dark"` | `"dark"` | Video is watched on a bright screen in a dark room far more often than the reverse. |
| `font?` | `FontMode` | `"sans"` | Same list as the showcase's font picker. |
| `title?` | `string` | — | Composition id / document title only — never rendered into a frame. Author a `title` scene for on-screen text. |
| `watermark?` | `string` | — | Persistent corner handle, e.g. `"@yourchannel"`. |
| `progressBar?` | `boolean` | `true` | Thin bar along the bottom edge. |
| `chapters?` | `boolean` | `true` | Derived from `title` scenes. |

**Theme caveat — verified against source, not aspiration.** The full
component library ships 10 theme CSS files
(`default`/`dark`/`neon`/`contrast`/`brutal`/`stark`/`glass`/`comic`/
`metallic`/`frosted`). `VideoTheme` (`src/lib/themes.ts`'s `ThemeProfile`,
which also drives `validateVideo`'s accepted values) currently has only
**8**: `"default" | "neon" | "contrast" | "brutal" | "stark" | "glass" |
"comic" | "metallic"`. `"dark"` and `"frosted"` are not selectable via
`meta.theme` today — `"dark"` isn't a gap in practice (use
`meta.appearance: "dark"` instead, which is the intended way to get a dark
render of any theme), but `"frosted"` genuinely has no video/presenter path
yet. If you need it, that's a real product gap to flag upstream, not
something to work around by passing an unlisted string (the validator will
reject it).

### Fields every scene accepts (`SceneBase`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id?` | `string` | derived from index | Chapter markers, presenter deep-links, validation error names. |
| `pace?` | `"slow" \| "normal" \| "fast"` | `"normal"` | **The only timing dial.** Everything else derives from how much text you wrote in each step's `say`. |
| `transition?` | `"none" \| "fade" \| "slide" \| "wipe"` | `"fade"` | Transition INTO this scene from the previous one. |
| `notes?` | `string` | — | Speaker-view only. Never rendered on screen. |

### Fields every step accepts (`StepBase`)

| Field | Type | Notes |
|---|---|---|
| `say?` | `string` | Narration line. Does three jobs: speaker-view script, the content-length input that derives this step's duration, and the reserved anchor for future narration/TTS timing. **This is how you control pacing — there is no duration field anywhere in the schema.** |
| `hold?` | `Beat` | Extra hold after the step's animation finishes, before the next step. |
| `caption?` | `string` | Lower-third on-screen caption for this step. Not a transcript of `say` — use it for a key term. |

## Scene kinds

Every `Scene` is one of eleven kinds, discriminated by `kind`. Fields below
are IN ADDITION to `SceneBase`; step fields are IN ADDITION to `StepBase`.

#### `kind: "title"`
`title: string`, `subtitle?`, `chapter?` (eyebrow, e.g. `"Part 3"`),
`align?: "center" | "left"`. Single beat — no `steps` array.

#### `kind: "bullets"`
`heading?`, `bullets: BulletItem[]`. **Bullets ARE the steps** — no separate
`steps` array to keep in sync. `BulletItem`: `text`, `children?: string[]`
(sub-points revealed with the parent), `emphasis?: "none" | "strong"`.
Validator warns past ~7 bullets.

#### `kind: "code"`
`code: string` (source before step 1), `lang?`, `file?`, `lineNumbers?`
(default true), `steps: CodeStep[]`. `CodeStep`: `focus?: [start, end]`
(1-based inclusive — everything outside dims, camera frames the range),
`highlight?: string[]` (literal substrings inside the focused lines, not
regex), `code?` (replaces the source for this step, rendered as an animated
diff from what was on screen — this is why you split a walkthrough into
steps instead of just showing the final file), `typed?: boolean` (types the
source character-by-character), `annotate?: CodeAnnotation[]` (`{ line,
text, side? }`). Validator checks `focus`/`annotate[].line` against the
actual line count of whatever code is on screen at that step (not just the
scene's initial `code`), and warns past ~25 focused lines.

#### `kind: "terminal"`
`entries: TerminalStep[]`, `cwd?`, `user?`, `host?`, `title?` (defaults to
`cwd`), `prompt?: "$" | ">" | "#" | "❯"`. `TerminalStep`: `command?` (omit
for an output-only entry — a banner, a log tail), `output?`, `language?`,
`exitCode?` (renders a badge — 0 reads success, non-zero danger),
`spinner?` (label shown before `output` lands).

#### `kind: "diagram"` and `kind: "sequence"`
See **`references/diagrams.md`** — this is the highest-authoring-risk part
of the schema and has its own dedicated, prescriptive reference. Summary:
`DiagramScene` takes `preset`, `nodes`, `edges`, `groups?`, `layout?`,
`steps: DiagramStep[]` (`reveal?`, `connect?`, `flow?`, `focus?`,
`annotate?`); `SequenceScene` takes `participants`, `messages:
SequenceStep[]` (message or note, in both stacking AND reveal order).

#### `kind: "chart"`
`chart: ChartSpec` (see `references/data-display.md` for the full
per-chart-type shape), `title?`, `subtitle?`, `steps?: ChartStep[]` (omit
entirely for a single-beat scene that just draws the chart on). `ChartStep`:
`series?: string[]` (series/slice labels revealed this step — validated
against the chart's own labels), `callout?: { value, label, format? }` (a
counted-up number pulled out as a highlight), `focus?: string` (category
label to spotlight — **only meaningful for `bar`/`line`**; gauge/heatmap/
scatter/funnel have no "category" concept and the validator only builds a
category set for those two — see the known limitation below).

#### `kind: "stat"`
`heading?`, `stats: StatItem[]`, `columns?: 2 | 3 | 4 | 5 | 6` (default 4).
`StatItem`: `label`, `value?` (numeric, counted up from 0) OR `text?`
(non-numeric, e.g. `"Healthy"`) — validator warns if neither is set,
`format?: NumberFormat`, `delta?: number` (signed, vs. previous period),
`positiveIsGood?: boolean` (default true — set false for latency/error-rate
style metrics where an increase is bad news), `sparkline?: number[]`.

#### `kind: "compare"`
`mode?: "columns" | "wipe"` (default "columns"), `heading?`, `before`/
`after: ComparePane`, `say?` (narration for the reveal of `after`).
`ComparePane` is a discriminated union on `content`:
```ts
type ComparePane =
  | { content: "code"; label: string; code: string; lang?: string }
  | { content: "text"; label: string; text: string }
  | { content: "image"; label: string; src: string; alt?: string };
```

#### `kind: "walkthrough"`
`frame?: "browser" | "window" | "phone"` (default "browser"), `image`
(URL/data-URI), `url?` (browser chrome address bar), `title?`,
`steps: WalkthroughStep[]`. `WalkthroughStep`: `to?: {x,y}` (percent of
frame — cursor destination), `action?: "none" | "click" | "double-click" |
"drag"`, `type?` (text typed after the action lands), `spotlight?:
{x,y,width,height}` (percent-of-frame rect), `annotate?: string`. Positions
are **percentages, not pixels**, specifically so a step still points at the
right thing if `meta.size` changes.

#### `kind: "outro"`
`title?`, `subtitle?`, `links?: { label, url }[]`, `cta?`.

## Every field is a closed union or plain data — nothing that produces a broken frame

No scene or step field accepts `className`, `style`, a color, a frame count,
a pixel coordinate (diagram positions are grid units and optional, sequence
positions are entirely derived, walkthrough positions are percentages), or
an easing/duration name. Bumping the library version changes every video's
look with zero call-site edits — that is TODO.md's "stability over
customizability" in one sentence, and it's why `assertVideo` can promise "if
it validates, it renders" rather than "if it validates, it renders *and
looks reasonable*" — for diagram/sequence/chart node counts specifically,
also run the checklist in `references/diagrams.md`.

## The timing spine

```ts
function sceneSteps(scene: Scene): SequenceStepInput[];       // -> the step list buildSequence consumes
function sceneDuration(scene: Scene, fps: number): number;    // -> total frame length, floored at 1s
```

Both `VideoRoot` and `Presenter`/`useSteps` call **only** these two
functions to find out how long a scene is and where its step boundaries
fall — this is the single place that computation happens, so an MP4 and the
live click-through can never independently drift out of sync. You will not
normally call these yourself; they matter if you're building a custom
step-driven UI outside `Presenter` (see `useSteps` below).

## Rendering

```ts
// my-you-eye/video
function VideoRoot(props: { video: Video }): JSX.Element; // Remotion composition component. No className/style — every visual decision comes from video.meta.

// my-you-eye/present
function Presenter(props: { video: Video; className?: string; onStepChange?: (info) => void }): JSX.Element;
function SpeakerView(props: { video: Video; sceneIndex: number; stepIndex: number; className?: string }): JSX.Element;
function useSteps(video: Video, options?: { fps?: number; initialIndex?: number }): UseStepsResult;

// my-you-eye/present/player
function PlayerEmbed(props: { video: Video; className?: string; controls?: boolean; autoPlay?: boolean; loop?: boolean; acknowledgeRemotionLicense?: boolean }): JSX.Element;

// my-you-eye/scenes
function SceneRenderer(props: { scene: Scene }): JSX.Element; // the single Scene -> frame switch; you never write this switch yourself
```

- **`Presenter`** — click / `→` / `Space` advances a step, `←` reverses,
  `Esc` opens an overview grid, `f` toggles fullscreen. It's built entirely
  on `useSteps` — if you want your own chrome instead of Presenter's, use
  `useSteps` directly (it's headless: `steps`, `scenes`, `index`, `current`,
  `isFirst`/`isLast`, `next()`/`prev()`/`goTo()`/`goToScene()`).
- **`SpeakerView`** — a two-pane now/next + notes + elapsed-timer view, given
  the current `sceneIndex`/`stepIndex` (Presenter's own "Speaker view" popup
  button already wires this up; use it directly only if you're building
  custom presenter chrome).
- **`PlayerEmbed`** — scrubs the **exact** MP4 timeline (the real `VideoRoot`
  Remotion composition) inside a `<Player>` in the browser. This is the one
  export in the whole package that pulls in `remotion`/`@remotion/player` —
  it's on its own subpath specifically so `my-you-eye/present`'s default
  entry (`Presenter`/`SpeakerView`/`useSteps`) stays free of a video
  renderer for consumers who only want the live click-through.
- **`SceneRenderer`** — the `Scene → JSX` switch, exhaustive over all eleven
  kinds. You call this only if you're composing scenes into something other
  than `VideoRoot`/`Presenter` yourself; both of those already use it
  internally.

## Rendering to MP4

`VideoRoot` is a plain Remotion composition component, so rendering a `Video`
to a file is a stock Remotion project with one composition registered. This
is exactly what `apps/video` in this repo does — copy its shape:

```tsx
// src/Root.tsx
import { Composition } from "remotion";
import type { AnyZodObject } from "remotion";
import { VideoRoot, computeVideoDuration } from "my-you-eye/video";
import type { VideoRootProps } from "my-you-eye/video";
import { VIDEO_SIZES } from "my-you-eye/scenes";
import { video } from "./video";           // your own `Video` object
import "my-you-eye/styles.compiled.css";   // the pre-built stylesheet — see below

const fps = video.meta?.fps ?? 30;
const size = VIDEO_SIZES[video.meta?.size ?? "1080p"];

export const RemotionRoot = () => (
  // Explicit generic args: <Composition> infers its Props type from BOTH
  // `component` and `defaultProps`, and for a component with a required prop
  // that dual inference collapses to `Record<string, unknown>`. Naming
  // VideoRootProps here keeps the real type; the intersection satisfies the
  // index-signature constraint.
  <Composition<AnyZodObject, VideoRootProps & Record<string, unknown>>
    id="MyVideo"
    component={VideoRoot}
    durationInFrames={computeVideoDuration(video, fps)}
    fps={fps}
    width={size.width}
    height={size.height}
    defaultProps={{ video }}
  />
);
```

```tsx
// src/index.ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

```bash
npx remotion render MyVideo out/video.mp4
```

Three things that are easy to get wrong:

- **Never hardcode `durationInFrames`, `width` or `height`.** They come from
  `computeVideoDuration(video, fps)` and `VIDEO_SIZES[video.meta.size]`, the
  same two functions the presenter's timing spine uses. A hand-picked frame
  count silently truncates or pads the render the moment a step's narration
  changes length.
- **Styling is a plain CSS import, not a PostCSS/Tailwind build.** Importing
  `my-you-eye/styles.compiled.css` pulls in the already-compiled stylesheet
  (tokens + every utility the library's own components use). A Remotion
  project therefore needs **no** `remotion.config.ts` webpack override, no
  `postcss-loader`/`css-loader`/`style-loader`, and no Tailwind of its own.
  Use `my-you-eye/styles.css` (the Tailwind v4 source) only if you are
  compiling Tailwind in that project anyway for your own markup.
- **Run `assertVideo(video)` first.** See "Validate before you render" above —
  a render is the slowest possible place to discover a bad reference.

`VIDEO_SIZES`: `1080p` 1920×1080, `1440p` 2560×1440, `4k` 3840×2160,
`square` 1080×1080, `vertical` 1080×1920.

## Live-only interactivity

Diagram scenes support hover-to-highlight-edges / click-to-expand **only**
when rendered under `Presenter`, via `LiveInteractionContext` /
`useLiveInteraction` (re-exported from `my-you-eye/present`, defined in
`my-you-eye/scenes`). With no provider mounted — a static render, or a
Remotion/MP4 render — it's inert (`isLive: false`, every id `null`), so a
video and a plain static render of the same scene are byte-identical to a
render with the context present but unused. You don't need to do anything
to get this; it's automatic under `Presenter`.

## Worked example — a minimal, valid `Video`

```ts
import type { Video } from "my-you-eye/scenes";
import { assertVideo } from "my-you-eye/scenes";

const video: Video = {
  meta: { fps: 30, theme: "default", appearance: "dark" },
  scenes: [
    { kind: "title", title: "How the scheduler works", subtitle: "Part 3" },
    {
      kind: "code",
      lang: "ts",
      file: "scheduler.ts",
      code: "function schedule(job) {\n  queue.push(job);\n  drain();\n}",
      steps: [
        { say: "Jobs land in a queue.", focus: [1, 2] },
        { say: "Then we drain it.", focus: [3, 3] },
      ],
    },
    { kind: "outro", title: "Thanks for watching", cta: "Subscribe for part 4" },
  ],
};

assertVideo(video); // throws with a precise path if anything above is wrong
```

## Known limitations (verified against source — not speculative)

- **`ChartStep.focus` only dims `bar`/`line` categories.** Gauge, heatmap,
  scatter, and funnel have no comparable "category" concept, and
  `validate.charts.ts` only builds a category set for `bar`/`line` — setting
  `focus` on a step for any other chart type is accepted (it's a plain
  string field) but has no dimming effect on the rendered chart.
- **`DiagramScene` does not auto-fit its `Canvas` viewport to content** — it
  starts at pan `(0,0)`, zoom `1`. A large or off-origin diagram may render
  partially out of view; pan/zoom manually if you're viewing it live, or
  keep diagrams compact (see `references/diagrams.md`'s node-count rule).
- **`SequenceScene`'s derived activation bars have no call-stack depth** — a
  bar closes on the participant's next outgoing message, whether or not
  that message is a genuine reply to the one that opened it. A participant
  with overlapping concurrent calls won't show nested activation bars.

# Motion — frame-driven animation primitives

`my-you-eye/motion` is a set of ~20 animation primitives that are pure
functions of a `progress` (or `frame`) value supplied by a driver — never of
wall-clock time. The same primitive renders identically inside a live DOM
preview and inside a Remotion MP4 render, because it never knows which one
it's running in.

You will rarely need this file directly if you're authoring a video through
`my-you-eye/scenes` (see `references/scenes.md`) — the scene templates
already wire motion primitives up for you. Reach for this file when you're
building a **custom** animated component that scenes don't cover, or a
motion-driven UI outside the video system entirely (a live dashboard, an
onboarding tour, etc.).

## Two subpaths — know which one you're importing

| Subpath | Contains | Imports `remotion`? |
|---|---|---|
| `my-you-eye/motion` | Every primitive, `MotionRoot`, `DomDriver`, `useTimeline`, `useProgress`, `useSequence`, `Timing` types | **No** — safe for any consumer, including one with no video renderer installed |
| `my-you-eye/motion/remotion` | `RemotionDriver` only | Yes — this is the one file allowed to |

```tsx
import { Reveal, MotionRoot, useTimeline } from "my-you-eye/motion";
import { RemotionDriver } from "my-you-eye/motion/remotion"; // only inside a Remotion composition
```

Never import `my-you-eye/motion/remotion` in code that also needs to run
outside a Remotion render (a plain browser app, a live presentation) — that
pulls Remotion into a bundle that doesn't need it. Live/DOM mode uses
`DomDriver`, which `MotionRoot mode="live"` already mounts for you.

## The driver model

Every primitive reads time through `useTimeline()` — never `useCurrentFrame()`
(Remotion), never `Date.now()`/`setTimeout`, never a CSS `transition`/
`@keyframes`. `MotionRoot` is the one place that decides which driver is
live:

```tsx
<MotionRoot mode="live" fps={30} autoPlay>
  <Reveal from="up">Hello</Reveal>
</MotionRoot>

// vs., inside a Remotion composition:
<MotionRoot mode="video" driver={RemotionDriver}>
  <Reveal from="up">Hello</Reveal>
</MotionRoot>
```

`useTimeline()` returns `{ frame, fps, durationInFrames }`. You will rarely
call it directly — `useProgress()` (below) is what primitives actually use.

## `Timing` — the one prop shape every primitive accepts

```ts
type Timing =
  | { delay?: Beat; duration?: Beat; easing?: EasingName; spring?: never }
  | { delay?: Beat; duration?: Beat; spring?: SpringName; easing?: never };

type Beat = "instant" | "quick" | "normal" | "slow" | number; // number = raw frames
type EasingName = "linear" | "standard" | "in" | "out";
type SpringName = "gentle" | "snappy" | "bouncy";
```

`easing` and `spring` are mutually exclusive **at the type level** — passing
both is a compile error, not just a convention. `Beat` prefers the four
semantic names (mapped to seconds internally: instant=0.15s, quick=0.3s,
normal=0.5s, slow=0.9s, independent of `fps`) — a raw frame number is an
escape hatch, not the documented path. Every primitive spreads `Timing` into
its own props (`<Reveal delay="quick" duration="normal">`).

`useProgress(timing)` is the single place frame→progress (0→1) conversion
happens: clamped to exactly 0 before `delay` elapses and exactly 1 at/after
`delay + duration`; a spring may overshoot past 1 or dip below 0 **between**
those two points (that's the point of `spring: "bouncy"`), but always
settles at a stable 0 or 1 at the ends.

## Pacing — `useSequence` / `buildSequence`

```ts
function buildSequence(steps: SequenceStepInput[], fps: number, pace?: Pace): Record<string, SequenceRange>;
function useSequence(steps: SequenceStepInput[], pace?: Pace): Record<string, SequenceRange>; // reads fps via useTimeline()

interface SequenceStepInput {
  name: string;
  frames?: number;    // escape hatch: explicit frame count, skips content-derived timing
  content?: string;   // text whose length estimates a natural duration
  hold?: Beat;         // extra hold appended after the computed duration
}
type Pace = "slow" | "normal" | "fast"; // chars/sec: 14 / 22 / 32, minimum 0.6s per step
```

This is the shared spine `my-you-eye/scenes` uses internally
(`sceneSteps`/`sceneDuration` — see `references/scenes.md`) so an MP4 render
and the live Presenter never drift in pacing. If you're building a custom
step-driven animation outside the scene system, `useSequence` is the same
tool: give it named steps with `content` (for automatic pacing) or explicit
`frames`, get back `{ [name]: { startFrame, endFrame } }`.

## The `progress`-in convention (how `src/ui/` and motion meet)

`src/ui/` primitives (charts, `SequenceDiagram`, `Annotation`, `ConnectionLine`,
etc.) never import `my-you-eye/motion` — that boundary is structural (motion
must stay child-agnostic; `src/ui/` must stay renderer-agnostic). Instead,
any `src/ui/` component that can animate accepts a plain
`progress?: number` prop (0→1, omitted = `1` = fully drawn) and is a pure
function of it — no internal timers, no motion import:

```tsx
// src/ui/ — pure, no motion import
<BarChart series={series} categories={categories} progress={0.4} />

// the wiring — usually inside a scenes-tier component, but you can do this
// yourself for a custom component:
import { useProgress } from "my-you-eye/motion";
<BarChart series={series} categories={categories} progress={useProgress({ duration: "normal" })} />
```

This is why `CodeDiff` — which knows about `CodeBlock`'s highlight engine —
lives in `my-you-eye/scenes`, not `my-you-eye/motion`: motion primitives are
generic wrappers around `ReactNode`; anything that needs to know about a
specific `src/ui/` component's internals belongs in the scenes tier instead.

## Primitives

Every primitive spreads `Timing`. Colors are always a closed union
(`MotionColor = "primary" | "success" | "warning" | "danger" | "fg" |
"muted"`), never an arbitrary CSS color; distances/blur are closed
`DistanceToken`/`BlurToken` unions (`"sm" | "md" | "lg"`, grid-unit
multiples), never raw px. Motion primitives DO accept `className` (they are
not scene-schema data — see the stability-contract note at the end of this
file).

### Entrance / reveal

| Component | Key props | Notes |
|---|---|---|
| `Reveal` | `from: "fade"\|"up"\|"down"\|"left"\|"right"\|"scale"\|"blur"`, `distance`, `asChild`, `as` | `asChild` merges the animated style onto the single child instead of wrapping it in a `<div>` — use it whenever the child is inside a flex/grid parent that a wrapper box would break. |
| `Stagger` | `each: Beat` (default "quick"), `from: "first"\|"last"\|"center"`, `revealFrom`, `distance` | Orchestrates a per-child `Reveal`. Renders a `Fragment`, no wrapper element. |
| `Wipe` | `direction: "left"\|"right"\|"up"\|"down"`, `variant: "linear"\|"radial"` | `clip-path` reveal. |
| `Draw` | `d` (SVG path), `viewBox`, `color`, `strokeWidth: "sm"\|"md"\|"lg"` | `stroke-dashoffset` reveal, normalized via `pathLength`, so it's resolution-independent. Pairs with `ConnectionLine`/`ConnectionLayer` edges. |
| `Unmask` | direction + softness (see showcase) | Soft-edged mask sweep, for headings/pull-quotes. |

### Attention

| Component | Key props | Notes |
|---|---|---|
| `Spotlight` | `focus: {x,y,width,height}`, `feather: BlurToken`, `dim` (0–1, default 0.7) | Dims everything except a rect. Box-shadow trick, never `backdrop-filter` (Canvas performance contract). |
| `Pulse` | `loop?: number` (omit = infinite) | Looping scale/opacity breathing, a pure function of `frame % period`. |
| `Shake` | `axis: "x"\|"y"\|"rotate"`, `cycles` (default 6), `seed` | Deterministic jitter — same `seed` always shakes identically. |
| `Ripple` | `x`, `y`, `color`, `size: DistanceToken` | Expanding fading ring at a point. Used internally by `Cursor` on click. |
| `Trace` | `d`, `viewBox`, `count`, `spacing` (0–1 fraction of path), `loop` (default true), `shape: "dot"\|"square"`, `color`, `size` | **The data-flow primitive.** One or more tokens travelling along a path — this is what a diagram scene's `flow` step animates. |

### Camera

| Component | Key props | Notes |
|---|---|---|
| `Camera` | `keyframes: { at: frame, focus: rect \| elementId, zoom? }[]`, `fit` (default true) | Pan + zoom over `children` via GPU-composited `transform` only (translate + scale), never top/left/width/height. `focus` as an element id is measured via `offsetLeft`/`offsetTop` (not `getBoundingClientRect()` — see `src/motion/camera/measure.ts`'s own comment: that method is invariant to an ancestor's CSS transform, `getBoundingClientRect()` is not, and a previous batch shipped exactly that bug). |

### Text & code

| Component | Key props | Notes |
|---|---|---|
| `TypeText` | `text`, `mode: "char"\|"word"\|"line"`, `cursor`, `blinkRate`, `preserveLayout` (default true) | Inherits typography from context (never hardcodes a font). `preserveLayout` reserves the fully-typed box size up front so nothing reflows while typing. |
| `Highlight` | `mode: "fill"\|"underline"\|"box"\|"glow"\|"strike"`, `color`, `as: "span"\|"div"` | Inline by default (`span`) so it drops into running text. |
| `CountUp` | `from` (default 0), `to`, `format: "number"\|"percentage"\|"bytes"\|"duration"\|"currency"\|"signed"`, `formatOptions` | Reuses `src/lib/format.ts` — the exact formatter `CellType` uses — so a count-up number is never independently reimplemented/inconsistent with a static one. |
| `TextSwap` | `from`, `to`, `mode: "fade"\|"roll"` | Cross-fade or odometer-roll between two strings; a hidden sizer spans the longer string so nothing reflows. |
| `Caption` | `text`, `subtitle`, `position: "bottom-left"\|"bottom-center"\|"bottom-right"` | Timed lower-third text. Requires a `position: relative` ancestor. |

### Structural

| Component | Key props | Notes |
|---|---|---|
| `Slide` | `direction: "left"\|"right"\|"up"\|"down"`, `mode: "in"\|"out"` | Real static clipping parent + an inner translating element (the old bug: `overflow:hidden` on the element that's itself translating does nothing). |
| `Morph` | `from`/`to: { x, y, width?, height?, opacity? }` | FLIP-style interpolation between two **caller-supplied** snapshots — not a full auto-diffing FLIP engine (a frame-driven primitive can't measure two renders' layout the way real FLIP does). |
| `Cursor` | `events: { at: frame, x, y, action?: "click"\|"dblclick"\|"drag"\|"type", text? }[]`, `color` | Fake pointer for simulated UI walkthroughs; renders a `Ripple` on `click`. |
| `Beat` | `hold?: Beat` | A no-op — renders children unchanged. Its entire purpose is being a self-documenting "nothing animates here on purpose" placeholder in a step sequence. |

## Worked example

A custom stat callout, entrance + count-up, driven live:

```tsx
import { MotionRoot, Reveal, CountUp } from "my-you-eye/motion";

function Callout() {
  return (
    <MotionRoot mode="live" fps={30} autoPlay>
      <Reveal asChild from="up" duration="quick">
        <div className="rounded-ui border border-border p-panel">
          <CountUp to={4213} format="number" delay="quick" duration="slow" />
        </div>
      </Reveal>
    </MotionRoot>
  );
}
```

Inside a Remotion composition, swap the `MotionRoot` line for:

```tsx
import { MotionRoot } from "my-you-eye/motion";
import { RemotionDriver } from "my-you-eye/motion/remotion";

<MotionRoot mode="video" driver={RemotionDriver}>
  {/* identical children */}
</MotionRoot>
```

Nothing else changes — that's the point of the driver abstraction (TODO.md
D2): every primitive downstream is a pure function of `useTimeline()`, so it
never knows or cares which branch ran.

## Stability contract, for this tier

Motion primitives are **not** scene-schema data — they're ordinary
components, so they DO accept `className` for layout (same convention as
`src/ui/`: variant-like props (`from`, `mode`, `axis`, ...) for behavior,
`className` only for one-off layout). What stays closed is color
(`MotionColor`), distance (`DistanceToken`), blur (`BlurToken`), and easing/
spring (`EasingName`/`SpringName`) — always a named union, never an arbitrary
CSS value passed through `style`.

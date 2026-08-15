# Diagrams — architecture, dataflow, state, flowcharts, sequence diagrams

Read this before writing a single node. The repo owner's own framing for why
this file exists:

> "Usually cheaper models tend to create nodes, and just wire up the lines
> without any care about how it will look like at the end."

This file is prescriptive, not advisory. The rules are numbered. Follow them
in order. The checklist at the bottom is runnable — run it, don't eyeball it.

There are two ways to build a diagram in this library. Pick the first one
unless you have a specific reason not to.

| You are... | Use | Import from |
|---|---|---|
| Authoring a video/presentation scene | `DiagramScene` / `SequenceScene` **data** (a plain object) | `my-you-eye/scenes` |
| Building a diagram inside a normal React app (no video, no steps) | `Canvas` + `GraphNode` + `ConnectionLayer` + `GraphGroup` + `Annotation` directly | `my-you-eye` |

The scene-data path is the one that makes the "wired up without care" failure
mode structurally hard: node coordinates are optional grid units, group boxes
are computed, and a runtime validator catches broken references before you
ever look at a frame. Reach for the raw primitives only when you are not
authoring a `Video` at all.

---

## Part 1 — `DiagramScene` / `SequenceScene` data (`my-you-eye/scenes`)

A diagram scene is data, not JSX:

```ts
import type { Scene } from "my-you-eye/scenes";

const scene: Scene = {
  kind: "diagram",
  preset: "architecture",
  nodes: [ /* DiagramNode[] */ ],
  edges: [ /* DiagramEdge[] */ ],
  groups: [ /* DiagramGroup[] */ ],   // optional
  steps: [ /* DiagramStep[] */ ],
};
```

`SceneRenderer` (`my-you-eye/scenes`) turns any `Scene` into a frame. You
never call `DiagramScene`/`SequenceScene` the React components directly in a
video — you write the data and let `SceneRenderer`, `VideoRoot`, or
`Presenter` render it.

### Rules

**1. Omit `x`/`y`. Let `layered()`/`grid()` place the node.**

`DiagramNode.x`/`DiagramNode.y` are optional, and each axis is independent —
pin `x` and leave `y` computed if you genuinely need to. When omitted,
`DiagramScene` resolves every node's position via `layered()` (DAG ranking +
barycenter crossing-reduction) or `grid()` (row-major), picked by the
preset's default layout (or your `layout` override). This is not a fallback
for lazy authors — it is the mechanism that keeps a diagram from reading as
chaotic. Only set `x`/`y` when a node has to sit somewhere the algorithm
can't infer (e.g. pinning an external actor to the far left).

**2. When you do pin a coordinate, it is a grid unit — an integer.**

```ts
// DiagramNode
x?: number;  // grid units (× 16px internally), NOT pixels
y?: number;
```

Write whole numbers (`x: 4`, not `x: 4.5` or `x: 64`). The scene layer
converts your grid unit to pixels and snaps it to the grid
(`snap(x * GRID)`, `GRID = 16`) before handing it to the underlying
`GraphNode`, so a fractional value doesn't buy you finer control — it just
means you don't know what you'll get. **Do not confuse this with the raw
`GraphNode.x`/`GraphNode.y` in Part 2 below, which ARE pixels.** That
mismatch — pasting a `DiagramScene` grid-unit value into a raw `GraphNode`,
or vice versa — is a common cross-tier mistake.

**3. Edge `kind` carries meaning. Pick it deliberately.**

```ts
kind?: "sync" | "async" | "data" | "error";  // default "sync" (or "data" under the "dataflow" preset)
```

`kind` changes the rendered stroke (color + dash pattern) independently of
`route`, and it also picks the color of any `Trace` token animated along that
edge during a `flow` step. Do not leave every edge as the default "sync"
because it was easiest — a request/response call, a fire-and-forget event, a
data pipe, and a failure path should not look identical. If you don't know
which kind an edge is, that's a sign you haven't decided what the edge means.

**4. `route` defaults from the preset. Only override a specific edge.**

```ts
route?: "orthogonal" | "bezier" | "stepped" | "straight";
```

Each `preset` already picks a sensible default route for its whole diagram
(architecture/dataflow → orthogonal, state → bezier, flowchart → stepped).
Setting `route` per-edge is an escape hatch for the one edge that reads badly
with the preset's default, not something to set on every edge.

**5. Groups get no geometry. Ever.**

```ts
interface DiagramGroup {
  id: string;
  label: string;
  border?: "dashed" | "solid";
}
```

There is no `x`/`y`/`width`/`height` on `DiagramGroup` — deliberately. A
group's rectangle is computed from the bounding box of its member nodes (the
nodes whose `group` field names it), padded by one grid unit. You cannot
draw a boundary region in the wrong place or leave a node hanging outside it,
because you never draw it at all — you just declare membership:

```ts
nodes: [{ id: "api", label: "API", group: "vpc" }, ...],
groups: [{ id: "vpc", label: "VPC" }],
```

A group with no member nodes is silently omitted (there is nothing to
bound) — that is not a bug, it's the intended behavior for a group you
declared but haven't assigned any node to yet.

**6. Past about a dozen nodes, split the diagram.**

The validator (`validateVideo`) warns once a single diagram scene passes 12
nodes: *"N nodes is a lot for one diagram — consider splitting past ~12."*
Treat that warning as a real limit, not a suggestion to silence. Split by:
- **Steps** — reveal a subset of nodes per step (rule 7) instead of showing
  the whole graph from frame 1.
- **Scenes** — a "zoomed out" architecture scene followed by one or more
  "zoomed in" scenes for the busy sub-systems, each its own `DiagramScene`.

**7. Reveal nodes and edges across steps. Don't show everything at once.**

```ts
interface DiagramStep {
  reveal?: string[];   // node/group ids that appear on this step
  connect?: string[];  // edge ids whose line draws on this step
  flow?: string[];     // edge ids that animate a token for this step's duration
  focus?: string[];    // node/group ids to spotlight — everything else dims
  annotate?: DiagramAnnotation[];
}
```

**Anything never named in any step's `reveal` is present from the first
frame.** That is the trap: if you write a 6-node diagram and a `steps` array
that never mentions half the node ids, those nodes are simply always on
screen — nothing "reveals" them, because you never asked. To build up a
diagram progressively, name every node (and group) in the step where it
should first appear, and every edge id in `connect` for the step where that
connection should draw on. Use `flow` for the "watch a request travel"
beat — it's a separate animated token, independent of whether the edge is
also `connect`-ing that same step.

**8. Label edges only where the label adds information.**

A `label` on an edge costs canvas space, and `ConnectionLayer`'s
`autoLabelPlacement` has to search for a spot clear of every other edge's
path to place it. An edge whose `kind` already reads as "the auth check" (a
`sync` call from `gateway` to `auth`) doesn't need a label repeating that.
Reserve labels for the cases a shape/color can't carry — a specific payload
name, a protocol, a status code.

**9. An edge's id defaults to `"<from>-><to>"`. Only set an explicit `id`
when two edges share the same node pair.**

```ts
interface DiagramEdge {
  id?: string;
  from: string;
  to: string;
  // ...
}
```

Reference an edge from a step's `connect`/`flow` using that derived form
(`"api->queue"`) unless you set `id` explicitly. You only need an explicit
`id` to disambiguate two edges between the same two nodes (a request edge and
a separate reply edge, say) — setting one on every edge is unnecessary
noise.

**10. Pick the `preset` that matches your content; don't hand-tune around a
mismatched one.**

| Preset | Node shape | Default route | Default layout | Edge `kind` default |
|---|---|---|---|---|
| `architecture` (default) | box | orthogonal | layered, left→right | sync |
| `dataflow` | box | orthogonal | layered, left→right | data |
| `state` | pill | bezier | grid | sync |
| `flowchart` | box | stepped | layered, top→bottom | sync |

If you're fighting the defaults on every edge, you likely picked the wrong
preset rather than found a genuine exception.

**11. `layout` is a per-scene override, not a per-node one.**

```ts
layout?: "layered-horizontal" | "layered-vertical" | "grid";
```

This overrides the preset's placement strategy for every node in the scene
that didn't pin its own `x`/`y`. There is no per-node layout choice — a
diagram is one algorithm applied once, plus individual pins where you
genuinely need them.

### `SequenceScene` rules

**12. Message order is both the vertical order and the reveal order.**

```ts
interface SequenceScene {
  kind: "sequence";
  participants: SequenceParticipantSpec[];
  messages: SequenceStep[];  // ordered — array order IS diagram order IS reveal order
}
```

There is no separate "layout order" to get out of sync with "reveal
order" — they're the same array. Write `messages` in the order the
interaction actually happens.

**13. Activation bars are derived. You cannot author them.**

A participant is "busy" (its activation bar is drawn) from the message that
reaches it until the next message it sends back out. There is no
`activations` field on the schema-level `SequenceScene` — this is
intentional: a call-stack you hand-author drifts from the messages the
moment you edit one without the other.

**14. `to === from` draws a self-call loop.** Use it for a participant
calling its own method, not as a workaround for "I don't have a second
participant yet."

**15. Use `kind: "data"` for a reply/return and `kind: "error"` for a
failure path.** Default is `"sync"`. This is what makes a sequence diagram
readable at a glance instead of requiring the viewer to read every label.

---

## Part 2 — Raw `src/ui/` primitives (`my-you-eye`, non-scene apps)

Use this path only outside the video/presentation system — a regular React
app that wants an interactive graph editor, a static architecture panel,
etc. `Canvas`, `GraphNode`, `ConnectionLine`/`ConnectionLayer`, `GraphGroup`,
`Annotation`, and `SequenceDiagram` are ordinary `src/ui/` components: they
take `className` (unlike scenes — see the stability-contract note at the
bottom of this file), and **you are responsible for layout** unless you use
the exported layout helpers.

```tsx
import { Canvas, GraphNode, ConnectionLayer, layered } from "my-you-eye";
import type { ConnectionLayerEdge } from "my-you-eye";

const nodes = [{ id: "api" }, { id: "queue" }, { id: "worker" }];
const edges = [{ from: "api", to: "queue" }, { from: "queue", to: "worker" }];

// layered()/grid()/countCrossings are exported from the MAIN entry
// ("my-you-eye"), not from "/scenes" — they're generic layout math, usable
// standalone. Positions come back in PIXELS (already snapped to the grid),
// unlike DiagramNode.x/y (Part 1), which are grid units.
const positions = layered(nodes, edges); // -> [{ id, x, y }] in px

const byId = new Map(positions.map((p) => [p.id, p]));

<Canvas className="h-[480px]">
  {nodes.map((n) => (
    <GraphNode key={n.id} x={byId.get(n.id)!.x} y={byId.get(n.id)!.y} header={n.id} />
  ))}
  <ConnectionLayer
    edges={edges.map((e): ConnectionLayerEdge => ({
      id: `${e.from}->${e.to}`,
      from: { x: byId.get(e.from)!.x + 80, y: byId.get(e.from)!.y + 16 },
      to: { x: byId.get(e.to)!.x, y: byId.get(e.to)!.y + 16 },
      kind: "sync",
      arrowhead: true,
    }))}
  />
</Canvas>
```

### Rules

**16. `GraphNode.x`/`GraphNode.y` are pixels, already a `GRID` (16)
multiple.** Never pass an unsnapped value — use `snap()` from
`graph-node/grid.ts`-equivalent math, or just consume `layered()`/`grid()`'s
output directly, which is already snapped.

**17. Render every `GraphGroup` before the `GraphNode`s/`ConnectionLayer`
it should sit beneath, in JSX order.** `GraphGroup` has no z-index — stacking
is DOM order (see `GraphGroup`'s own doc comment). Nest groups by rendering
the outer (larger) one first, inner ones after.

**18. Use `ConnectionLayer` (one `<svg>`, many edges), not N standalone
`ConnectionLine`s, once you have more than a couple of edges.**
`ConnectionLine` renders one full-size stacked `<svg>` per edge — fine for
one or two edges, a real layout/z-order cost for a dozen. `ConnectionLayer`
also gets you parallel-edge bundling and label-placement search for free.

**19. `ConnectionLine`/`ConnectionLayer`'s `kind` union is the same four
values as the scene schema** (`sync`/`async`/`data`/`error`) — reuse it the
same way; it isn't a different vocabulary at this tier.

**20. Count crossings before shipping a heavily hand-pinned layout.**
`countCrossings(layers, edges)` (exported from `my-you-eye`) takes layers as
`string[][]` (node ids grouped by rank), not raw positions — group
`layered()`'s output by its main-axis coordinate to build that shape. See
`scripts/prove-layout-crossings.mjs` in this repo for the exact pattern. In
practice: if you let `layered()` place nodes (rule 1 / rule 16 preamble),
crossing-reduction already ran for you — this check matters only when you've
pinned enough coordinates by hand that the algorithm no longer has room to
optimize.

---

## Worked example — correct

A 5-node architecture diagram, revealed over 3 steps, one dataflow token:

```ts
import type { Scene } from "my-you-eye/scenes";

const scene: Scene = {
  kind: "diagram",
  preset: "architecture",
  title: "Request path",
  nodes: [
    { id: "client", label: "Client" },
    { id: "gateway", label: "API Gateway" },
    { id: "auth", label: "Auth Service", group: "core" },
    { id: "orders", label: "Orders Service", group: "core" },
    { id: "db", label: "Postgres", sublabel: "primary" },
  ],
  edges: [
    { from: "client", to: "gateway" },
    { from: "gateway", to: "auth", label: "verify" },
    { from: "gateway", to: "orders", kind: "async" },
    { from: "orders", to: "db", kind: "data" },
  ],
  groups: [{ id: "core", label: "Core services" }],
  steps: [
    { say: "A client calls the gateway.", reveal: ["client", "gateway"], connect: ["client->gateway"] },
    { say: "The gateway checks auth, then hands off to Orders.", reveal: ["core", "auth", "orders"], connect: ["gateway->auth", "gateway->orders"] },
    { say: "Orders reads from Postgres.", reveal: ["db"], connect: ["orders->db"], flow: ["orders->db"] },
  ],
};
```

Notice: no node has `x`/`y` — `layered()` places all five. No edge sets
`route` — the `architecture` preset's orthogonal default is correct for all
four. Only the two edges that need semantic distinction set `kind`. Only one
edge carries a `label` (`"verify"` — the others are self-explanatory from
node names).

## Worked example — wrong vs. right

**Wrong** — the failure mode this file exists to prevent:

```ts
// ✗ Pixel coordinates copy-pasted from nowhere in particular. Not grid
//   units, not integers, and every node dumped onto the screen at once with
//   no steps at all — the diagram shows everything from frame 1, which
//   means nothing is ever revealed and the video reads as a screenshot.
nodes: [
  { id: "a", label: "A", x: 123.4, y: 87 },
  { id: "b", label: "B", x: 340.9, y: 12 },
  { id: "c", label: "C", x: 12, y: 250.1 },
],
edges: [
  { from: "a", to: "b" },  // kind omitted everywhere — every edge looks identical
  { from: "b", to: "c" },
  { from: "a", to: "c" },
],
steps: [{ say: "Here's the system." }],  // reveal/connect never set
```

**Right:**

```ts
nodes: [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
],
edges: [
  { from: "a", to: "b", kind: "sync" },
  { from: "b", to: "c", kind: "async" },
  { from: "a", to: "c", kind: "error", label: "timeout fallback" },
],
steps: [
  { say: "A calls B synchronously.", reveal: ["a", "b"], connect: ["a->b"] },
  { say: "B fires an event to C.", reveal: ["c"], connect: ["b->c"] },
  { say: "If B times out, A falls back to C directly.", connect: ["a->c"] },
],
```

Both diagrams have the same three nodes and three edges. Only the second one
is legible: no coordinates to get wrong, distinct edge kinds, and a
three-beat reveal instead of a wall of lines.

---

## Pre-flight checklist — run this before calling a diagram scene done

1. **Run the validator.** `assertVideo(video)` (or `validateVideo(video)` to
   inspect without throwing) from `my-you-eye/scenes`. Zero errors. Read
   every warning, not just errors — a "12 nodes is a lot" or "N bullets is a
   lot" warning is the library telling you it will render but read badly.
2. **Count the nodes** in each `diagram` scene. Over ~12 → split across
   steps (rule 7) or across scenes (rule 6).
3. **Grep your own `steps` array for every id you wrote** in `reveal`,
   `focus`, `connect`, `flow`, and `annotate[].target`, and confirm each one
   is either a `nodes[].id`, a `groups[].id`, or an edge id
   (`edges[].id` or the derived `"<from>-><to>"`). The validator catches
   this too (`validate.diagram.ts`'s reference-integrity checks) — this step
   is about catching it while you're still writing, not after.
4. **Check every node ends up revealed somewhere**, unless you deliberately
   want it present from frame 1. A node/group id that never appears in any
   step's `reveal` is NOT an error — it's just always on screen. Confirm
   that's what you intended.
5. **Read the edge list back and ask "what kind is each one?"** If you can't
   answer without checking, you left every edge on the "sync" default when
   some of them are actually async/data/error. Fix before moving on.
6. **Count how many edges carry a `label`.** If it's close to "every edge",
   go back and ask whether the `kind` + node names already say it.
7. **For a `sequence` scene:** read `messages` top to bottom as a transcript
   of the interaction. If the order reads wrong, fix the array order — there
   is no other order to fix.
8. **If you hand-pinned more than one or two node `x`/`y` values,** re-read
   rule 20 and sanity-check crossings, or better, remove the pins and let
   `layered()`/`grid()` place them.

---

## The stability contract, for this file specifically

`DiagramScene`/`SequenceScene` **data** (`DiagramNode`, `DiagramEdge`,
`DiagramGroup`, `DiagramStep`, everything in `my-you-eye/scenes`) accepts
**no** `className`, `style`, colors, pixel positions, or frame counts — only
plain data and closed unions (`kind`, `route`, `preset`, `layout`). That is
what makes "wire it up without caring how it looks" structurally
unreachable: there is no styling surface to misuse.

The **raw `src/ui/` diagram primitives** described in Part 2
(`GraphNode`, `ConnectionLine`, `ConnectionLayer`, `GraphGroup`,
`Annotation`, `SequenceDiagram`, `Canvas`) are ordinary components and DO
accept `className` for layout, same as every other `src/ui/` component —
that's the documented `src/ui/` contract (variant props for behavior,
`className` only for one-off layout), and it is *not* a contradiction of the
scenes-tier rule above. Two different tiers, two different contracts — do
not import scene-schema habits into a raw-primitive app, or vice versa.

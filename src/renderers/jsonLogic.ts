/**
 * Pure JSON-tree-building logic for `JsonView.tsx`'s Rendered mode — split
 * out so the component file only exports the component (matches this
 * repo's convention: pure logic lives beside the component it serves, not
 * exported out of it — see `src/git/syncStatus.ts`, `src/git/mergeLogic.ts`,
 * `src/git/commitTemplate.ts`, `src/share/sharePolicy.ts`,
 * `src/share/shareLinks.ts`, `src/share/shareIndicators.ts`). Unit-tested
 * directly by `tests/unit/rendererBigFileCaps.test.ts`.
 *
 * DESIGN-SPEC Amendments item 33: big-file safety. Measured baseline (SSR
 * render via `react-dom/server`, see `tests/unit/rendererBigFileCaps.test.ts`)
 * — a flat 20,000-item JSON array built ~1.94M DOM nodes and took ~28s to
 * render, while a 3,000-level-deep single-child chain rendered in 32ms at 8
 * nodes. That gap is because `TreeView`'s own `renderNodes` (my-you-eye
 * source) only puts a node's children into the DOM when that node is
 * expanded — depth alone was never the danger; BREADTH is, because every
 * sibling at a materialized level renders unconditionally.
 *
 * So this module builds the `TreeNode[]` tree itself, lazily, instead of
 * handing `TreeView` a fully-materialized document up front:
 *  - `TreeView` runs in CONTROLLED mode (`expandedKeys`/`onToggle`, own
 *    `openIds` state, held by `JsonView.tsx`) instead of its
 *    `defaultExpandedDepth` uncontrolled default.
 *  - `EAGER_DEPTH` (3, same number the old `defaultExpandedDepth` used —
 *    keeps small-file behavior identical) is how many levels get real
 *    children built up front; anything deeper gets a single placeholder
 *    child (just enough for the expand chevron to show) until the user
 *    actually opens it, at which point `buildNode` is called for that
 *    subtree for the first time — collapsed subtrees are never walked.
 *  - `MAX_CHILDREN_PER_LEVEL` (200) caps any object/array's children,
 *    wherever they get built (eager or on-demand), with a trailing
 *    informational "+N more" leaf — this is what actually bounds the
 *    measured wide-array case above.
 *  - `MAX_TOTAL_NODES` (3000) is a second, global ceiling shared across the
 *    whole build (a `budget` counter threaded through the recursion): a
 *    document that's bushy at MULTIPLE eager levels at once (e.g. 200
 *    children at depth 0, each with 200 more at depth 1) multiplies the
 *    per-level cap instead of adding it — measured directly (see
 *    `tests/unit/rendererBigFileCaps.test.ts`), a 200-wide/3-level-bushy
 *    document is 8,000,000+ leaves and OOMs Node just to `JSON.stringify`
 *    it, so per-level capping alone isn't sufficient once more than one
 *    eager level is wide. The budget stops descending the moment it's
 *    spent, converting whatever's left at that point into a "not shown"
 *    leaf instead of recursing further — an absolute bound independent of
 *    the document's shape.
 */
import type { TreeNode } from "my-you-eye";

export const EAGER_DEPTH = 3;
export const MAX_CHILDREN_PER_LEVEL = 200;
export const MAX_TOTAL_NODES = 3000;
/** Bullet marker keeps synthetic ids out of the way of real dotted-path
 * object keys, which can be any string but won't realistically contain it. */
const MORE_MARKER = "•more";
const PLACEHOLDER_MARKER = "•more-pending";

/** Mutable counter threaded through a single build pass — see
 * `MAX_TOTAL_NODES` above. Not state: it's reset and consumed synchronously
 * within one `buildChildren`/`collectDefaultOpen` call tree. */
interface Budget {
  remaining: number;
}

function cellTypeFor(value: unknown): "text" | "number" | "boolean" | "null" {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "text";
  }
}

export function entriesOf(value: unknown): [string, unknown][] | null {
  if (Array.isArray(value)) return value.map((v, i): [string, unknown] => [String(i), v]);
  if (value !== null && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return null;
}

function moreNode(parentId: string, remaining: number): TreeNode {
  return {
    id: `${parentId}.${MORE_MARKER}`,
    label: "",
    value: { type: "text", value: `+${remaining} more not shown` },
  };
}

function placeholderNode(parentId: string): TreeNode {
  return { id: `${parentId}.${PLACEHOLDER_MARKER}`, label: "", value: { type: "text", value: "" } };
}

/** Truncates `entries` to `MAX_CHILDREN_PER_LEVEL` AND to whatever's left of
 * `budget`, builds a real node for each visible one, and appends a single
 * informational "+N more" leaf covering everything left out either way. */
function buildChildren(
  entries: [string, unknown][],
  parentId: string,
  depth: number,
  openIds: Set<string>,
  budget: Budget,
): TreeNode[] {
  const capped = entries.slice(0, MAX_CHILDREN_PER_LEVEL);
  const children: TreeNode[] = [];
  let shown = 0;
  for (const [key, value] of capped) {
    if (budget.remaining <= 0) break;
    budget.remaining--;
    children.push(buildNode(value, key, `${parentId}.${key}`, depth, openIds, budget));
    shown++;
  }
  const notShown = entries.length - shown;
  if (notShown > 0) children.push(moreNode(parentId, notShown));
  return children;
}

/** `id` is the node's dotted path from the document root, stable across
 * re-renders. A container node whose id isn't in `openIds` (below
 * `EAGER_DEPTH` and never expanded by the user) gets a single placeholder
 * child instead of real ones — its actual content is never walked. */
function buildNode(value: unknown, label: string, id: string, depth: number, openIds: Set<string>, budget: Budget): TreeNode {
  const entries = entriesOf(value);
  if (entries === null) return { id, label, value: { type: cellTypeFor(value), value } };
  const kind = Array.isArray(value) ? "array" : "object";
  if (entries.length === 0) return { id, label, kind, children: [] };
  const isOpen = depth < EAGER_DEPTH || openIds.has(id);
  if (!isOpen) return { id, label, kind, children: [placeholderNode(id)] };
  return { id, label, kind, children: buildChildren(entries, id, depth + 1, openIds, budget) };
}

/** Seeds the ids that start expanded: every container within `EAGER_DEPTH`
 * that has entries — mirrors the old `defaultExpandedDepth` default, capped
 * the same way real children are (breadth cap + budget) so seeding a wide
 * or multi-level-bushy document can't blow up either. */
function collectDefaultOpen(value: unknown, id: string, depth: number, acc: Set<string>, budget: Budget): void {
  if (depth >= EAGER_DEPTH || budget.remaining <= 0) return;
  const entries = entriesOf(value);
  if (!entries || entries.length === 0) return;
  acc.add(id);
  for (const [key, child] of entries.slice(0, MAX_CHILDREN_PER_LEVEL)) {
    if (budget.remaining <= 0) break;
    budget.remaining--;
    collectDefaultOpen(child, `${id}.${key}`, depth + 1, acc, budget);
  }
}

/** Parses `content` into the document's top-level `[key, value]` entries.
 * Exported (with the functions below) so `tests/unit/rendererBigFileCaps.test.ts`
 * can exercise the exact same tree-building path the component uses, without
 * rendering React. */
export function parseJsonRoots(content: string): { roots: [string, unknown][]; error: string | null } {
  try {
    const parsed = JSON.parse(content) as unknown;
    const entries = entriesOf(parsed);
    return { roots: entries ?? ([["value", parsed]] as [string, unknown][]), error: null };
  } catch (err) {
    return { roots: [], error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

/** The ids that start expanded for a freshly-parsed document — see
 * `collectDefaultOpen`. */
export function buildInitialOpenIds(roots: [string, unknown][]): Set<string> {
  const acc = new Set<string>();
  const budget: Budget = { remaining: MAX_TOTAL_NODES };
  for (const [key, value] of roots.slice(0, MAX_CHILDREN_PER_LEVEL)) {
    if (budget.remaining <= 0) break;
    budget.remaining--;
    collectDefaultOpen(value, `root.${key}`, 0, acc, budget);
  }
  return acc;
}

/** Builds the `TreeNode[]` `TreeView` renders for the given `roots` and
 * `openIds` — a fresh `Budget` every call, same as the component's `useMemo`. */
export function buildTree(roots: [string, unknown][], openIds: Set<string>): TreeNode[] {
  return buildChildren(roots, "root", 0, openIds, { remaining: MAX_TOTAL_NODES });
}

/** Total `TreeNode` object count in a built tree — the DOM-node-count proxy
 * the perf guard asserts against (each `TreeNode` that's actually in this
 * structure is one that TreeView COULD render; nodes never constructed here
 * can never reach the DOM at all). */
export function countTreeNodes(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children) count += countTreeNodes(node.children);
  }
  return count;
}

/**
 * Pure flattening math for `components/local/ExplorerTree.tsx`'s
 * virtualization (Phase 17 Milestone D, `docs/COMPONENT-BACKLOG.md` row 25
 * — "Resizable/VirtualList", `planned` until this phase). Deliberately free
 * of React/DOM so vitest's default `node` environment can exercise it
 * directly, same convention as this app's other `lib/` pure-logic modules
 * (`lib/fileTree.ts`, `lib/filterTree.ts`).
 *
 * `ExplorerTree.tsx` renders recursively (`<ul role="group">` nested per
 * expanded folder) for any tree small enough that the whole thing fits
 * comfortably in the DOM — that's every tree this app's own e2e suite ever
 * builds (the demo vault is under 20 rows fully expanded). A real
 * FS-backed vault can have hundreds or thousands of notes, where mounting
 * one DOM node per row (recursively, whether visible or not) stops being
 * free. `flattenTree()` below is the shared step both rendering paths need
 * answered the same way regardless of which one ends up used: "given the
 * tree and its current expand/collapse state, what rows are actually
 * visible, in order, at what depth" — `ExplorerTree.tsx` uses it (a) to
 * decide, every time the data or expand state changes, whether the
 * flattened row count crosses `VIRTUALIZE_ROW_THRESHOLD` and (b) as the
 * literal windowed data source once it does.
 *
 * 200 is comfortably above every tree state this app's own tests exercise
 * and comfortably below "hundreds of real notes" — the scale VirtualList
 * exists for. Below it, `ExplorerTree` renders the original nested
 * recursive markup verbatim (byte-for-byte identical DOM to before this
 * phase), so the existing e2e suite's ~20-row demo vault never leaves that
 * code path. At/above it, `ExplorerTree` switches to `VirtualList` over
 * these flattened rows.
 */
import type { FileNode } from "../types";

/** Flattened-row count above which `ExplorerTree` virtualizes instead of
 * rendering every row's DOM node. See the module doc above for why 200. */
export const VIRTUALIZE_ROW_THRESHOLD = 200;

export interface FlatTreeRow {
  node: FileNode;
  /** 0 for root-level nodes, matching `ExplorerTree`'s existing `depth`
   * convention (used for indent + whether drag/rename/delete apply). */
  depth: number;
  /** The node's own id if it's a folder, else its parent's id — the
   * folder a "New File"/paste dropped here would land in. */
  parentPath: string;
  isFolder: boolean;
  /** Only meaningful for folders; always `false` for files. */
  expanded: boolean;
  /** 1-based position among its siblings (`aria-posinset`). */
  posinset: number;
  /** Sibling count at this row's depth (`aria-setsize`). */
  setsize: number;
}

export interface FlattenOptions {
  /** User-toggled expand/collapse state, keyed by node id — overrides each
   * folder's `defaultExpandedFor()` value. Absent entirely (or missing a
   * given id) falls back to that default. */
  expandOverrides?: ReadonlyMap<string, boolean>;
  /** Forces every folder open — mirrors `ExplorerTree`'s `expandAll` prop
   * (active while a filter query narrows the tree). */
  expandAll?: boolean;
  /** Forces exactly one folder open regardless of its own state — mirrors
   * `ExplorerTree`'s `forceExpandId` prop (a just-created draft row's
   * parent). */
  forceExpandId?: string | null;
  /** Forces exactly one folder open regardless of its own state — mirrors
   * `ExplorerTree`'s internal `autoExpandPath` state (drag-hover
   * auto-expand). */
  autoExpandPath?: string | null;
}

function parentOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(0, idx);
}

/** A folder's expand state before any user toggle or forced-open signal —
 * the same formula `ExplorerTree.tsx`'s `TreeRow` used to seed its own
 * (now-lifted) `useState`. Files are never "expanded". */
export function defaultExpandedFor(node: FileNode): boolean {
  return node.type === "folder" ? node.collapsed !== true && node.defaultExpanded !== false : false;
}

/** Whether `node` is currently expanded: the user's own toggle (falling
 * back to its default) OR-ed with the two "force open" signals — identical
 * combination `ExplorerTree.tsx`'s row previously computed inline. */
export function computeExpanded(node: FileNode, opts: FlattenOptions = {}): boolean {
  const base = opts.expandOverrides?.has(node.id) ? (opts.expandOverrides.get(node.id) ?? false) : defaultExpandedFor(node);
  return Boolean(opts.expandAll) || base || node.id === opts.autoExpandPath || node.id === opts.forceExpandId;
}

/**
 * Flattens the CURRENTLY VISIBLE rows of `nodes` (a collapsed folder's
 * children are excluded entirely, not just hidden) into a linear,
 * depth-first array preserving sibling order — the shape both the
 * threshold check and `VirtualList`'s windowing operate over.
 */
export function flattenTree(nodes: FileNode[], opts: FlattenOptions = {}, depth = 0): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  const setsize = nodes.length;
  nodes.forEach((node, i) => {
    const isFolder = node.type === "folder";
    const expanded = computeExpanded(node, opts);
    rows.push({
      node,
      depth,
      parentPath: isFolder ? node.id : parentOfPath(node.id),
      isFolder,
      expanded,
      posinset: i + 1,
      setsize,
    });
    if (isFolder && expanded && node.children && node.children.length > 0) {
      rows.push(...flattenTree(node.children, opts, depth + 1));
    }
  });
  return rows;
}

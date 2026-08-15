/**
 * Tab *view* state — which files are open, in what order, which is active,
 * each tab's mode and preview/pinned flags, AND (Phase 6, DESIGN-SPEC
 * Amendments item 8) the recursive pane grid those tabs live in.
 *
 * Phases 2–5 kept this as a flat `panes: Record<paneId, PaneState>` map with
 * exactly one entry (`"root"`) — deliberately pane-shaped from the start
 * (see the git history of this file) so Phase 6 could grow it without a
 * from-scratch rewrite. This phase replaces that flat map with a real tree:
 * `tree: PaneNode` is either a `PaneLeaf` (an actual tab strip — what the
 * old flat map's single entry was) or a `PaneBranch` (a `direction` +
 * ordered `children: PaneNode[]` + parallel `sizes` fractions summing to 1).
 * Any leaf can still split in either direction, recursively, matching the
 * "terminal-multiplexer-style" grid the spec asks for.
 *
 * Content itself (buffer/draft/dirty) is NOT here — see `useBufferStore`,
 * shared across every pane that has a given path open (the mechanism that
 * makes `source | rendered` of the *same* file in two panes stay in sync:
 * both leaves' tabs point at the same buffer entry, never a clone).
 *
 * `activePaneId` doubles as "the focused pane" — every store action that
 * takes an optional `paneId` defaults to it, so global keyboard shortcuts
 * (App.tsx's ⌘S/⌘E/⌘W/⌘F) and single-pane callers (the command palette, the
 * Search activity view, the Explorer's file click) all operate on "whatever
 * pane the user last interacted with" without needing to know panes exist.
 * `EditorPane.tsx` calls `focusPane` on every click/mousedown inside a pane.
 *
 * Persisted to localStorage (DESIGN-SPEC Amendments item 6: "open tabs +
 * order + active tab + per-tab mode + pinned/preview state" survive reload;
 * item 8: "layout persists"). `version: 1` + `migrate` below carries a
 * pre-Phase-6 single-pane `{panes, activePaneId}` shape forward into a
 * one-leaf tree rather than crashing/discarding it on first load after the
 * upgrade — see the `migrate` function's doc for the exact shape mapping,
 * following the same versioned-persist pattern `useGitStore.ts` established.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultModeFor, modeAvailabilityFor } from "../filetypes/registry";
import { useSettingsStore } from "./useSettingsStore";
import type { DiffLayout, DockEdge, EditorMode, FileKind } from "../types";

/** A newly-opened file's mode: the Settings dialog's per-file-type default
 * (DESIGN-SPEC "Misc / settings": "'reading view lock' default mode per
 * file type", Phase 5a's `readingViewDefaultMode`) when the user has set
 * one AND it's actually valid for this kind, else the registry's own
 * `defaultModeFor`. Reads the settings store directly (`getState()`, not a
 * hook) — this runs inside a zustand action, not a component. */
function initialModeFor(kind: FileKind): EditorMode {
  const override = useSettingsStore.getState().readingViewDefaultMode[kind];
  if (override && modeAvailabilityFor(kind, false).includes(override)) return override;
  return defaultModeFor(kind);
}

export interface OpenTab {
  /** Display path — doubles as the tab id. */
  path: string;
  name: string;
  kind: FileKind;
  mode: EditorMode;
  /** Single-click preview tab (replaced by the next preview open). */
  preview: boolean;
  /** Double-click/edit pinned it — survives the next preview open. */
  pinned: boolean;
}

export interface PaneLeaf {
  type: "leaf";
  id: string;
  tabs: OpenTab[];
  activeTabId?: string;
  /** DESIGN-SPEC Amendments round 3 item 18 ("Header consolidation") — the
   * Diff-mode unified/split layout preference, moved here (Phase 6.5b had
   * it as `EditorPane.tsx`-local `useState`) so the title bar can mirror
   * and CHANGE the focused pane's diff layout too, not just `EditorPane`'s
   * own per-pane header. Optional (not every persisted leaf from before
   * this phase has it) — every reader defaults to `"split"` via `?? "split"`
   * rather than requiring a `persist` version bump for one new optional
   * field. */
  diffLayout?: DiffLayout;
}

export type SplitDirection = "row" | "column";

export interface PaneBranch {
  type: "branch";
  id: string;
  direction: SplitDirection;
  children: PaneNode[];
  /** Fractions parallel to `children`, summing to (approximately) 1. */
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneBranch;

const ROOT_PANE_ID = "root";
const MIN_PANE_FRACTION = 0.12;

function genPaneId(): string {
  return `pane-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function emptyLeaf(id: string): PaneLeaf {
  return { type: "leaf", id, tabs: [], activeTabId: undefined };
}

// ---- Pure tree helpers (exported so App.tsx/EditorPane/EditorArea can read
// the tree without duplicating traversal logic). ----

export function findLeaf(node: PaneNode, id: string): PaneLeaf | undefined {
  if (node.type === "leaf") return node.id === id ? node : undefined;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return undefined;
}

export function findBranch(node: PaneNode, id: string): PaneBranch | undefined {
  if (node.type === "leaf") return undefined;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findBranch(child, id);
    if (found) return found;
  }
  return undefined;
}

export function collectLeaves(node: PaneNode, out: PaneLeaf[] = []): PaneLeaf[] {
  if (node.type === "leaf") {
    out.push(node);
  } else {
    for (const child of node.children) collectLeaves(child, out);
  }
  return out;
}

function updateLeaf(node: PaneNode, id: string, fn: (leaf: PaneLeaf) => PaneLeaf): PaneNode {
  if (node.type === "leaf") return node.id === id ? fn(node) : node;
  let changed = false;
  const children = node.children.map((c) => {
    const updated = updateLeaf(c, id, fn);
    if (updated !== c) changed = true;
    return updated;
  });
  return changed ? { ...node, children } : node;
}

function updateBranch(node: PaneNode, id: string, fn: (branch: PaneBranch) => PaneBranch): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === id) return fn(node);
  let changed = false;
  const children = node.children.map((c) => {
    const updated = updateBranch(c, id, fn);
    if (updated !== c) changed = true;
    return updated;
  });
  return changed ? { ...node, children } : node;
}

/** Removes an empty leaf from its parent branch, redistributing its size
 * proportionally among remaining siblings and collapsing the branch itself
 * (replaced by its sole remaining child) if that leaves only one sibling —
 * DESIGN-SPEC Amendments item 8: "Closing a pane's last tab collapses the
 * pane; neighbours reclaim the space." A no-op if `id` is (or contains) the
 * tree's own root leaf — a lone root pane with zero tabs just shows the
 * existing `EmptyState`, matching pre-Phase-6 behavior; there must always be
 * at least one pane. */
function collapseIfEmpty(node: PaneNode, id: string): PaneNode {
  if (node.type === "leaf") return node;
  const idx = node.children.findIndex((c) => c.id === id && c.type === "leaf" && c.tabs.length === 0);
  if (idx !== -1) {
    const children = node.children.filter((_, i) => i !== idx);
    let sizes = node.sizes.filter((_, i) => i !== idx);
    const sum = sizes.reduce((a, b) => a + b, 0);
    sizes = sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
    if (children.length === 1) return children[0];
    return { ...node, children, sizes };
  }
  let changed = false;
  const children = node.children.map((c) => {
    const updated = collapseIfEmpty(c, id);
    if (updated !== c) changed = true;
    return updated;
  });
  return changed ? { ...node, children } : node;
}

/** Inserts `newLeaf` adjacent to the leaf/branch `targetId`, splitting in
 * `direction` — `before` places it left-of/above the target. If the target's
 * parent branch already runs in the same `direction`, `newLeaf` becomes a
 * plain new sibling in that branch (keeps a row of 4 panes flat rather than
 * nesting N-1 redundant 2-way branches); otherwise the target is wrapped in
 * a fresh 2-child branch. */
function insertAdjacent(node: PaneNode, targetId: string, newLeaf: PaneLeaf, direction: SplitDirection, before: boolean): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return {
      type: "branch",
      id: genPaneId(),
      direction,
      children: before ? [newLeaf, node] : [node, newLeaf],
      sizes: [0.5, 0.5],
    };
  }
  const idx = node.children.findIndex((c) => c.id === targetId);
  if (idx !== -1) {
    if (node.direction === direction) {
      const oldSize = node.sizes[idx];
      const half = oldSize / 2;
      const children = node.children.slice();
      const sizes = node.sizes.slice();
      const insertAt = before ? idx : idx + 1;
      children.splice(insertAt, 0, newLeaf);
      sizes.splice(insertAt, 0, half);
      sizes[before ? idx + 1 : idx] = half;
      return { ...node, children, sizes };
    }
    const target = node.children[idx];
    const wrapped: PaneBranch = {
      type: "branch",
      id: genPaneId(),
      direction,
      children: before ? [newLeaf, target] : [target, newLeaf],
      sizes: [0.5, 0.5],
    };
    const children = node.children.slice();
    children[idx] = wrapped;
    return { ...node, children };
  }
  let changed = false;
  const children = node.children.map((c) => {
    const updated = insertAdjacent(c, targetId, newLeaf, direction, before);
    if (updated !== c) changed = true;
    return updated;
  });
  return changed ? { ...node, children } : node;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function remapPath(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return newPrefix + path.slice(oldPrefix.length);
  return path;
}

interface OpenFileInput {
  path: string;
  name: string;
  kind: FileKind;
}

interface DockTabInput {
  sourcePaneId: string;
  targetPaneId: string;
  edge: DockEdge;
  path: string;
  name: string;
  kind: FileKind;
}

interface TabsStoreState {
  tree: PaneNode;
  activePaneId: string;

  focusPane: (paneId: string) => void;
  /** The focused pane's leaf, or the tree's first leaf as a fallback (e.g.
   * right after the focused pane collapsed and a later render hasn't caught
   * up yet). Never undefined — there is always at least one leaf. */
  activeLeaf: () => PaneLeaf;

  /** Opens `file` in `paneId` (defaults to the focused pane). `pin: true` =
   * double-click/edit (permanent tab); otherwise it's a single-click preview
   * tab that the next preview open in that pane replaces. */
  openFile: (file: OpenFileInput, opts?: { pin?: boolean }, paneId?: string) => void;
  pinTab: (path: string, paneId?: string) => void;
  closeTab: (path: string, paneId?: string) => void;
  setActiveTab: (path: string, paneId?: string) => void;
  setMode: (path: string, mode: EditorMode, paneId?: string) => void;
  /** Updates a single tab's `kind` across every pane that has it open (e.g.
   * a rename that changed the file's extension — `App.tsx`'s
   * `handleRenameCommit`, not `renamePrefix`'s job since a folder rename
   * remaps many descendant paths whose *own* extensions never changed). If
   * the tab's current mode isn't valid for the new kind (registry
   * `modeAvailabilityFor`) it's reset to the new kind's default mode rather
   * than left pointing at a segment the header would show disabled. */
  setKind: (path: string, kind: FileKind) => void;
  reorderTab: (fromIndex: number, toIndex: number, paneId?: string) => void;
  /** Remaps every open tab (in every pane) whose path is `oldPrefix` or
   * starts with `oldPrefix/` to the equivalent path under `newPrefix` — used
   * after a file/folder rename or drag-move so open tabs follow the file. */
  renamePrefix: (oldPrefix: string, newPrefix: string) => void;
  /** Closes every tab (in every pane) whose path is `prefix` or starts with
   * `prefix/` — used after a delete. Collapses any pane left with zero tabs. */
  closeByPrefix: (prefix: string) => void;

  // ---- Phase 6: grid split view (DESIGN-SPEC Amendments item 8) ----
  /** The single entry point for both drag-to-dock and the per-tab "Split
   * Right/Left/Up/Down" context menu (EditorTabBar): `edge: "center"` moves
   * the tab into `targetPaneId`'s tab strip (no new pane — this is what a
   * drop in a pane's middle 50%, or a drop directly on a tab bar, does);
   * any other edge splits `targetPaneId` and moves the tab into a brand new
   * adjacent leaf. `sourcePaneId === targetPaneId` is valid (splitting a
   * pane using one of its own tabs) — a no-op if that pane only has the one
   * tab being dragged (nothing would remain to split against). */
  dockTab: (input: DockTabInput) => void;
  resizeBranch: (branchId: string, sizes: number[]) => void;
  /** Divider double-click (DESIGN-SPEC Amendments item 8: "double-click a
   * divider to equalize siblings"). */
  equalizeBranch: (branchId: string) => void;

  /** DESIGN-SPEC Amendments round 3 item 18 — sets `paneId`'s (default: the
   * focused pane) Diff-mode unified/split preference. Called both by
   * `EditorPane.tsx`'s own per-pane header (when >1 pane) and by the title
   * bar (`App.tsx`, which always mirrors the FOCUSED pane). */
  setDiffLayout: (layout: DiffLayout, paneId?: string) => void;
}

export const useTabsStore = create<TabsStoreState>()(
  persist(
    (set, get) => ({
      tree: emptyLeaf(ROOT_PANE_ID),
      activePaneId: ROOT_PANE_ID,

      focusPane: (paneId) => {
        set((state) => (findLeaf(state.tree, paneId) ? { activePaneId: paneId } : state));
      },

      activeLeaf: () => {
        const state = get();
        return findLeaf(state.tree, state.activePaneId) ?? collectLeaves(state.tree)[0] ?? emptyLeaf(ROOT_PANE_ID);
      },

      openFile: (file, opts, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        const pin = !!opts?.pin;
        set((state) => ({
          tree: updateLeaf(state.tree, paneId, (pane) => {
            const existing = pane.tabs.find((t) => t.path === file.path);
            let tabs: OpenTab[];
            if (existing) {
              tabs = pin
                ? pane.tabs.map((t) => (t.path === file.path ? { ...t, preview: false, pinned: true } : t))
                : pane.tabs;
            } else {
              const newTab: OpenTab = {
                path: file.path,
                name: file.name,
                kind: file.kind,
                mode: initialModeFor(file.kind),
                preview: !pin,
                pinned: pin,
              };
              // A preview tab replaces any existing preview tab (VSCode
              // single-preview-slot behavior); pinned opens just append.
              const base = pin ? pane.tabs : pane.tabs.filter((t) => !t.preview);
              tabs = [...base, newTab];
            }
            return { ...pane, tabs, activeTabId: file.path };
          }),
        }));
      },

      pinTab: (path, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => ({
          tree: updateLeaf(state.tree, paneId, (pane) => ({
            ...pane,
            tabs: pane.tabs.map((t) => (t.path === path ? { ...t, preview: false, pinned: true } : t)),
          })),
        }));
      },

      closeTab: (path, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => {
          let tree = updateLeaf(state.tree, paneId, (pane) => {
            const closingIndex = pane.tabs.findIndex((t) => t.path === path);
            const tabs = pane.tabs.filter((t) => t.path !== path);
            let activeTabId = pane.activeTabId;
            if (activeTabId === path) {
              const neighbor = tabs[closingIndex] ?? tabs[closingIndex - 1];
              activeTabId = neighbor?.path;
            }
            return { ...pane, tabs, activeTabId };
          });
          tree = collapseIfEmpty(tree, paneId);
          let activePaneId = state.activePaneId;
          if (!findLeaf(tree, activePaneId)) {
            activePaneId = collectLeaves(tree)[0]?.id ?? ROOT_PANE_ID;
          }
          return { tree, activePaneId };
        });
      },

      setActiveTab: (path, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => ({ tree: updateLeaf(state.tree, paneId, (pane) => ({ ...pane, activeTabId: path })) }));
      },

      setMode: (path, mode, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => ({
          tree: updateLeaf(state.tree, paneId, (pane) => ({
            ...pane,
            tabs: pane.tabs.map((t) => (t.path === path ? { ...t, mode } : t)),
          })),
        }));
      },

      setKind: (path, kind) => {
        set((state) => {
          function apply(node: PaneNode): PaneNode {
            if (node.type === "leaf") {
              let changed = false;
              const tabs = node.tabs.map((t) => {
                if (t.path !== path || t.kind === kind) return t;
                changed = true;
                const stillValid = modeAvailabilityFor(kind, false).includes(t.mode);
                return { ...t, kind, mode: stillValid ? t.mode : defaultModeFor(kind) };
              });
              return changed ? { ...node, tabs } : node;
            }
            let changed = false;
            const children = node.children.map((c) => {
              const updated = apply(c);
              if (updated !== c) changed = true;
              return updated;
            });
            return changed ? { ...node, children } : node;
          }
          return { tree: apply(state.tree) };
        });
      },

      reorderTab: (fromIndex, toIndex, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => ({
          tree: updateLeaf(state.tree, paneId, (pane) => {
            const tabs = pane.tabs.slice();
            const [moved] = tabs.splice(fromIndex, 1);
            if (!moved) return pane;
            tabs.splice(toIndex, 0, moved);
            return { ...pane, tabs };
          }),
        }));
      },

      renamePrefix: (oldPrefix, newPrefix) => {
        set((state) => {
          function apply(node: PaneNode): PaneNode {
            if (node.type === "leaf") {
              return {
                ...node,
                tabs: node.tabs.map((t) =>
                  matchesPrefix(t.path, oldPrefix)
                    ? { ...t, path: remapPath(t.path, oldPrefix, newPrefix), name: remapPath(t.path, oldPrefix, newPrefix).split("/").pop()! }
                    : t,
                ),
                activeTabId:
                  node.activeTabId && matchesPrefix(node.activeTabId, oldPrefix)
                    ? remapPath(node.activeTabId, oldPrefix, newPrefix)
                    : node.activeTabId,
              };
            }
            return { ...node, children: node.children.map(apply) };
          }
          return { tree: apply(state.tree) };
        });
      },

      closeByPrefix: (prefix) => {
        set((state) => {
          function apply(node: PaneNode): PaneNode {
            if (node.type === "leaf") {
              const tabs = node.tabs.filter((t) => !matchesPrefix(t.path, prefix));
              const activeTabId =
                node.activeTabId && matchesPrefix(node.activeTabId, prefix) ? tabs[tabs.length - 1]?.path : node.activeTabId;
              return { ...node, tabs, activeTabId };
            }
            return { ...node, children: node.children.map(apply) };
          }
          let tree = apply(state.tree);
          // Every leaf that lost its last tab collapses (same rule as a
          // manual close) — walk every leaf id and try collapsing it.
          for (const leaf of collectLeaves(tree)) {
            if (leaf.tabs.length === 0) tree = collapseIfEmpty(tree, leaf.id);
          }
          let activePaneId = state.activePaneId;
          if (!findLeaf(tree, activePaneId)) activePaneId = collectLeaves(tree)[0]?.id ?? ROOT_PANE_ID;
          return { tree, activePaneId };
        });
      },

      dockTab: ({ sourcePaneId, targetPaneId, edge, path, name, kind }) => {
        set((state) => {
          const sourceLeaf = findLeaf(state.tree, sourcePaneId);
          const tab = sourceLeaf?.tabs.find((t) => t.path === path);
          if (!sourceLeaf || !tab) return state;

          if (edge === "center") {
            if (sourcePaneId === targetPaneId) {
              // Already in this pane — just focus it.
              return {
                tree: updateLeaf(state.tree, targetPaneId, (pane) => ({ ...pane, activeTabId: path })),
                activePaneId: targetPaneId,
              };
            }
            let tree = updateLeaf(state.tree, sourcePaneId, (pane) => {
              const closingIndex = pane.tabs.findIndex((t) => t.path === path);
              const tabs = pane.tabs.filter((t) => t.path !== path);
              let activeTabId = pane.activeTabId;
              if (activeTabId === path) activeTabId = (tabs[closingIndex] ?? tabs[closingIndex - 1])?.path;
              return { ...pane, tabs, activeTabId };
            });
            tree = updateLeaf(tree, targetPaneId, (pane) => {
              const existing = pane.tabs.find((t) => t.path === path);
              const tabs = existing
                ? pane.tabs.map((t) => (t.path === path ? { ...t, preview: false, pinned: true } : t))
                : [...pane.tabs.filter((t) => !t.preview || t.pinned), { ...tab, preview: false, pinned: true }];
              return { ...pane, tabs, activeTabId: path };
            });
            tree = collapseIfEmpty(tree, sourcePaneId);
            return { tree, activePaneId: targetPaneId };
          }

          // Real split. Splitting a pane using its own only tab is a no-op —
          // nothing would remain in the source pane to split against.
          if (sourcePaneId === targetPaneId && sourceLeaf.tabs.length <= 1) return state;

          let tree = updateLeaf(state.tree, sourcePaneId, (pane) => {
            const closingIndex = pane.tabs.findIndex((t) => t.path === path);
            const tabs = pane.tabs.filter((t) => t.path !== path);
            let activeTabId = pane.activeTabId;
            if (activeTabId === path) activeTabId = (tabs[closingIndex] ?? tabs[closingIndex - 1])?.path;
            return { ...pane, tabs, activeTabId };
          });
          if (sourcePaneId !== targetPaneId) tree = collapseIfEmpty(tree, sourcePaneId);

          const newLeafId = genPaneId();
          const newLeaf: PaneLeaf = {
            type: "leaf",
            id: newLeafId,
            tabs: [{ path, name, kind, mode: tab.mode, preview: false, pinned: true }],
            activeTabId: path,
          };
          const direction: SplitDirection = edge === "left" || edge === "right" ? "row" : "column";
          const before = edge === "left" || edge === "top";
          tree = insertAdjacent(tree, targetPaneId, newLeaf, direction, before);

          return { tree, activePaneId: newLeafId };
        });
      },

      resizeBranch: (branchId, sizes) => {
        set((state) => {
          const clamped = sizes.map((s) => Math.max(MIN_PANE_FRACTION, s));
          const sum = clamped.reduce((a, b) => a + b, 0);
          const normalized = sum > 0 ? clamped.map((s) => s / sum) : clamped;
          return { tree: updateBranch(state.tree, branchId, (branch) => ({ ...branch, sizes: normalized })) };
        });
      },

      equalizeBranch: (branchId) => {
        set((state) => ({
          tree: updateBranch(state.tree, branchId, (branch) => ({
            ...branch,
            sizes: branch.children.map(() => 1 / branch.children.length),
          })),
        }));
      },

      setDiffLayout: (layout, explicitPaneId) => {
        const paneId = explicitPaneId ?? get().activePaneId;
        set((state) => ({ tree: updateLeaf(state.tree, paneId, (pane) => ({ ...pane, diffLayout: layout })) }));
      },
    }),
    {
      name: "slate-tabs",
      // v1 (Phase 6): the flat single-pane `{panes: Record<paneId,
      // PaneState>, activePaneId}` shape (every phase through 5b) is
      // replaced by a recursive `{tree: PaneNode, activePaneId}` (see this
      // file's module doc). `migrate` carries a v0 persisted session's real
      // open tabs/mode/preview state forward into a one-leaf tree — a user
      // reloading right after this upgrade keeps every tab exactly as they
      // left it, just now inside a (still single-pane) tree instead of
      // losing it to a shape mismatch. Any state that doesn't even parse as
      // the expected v0 shape falls through to a fresh empty root pane
      // rather than throwing.
      version: 1,
      migrate: (persisted) => {
        const raw = persisted as { panes?: Record<string, { tabs?: OpenTab[]; activeTabId?: string }>; activePaneId?: string } | undefined;
        if (raw?.panes && typeof raw.panes === "object") {
          const source = raw.panes[raw.activePaneId ?? ROOT_PANE_ID] ?? Object.values(raw.panes)[0];
          const tree: PaneLeaf = {
            type: "leaf",
            id: ROOT_PANE_ID,
            tabs: Array.isArray(source?.tabs) ? source.tabs : [],
            activeTabId: source?.activeTabId,
          };
          return { tree, activePaneId: ROOT_PANE_ID };
        }
        return { tree: emptyLeaf(ROOT_PANE_ID), activePaneId: ROOT_PANE_ID };
      },
    },
  ),
);

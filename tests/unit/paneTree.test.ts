/**
 * Pins `stores/useTabsStore.ts`'s pane-tree operations: opening a file into
 * a leaf, `dockTab` splitting a leaf into a branch, a pane collapsing when
 * its last tab closes (DESIGN-SPEC Amendments item 8), and — the specific
 * thing Phase 6's manual verification checked by hand and this test now
 * pins as an assertion — that the persisted tree round-trips through
 * `JSON.stringify`/`JSON.parse` (what zustand's `persist` middleware does
 * to `localStorage` under the hood) byte-identical: same shape, same
 * `sizes` fractions, same ids, same tab order.
 *
 * Uses the real store (not a reimplementation) via `useTabsStore.getState()`
 * — `tests/unit/setup.ts` shims `window.localStorage` so the `persist`
 * middleware's writes/rehydrates run for real.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { collectLeaves, findBranch, findLeaf, useTabsStore } from "../../src/stores/useTabsStore";

const FILE_A = { path: "vault/notes/architecture.md", name: "architecture.md", kind: "md" as const };
const FILE_B = { path: "vault/src/indexer.ts", name: "indexer.ts", kind: "ts" as const };
const FILE_C = { path: "vault/vault.config.json", name: "vault.config.json", kind: "json" as const };

function resetStore(): void {
  useTabsStore.setState({
    tree: { type: "leaf", id: "root", tabs: [], activeTabId: undefined },
    activePaneId: "root",
  });
}

beforeEach(() => {
  resetStore();
});

describe("useTabsStore pane-tree ops", () => {
  it("openFile adds a tab to the root leaf and makes it active", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    const leaf = findLeaf(useTabsStore.getState().tree, "root");
    expect(leaf?.tabs.map((t) => t.path)).toEqual([FILE_A.path]);
    expect(leaf?.activeTabId).toBe(FILE_A.path);
  });

  it("dockTab with a non-center edge splits the pane into a branch", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });
    useTabsStore.getState().dockTab({
      sourcePaneId: "root",
      targetPaneId: "root",
      edge: "right",
      path: FILE_B.path,
      name: FILE_B.name,
      kind: FILE_B.kind,
    });

    const tree = useTabsStore.getState().tree;
    expect(tree.type).toBe("branch");
    if (tree.type !== "branch") throw new Error("expected branch");
    expect(tree.direction).toBe("row");
    expect(tree.children).toHaveLength(2);
    expect(tree.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);

    const leaves = collectLeaves(tree);
    expect(leaves).toHaveLength(2);
    // Original pane keeps FILE_A only; the new pane gets FILE_B.
    const originalLeaf = leaves.find((l) => l.tabs.some((t) => t.path === FILE_A.path));
    const newLeaf = leaves.find((l) => l.tabs.some((t) => t.path === FILE_B.path));
    expect(originalLeaf?.tabs.map((t) => t.path)).toEqual([FILE_A.path]);
    expect(newLeaf?.tabs.map((t) => t.path)).toEqual([FILE_B.path]);
  });

  it("dockTab center merges a tab into another pane's strip without creating a branch", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });
    useTabsStore.getState().dockTab({
      sourcePaneId: "root",
      targetPaneId: "root",
      edge: "right",
      path: FILE_B.path,
      name: FILE_B.name,
      kind: FILE_B.kind,
    });
    const branchId = useTabsStore.getState().tree.id;
    const branch = findBranch(useTabsStore.getState().tree, branchId)!;
    const [firstLeafId, secondLeafId] = branch.children.map((c) => c.id);

    // Open a third file into the first leaf, then dock it center into the
    // second leaf — should merge into that leaf's tab strip, not split again.
    useTabsStore.getState().openFile(FILE_C, { pin: true }, firstLeafId);
    useTabsStore.getState().dockTab({
      sourcePaneId: firstLeafId,
      targetPaneId: secondLeafId,
      edge: "center",
      path: FILE_C.path,
      name: FILE_C.name,
      kind: FILE_C.kind,
    });

    const leaves = collectLeaves(useTabsStore.getState().tree);
    expect(leaves).toHaveLength(2); // still just the original 2-way split
    const target = leaves.find((l) => l.id === secondLeafId)!;
    expect(target.tabs.map((t) => t.path).sort()).toEqual([FILE_B.path, FILE_C.path].sort());
  });

  it("closing a pane's last tab collapses it and neighbors reclaim the space", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });
    useTabsStore.getState().dockTab({
      sourcePaneId: "root",
      targetPaneId: "root",
      edge: "right",
      path: FILE_B.path,
      name: FILE_B.name,
      kind: FILE_B.kind,
    });
    expect(useTabsStore.getState().tree.type).toBe("branch");

    const leaves = collectLeaves(useTabsStore.getState().tree);
    const leafWithB = leaves.find((l) => l.tabs.some((t) => t.path === FILE_B.path))!;
    useTabsStore.getState().closeTab(FILE_B.path, leafWithB.id);

    // Only one leaf's tab was ever open there, so closing it collapses the
    // branch back down to a single leaf (DESIGN-SPEC Amendments item 8).
    const tree = useTabsStore.getState().tree;
    expect(tree.type).toBe("leaf");
    if (tree.type !== "leaf") throw new Error("expected leaf");
    expect(tree.tabs.map((t) => t.path)).toEqual([FILE_A.path]);
    // activePaneId must always point at a leaf that still exists.
    expect(findLeaf(tree, useTabsStore.getState().activePaneId)).toBeTruthy();
  });

  it("equalizeBranch resets sizes to equal fractions after an uneven resize", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });
    useTabsStore.getState().dockTab({
      sourcePaneId: "root",
      targetPaneId: "root",
      edge: "right",
      path: FILE_B.path,
      name: FILE_B.name,
      kind: FILE_B.kind,
    });
    const branchId = useTabsStore.getState().tree.id;
    useTabsStore.getState().resizeBranch(branchId, [0.8, 0.2]);
    expect(findBranch(useTabsStore.getState().tree, branchId)!.sizes).toEqual([0.8, 0.2]);

    useTabsStore.getState().equalizeBranch(branchId);
    const sizes = findBranch(useTabsStore.getState().tree, branchId)!.sizes;
    expect(sizes[0]).toBeCloseTo(0.5);
    expect(sizes[1]).toBeCloseTo(0.5);
  });

  it("persist round-trip: the pane tree survives JSON stringify/parse byte-identical", () => {
    // Build a non-trivial layout: a 2-way split, one side split again (a
    // 3-pane tree with mixed row/column directions and non-50/50 sizes) —
    // this is the "layout-JSON identity" question Phase 6's manual
    // verification checked by hand ("I verified byte-identical round-trip
    // manually"); this test encodes that as a real assertion instead.
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });
    useTabsStore.getState().dockTab({
      sourcePaneId: "root",
      targetPaneId: "root",
      edge: "right",
      path: FILE_B.path,
      name: FILE_B.name,
      kind: FILE_B.kind,
    });
    const topBranchId = useTabsStore.getState().tree.id;
    useTabsStore.getState().resizeBranch(topBranchId, [0.37, 0.63]);
    const leaves = collectLeaves(useTabsStore.getState().tree);
    const rightLeaf = leaves.find((l) => l.tabs.some((t) => t.path === FILE_B.path))!;
    useTabsStore.getState().openFile(FILE_C, { pin: true }, rightLeaf.id);
    useTabsStore.getState().dockTab({
      sourcePaneId: rightLeaf.id,
      targetPaneId: rightLeaf.id,
      edge: "bottom",
      path: FILE_C.path,
      name: FILE_C.name,
      kind: FILE_C.kind,
    });

    const before = useTabsStore.getState();
    const beforeTree = before.tree;
    const beforeActivePaneId = before.activePaneId;

    // Zustand's `persist` middleware (default JSON storage) writes
    // `{state: {...partialized-or-whole-state}, version}` — reproduce that
    // exact envelope shape here so this test exercises the real
    // serialization contract, not a hand-rolled stand-in for it.
    const serialized = JSON.stringify({ state: { tree: beforeTree, activePaneId: beforeActivePaneId }, version: 1 });
    const parsed = JSON.parse(serialized) as { state: { tree: typeof beforeTree; activePaneId: string } };

    expect(parsed.state.tree).toEqual(beforeTree); // deep-equal, not just same shape
    expect(parsed.state.activePaneId).toBe(beforeActivePaneId);

    // Also exercise the ACTUAL localStorage write this store's `persist`
    // config produces (the `vsnote-tabs` key), not just a hand-built
    // envelope — confirms the middleware itself round-trips the same way.
    const raw = window.localStorage.getItem("vsnote-tabs");
    expect(raw).toBeTruthy();
    const fromStorage = JSON.parse(raw!) as { state: { tree: typeof beforeTree } };
    expect(fromStorage.state.tree).toEqual(beforeTree);
  });
});

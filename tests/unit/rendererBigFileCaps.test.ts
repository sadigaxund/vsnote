/**
 * DESIGN-SPEC Amendments item 33 — perf guard. Proves the CSV row cap and
 * JSON tree cap actually bound what reaches the DOM, regardless of input
 * size/shape, using the generators in `rendererFixtures.ts`.
 *
 * Method: these test the exported pure capping/tree-building functions
 * directly (`capRows` from `csvLogic.ts`; `parseJsonRoots`/
 * `buildInitialOpenIds`/`buildTree`/`countTreeNodes` from `jsonLogic.ts`)
 * rather than rendering React — consistent with this suite's node
 * environment (see `vitest.config.ts`: "nothing under test renders React").
 * `DataTable` renders exactly one row per array entry it's given (no
 * virtualization — checked `skills/components.json`) and `TreeView` only
 * ever puts a `TreeNode` into the DOM if that `TreeNode` object exists in
 * the tree passed to it, so bounding these functions' output IS bounding
 * the DOM.
 *
 * Before this cap existed, an SSR render (`react-dom/server`) of the ACTUAL
 * components against these same fixture sizes measured:
 *   - CSV, 50,000 rows: ~1.85M DOM nodes, ~67s to render.
 *   - JSON, 20,000-item flat array: ~1.94M DOM nodes, ~28s to render.
 *   - JSON, 3,000-level-deep chain: only 8 DOM nodes, 32ms (already fine —
 *     `TreeView` never builds DOM for a collapsed branch; breadth was the
 *     actual danger, not depth).
 * After the cap: CSV 50k rows ~16.5k DOM nodes/~1.2s; JSON wide 20k ~19k DOM
 * nodes/~0.35s. See `csvLogic.ts`/`jsonLogic.ts` file-header comments for
 * the full writeup.
 */
import { describe, expect, it } from "vitest";
import { capRows, INITIAL_ROW_LIMIT, parseCsv } from "../../src/renderers/csvLogic";
import { buildInitialOpenIds, buildTree, countTreeNodes, parseJsonRoots } from "../../src/renderers/jsonLogic";
import { generateBushyJson, generateDeepJson, generateLargeDeepJson, generateStressCsv, generateWideJson } from "./rendererFixtures";

describe("CSV renderer row cap (DESIGN-SPEC item 33)", () => {
  it("caps a 50,000-row stress fixture to INITIAL_ROW_LIMIT rows", () => {
    const csv = generateStressCsv(50000);
    const [, ...dataRows] = parseCsv(csv);
    expect(dataRows.length).toBe(50000);

    const { visible, shownCount, hasMore } = capRows(dataRows, INITIAL_ROW_LIMIT);
    expect(shownCount).toBe(INITIAL_ROW_LIMIT);
    expect(visible.length).toBe(INITIAL_ROW_LIMIT);
    expect(hasMore).toBe(true);
  });

  it("leaves an ordinary small file untouched (no cap, no indicator)", () => {
    const csv = generateStressCsv(10);
    const [, ...dataRows] = parseCsv(csv);
    const { visible, shownCount, hasMore } = capRows(dataRows, INITIAL_ROW_LIMIT);
    expect(shownCount).toBe(10);
    expect(visible).toBe(dataRows); // same array reference — a genuine no-op below the cap
    expect(hasMore).toBe(false);
  });
});

describe("JSON renderer tree cap (DESIGN-SPEC item 33)", () => {
  it("caps a 20,000-item wide array's materialized tree regardless of size", () => {
    const { roots, error } = parseJsonRoots(generateWideJson(20000));
    expect(error).toBeNull();
    expect(roots.length).toBe(20000);

    const openIds = buildInitialOpenIds(roots);
    const tree = buildTree(roots, openIds);
    const nodeCount = countTreeNodes(tree);

    expect(nodeCount).toBeLessThan(2000);
    const hasMoreLeaf = tree.some((n) => typeof n.value?.value === "string" && n.value.value.includes("more not shown"));
    expect(hasMoreLeaf).toBe(true);
  });

  it("does not materialize a 3,000-level-deep chain beyond the eager depth", () => {
    // 3,000 is near `JSON.stringify`/`JSON.parse`'s own native recursion
    // ceiling (~3,500 in this Node build) — already the practical upper
    // bound for how deep a JSON document can even get parsed at all.
    const { roots, error } = parseJsonRoots(generateDeepJson(3000));
    expect(error).toBeNull();
    const openIds = buildInitialOpenIds(roots);
    const tree = buildTree(roots, openIds);
    // Only the first EAGER_DEPTH levels are real nodes; everything past
    // that is a single untouched placeholder — total stays tiny however
    // deep the actual document goes (3,000 levels here vs. a handful of
    // nodes).
    expect(countTreeNodes(tree)).toBeLessThan(50);
  });

  it("caps a large-AND-deeply-nested fixture (item 33's own example)", () => {
    const { roots, error } = parseJsonRoots(generateLargeDeepJson(5000, 50));
    expect(error).toBeNull();
    expect(roots.length).toBe(5000);
    const openIds = buildInitialOpenIds(roots);
    const tree = buildTree(roots, openIds);
    // A literal bound, not `MAX_TOTAL_NODES + 250` — importing the module's
    // own cap here would make this assertion silently no-op if that cap
    // were ever weakened to something huge, defeating the guard.
    expect(countTreeNodes(tree)).toBeLessThanOrEqual(3250);
  });

  it("bounds a pathologically multi-level-bushy document via the shared node budget", () => {
    // 60^3 ~= 216,000 leaves — per-level breadth capping alone would still
    // multiply (200 x 200 x 200); MAX_TOTAL_NODES is what actually stops it.
    const { roots, error } = parseJsonRoots(generateBushyJson(60, 3));
    expect(error).toBeNull();
    const openIds = buildInitialOpenIds(roots);
    const tree = buildTree(roots, openIds);
    // A literal bound, not `MAX_TOTAL_NODES + 250` — importing the module's
    // own cap here would make this assertion silently no-op if that cap
    // were ever weakened to something huge, defeating the guard.
    expect(countTreeNodes(tree)).toBeLessThanOrEqual(3250);
  });
});

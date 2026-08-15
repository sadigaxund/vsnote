/**
 * Phase 6 exit criteria: split the same file source|rendered across two
 * panes sharing ONE buffer (an edit in one appears in the other, both tabs
 * go dirty together), arrange a 2x2 grid, resize + double-click-equalize a
 * divider, and have the exact layout survive a reload.
 *
 * Note on "split the same file": `dockTab`'s non-center edge MOVES the
 * dragged tab into a brand-new pane (`useTabsStore.ts`'s doc) — it does not
 * duplicate it. To get the same file open in two panes at once (the actual
 * feature under test — one shared buffer, two views) a spec must split,
 * THEN reopen that file from the tree into the other, now-focused pane —
 * exactly the real user gesture DESIGN-SPEC describes.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp, pane, panes, tab, treeRow } from "./fixtures";

const ARCH = "vault/notes/architecture.md";
const INDEXER = "vault/src/indexer.ts";
const CONFIG = "vault/vault.config.json";

/** Splits `path`'s tab (must be visible/open already) toward `edge` via its
 * right-click "Split ..." menu item — DESIGN-SPEC Amendments item 8's
 * required non-drag affordance, and more deterministic in a headless test
 * than simulating a real drag-to-edge gesture. */
async function splitTab(page: Page, path: string, label: "Split right" | "Split left" | "Split up" | "Split down") {
  await tab(page, path).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: label }).click();
}

async function currentPaneIds(page: Page): Promise<string[]> {
  return panes(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-pane-id")!));
}

test.describe("split grid", () => {
  test("same file source|rendered in two panes shares one buffer", async ({ page }) => {
    await gotoApp(page);
    await splitTab(page, ARCH, "Split right");
    await expect(panes(page)).toHaveCount(2);
    const [leftPaneId, rightPaneId] = await currentPaneIds(page);

    // The split moved ARCH into the new (now-focused) right pane.
    await expect(tab(page, ARCH, rightPaneId)).toBeVisible();

    // Focus the left pane, then reopen architecture.md from the tree —
    // openFile targets whichever pane is focused, so this puts the SAME
    // file (same shared buffer, useBufferStore) into both panes at once.
    await pane(page, leftPaneId).click();
    await treeRow(page, ARCH).click();
    await expect(tab(page, ARCH, leftPaneId)).toBeVisible();

    // Right pane defaults to Rendered; switch it to Source so we can type
    // plain text and read it back from the left pane's Rendered view.
    await pane(page, rightPaneId).getByRole("radio", { name: "Source" }).click();
    const rightCm = pane(page, rightPaneId).locator(".cm-content");
    await expect(rightCm).toBeVisible();
    await rightCm.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("SHARED-BUFFER-MARKER ");

    await expect(pane(page, leftPaneId).locator(".cm-content")).toContainText("SHARED-BUFFER-MARKER");

    // Both panes' tabs for this file go dirty together (one buffer, one
    // dirty flag, two tab-strip views of it).
    await expect(tab(page, ARCH, leftPaneId).getByTestId("tab-dirty-dot")).toBeVisible();
    await expect(tab(page, ARCH, rightPaneId).getByTestId("tab-dirty-dot")).toBeVisible();
  });

  test("arranges a 2x2 grid of four different files", async ({ page }) => {
    await gotoApp(page);
    // Split 1: architecture.md moves right (root keeps indexer.ts/
    // vault.config.json/metrics.csv/cover.png, active becomes indexer.ts —
    // useTabsStore's "closing" neighbor-selection rule).
    await splitTab(page, ARCH, "Split right");

    // Split 2: indexer.ts (still in root) moves down (root's active
    // becomes vault.config.json next).
    await splitTab(page, INDEXER, "Split down");
    let paneIds = await currentPaneIds(page);
    expect(paneIds).toHaveLength(3);

    // Split 3: vault.config.json (still in root) moves right, giving a
    // 4th pane — root's remaining active tab is metrics.csv.
    await splitTab(page, CONFIG, "Split right");
    paneIds = await currentPaneIds(page);
    expect(paneIds).toHaveLength(4);

    // Four distinct active files, one per pane — architecture.md,
    // indexer.ts, vault.config.json, and whatever's left in the original
    // pane (metrics.csv).
    const filesPerPane = await Promise.all(
      paneIds.map((id) => pane(page, id).locator('[role="tab"][aria-selected="true"]').getAttribute("data-tab-path")),
    );
    expect(new Set(filesPerPane)).toEqual(new Set([ARCH, INDEXER, CONFIG, "vault/metrics.csv"]));
  });

  test("dragging a divider resizes panes; double-click equalizes them", async ({ page }) => {
    await gotoApp(page);
    await splitTab(page, ARCH, "Split right");
    await expect(panes(page)).toHaveCount(2);

    // `[role="separator"]` alone is ambiguous as of Phase 6.5c (DESIGN-SPEC
    // Amendments item 10): the Explorer sidebar's own resize handle
    // (`Sidebar.tsx`, reusing `local/PaneGroup.tsx`'s extracted
    // `ResizeHandle`) is the SAME role and comes first in DOM order (App.tsx
    // renders the Sidebar before the EditorArea), so a bare `.first()` would
    // grab the sidebar handle instead of the pane divider. `PaneDivider`'s
    // own `data-testid="pane-divider-<branchId>-<index>"` disambiguates.
    const divider = page.locator('[data-testid^="pane-divider-"]').first();
    await expect(divider).toBeVisible();

    async function widthFraction(): Promise<number> {
      const leftBox = (await panes(page).nth(0).boundingBox())!;
      const rightBox = (await panes(page).nth(1).boundingBox())!;
      return leftBox.width / (leftBox.width + rightBox.width);
    }

    const fractionBefore = await widthFraction();
    expect(fractionBefore).toBeCloseTo(0.5, 1);

    const dividerBox = (await divider.boundingBox())!;
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dividerBox.x + 180, dividerBox.y + dividerBox.height / 2, { steps: 10 });
    await page.mouse.up();

    const fractionAfterDrag = await widthFraction();
    expect(fractionAfterDrag - fractionBefore).toBeGreaterThan(0.08); // moved right by a real, visible amount

    await divider.dblclick();
    await expect.poll(widthFraction, { timeout: 5000 }).toBeCloseTo(0.5, 1);
  });

  test("split layout survives a reload", async ({ page }) => {
    await gotoApp(page);
    await splitTab(page, ARCH, "Split right");
    await expect(panes(page)).toHaveCount(2);
    const [, rightPaneId] = await currentPaneIds(page);
    await expect(tab(page, ARCH, rightPaneId)).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-tree-path="vault/notes/architecture.md"]')).toBeVisible();
    await expect(panes(page)).toHaveCount(2);
    // Still in the pane it was split into (layout-JSON round trip — pinned
    // as a pure-logic assertion in tests/unit/paneTree.test.ts; this
    // confirms the persisted layout actually restores in the real app).
    await expect(tab(page, ARCH)).toHaveCount(1);
    await expect(tab(page, ARCH)).toBeVisible();
  });
});

/**
 * Phase 17 Milestone D (docs/COMPONENT-BACKLOG.md row 25, VirtualList):
 * proves `components/local/ExplorerTree.tsx` actually virtualizes a
 * real-vault-scale tree — not just that the pure math in
 * `tests/unit/treeFlatten.test.ts`/`virtualization.test.ts` is right, but
 * that the DOM really stays bounded and the tree stays fully usable at
 * scale (scroll, select, open) — and that a normal, below-threshold tree
 * (every other spec in this suite) is completely unaffected.
 *
 * There's no server/terminal to script "write hundreds of files" another
 * way (the app is browser-only per CLAUDE.md); `window.__vsnoteTestSeed`
 * (`stores/useFsStore.ts`) is a permanent, inert-unless-called e2e hook,
 * same precedent as `git/backupRefs.ts`'s `window.__vsnoteGitDebug`. Each
 * `test()` gets its own fresh browser context (this suite's usual
 * isolation), so every test seeds its own `vault/big-folder` fresh.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoApp, openFromTree, tab, treeRow } from "./fixtures";

const SEED_COUNT = 300;

async function seedBigFolder(page: Page): Promise<string> {
  return page.evaluate(async (count) => {
    const hook = (window as unknown as { __vsnoteTestSeed?: { seedLargeFolder: (name: string, n: number) => Promise<string> } })
      .__vsnoteTestSeed;
    if (!hook) throw new Error("window.__vsnoteTestSeed missing — is this a real build?");
    return hook.seedLargeFolder("big-folder", count);
  }, SEED_COUNT);
}

/** Scrolls `viewport` in steps until `target` is attached, same
 * step-through-the-whole-scroller pattern `rich-demo-data.spec.ts` uses for
 * CodeMirror's `.cm-scroller` — robust to not knowing `target`'s exact
 * pixel offset (sibling sort order, root-level rows above it, etc). */
async function scrollUntilVisible(viewport: Locator, target: Locator): Promise<void> {
  const scrollHeight = await viewport.evaluate((el) => el.scrollHeight);
  const clientHeight = await viewport.evaluate((el) => el.clientHeight);
  const steps = Math.max(8, Math.ceil(scrollHeight / Math.max(1, clientHeight)) + 2);
  for (let i = 0; i <= steps; i++) {
    if ((await target.count()) > 0) return;
    const top = Math.round((scrollHeight * i) / steps);
    await viewport.evaluate((el, y) => {
      el.scrollTop = y;
      el.dispatchEvent(new Event("scroll"));
    }, top);
  }
}

test.describe("explorer tree virtualization (Phase 17 Milestone D)", () => {
  test("a vault-scale folder stays bounded in the DOM, and both its ends are reachable and openable", async ({ page }) => {
    await gotoApp(page);
    await seedBigFolder(page);

    const viewport = page.getByTestId("explorer-tree-viewport");
    // Crossing VIRTUALIZE_ROW_THRESHOLD (200) swaps ExplorerTree's root
    // from a plain `<ul role="tree">` to this VirtualList viewport — its
    // presence alone proves virtualization actually engaged.
    await expect(viewport).toBeVisible();

    // (a) Only a bounded number of row elements are ever in the DOM, even
    // though 300 files (+ the folder row + the rest of the demo vault)
    // are logically present — nowhere near mounting one node per row.
    const rowCount = await page.locator("[data-tree-path]").count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThan(100);

    // (b) Scrolling to the very bottom reveals the last row overall, and
    // it's a real, clickable/openable FILE — folders always sort before
    // files (`useFsStore.ts`'s `sortChildren`), so the last row is one of
    // the vault's loose root files, not necessarily inside big-folder;
    // what matters is that it's actually mounted and interactive after
    // scrolling there, not virtualized away.
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    const lastRow = page.locator("[data-tree-path]").last();
    await expect(lastRow).toBeVisible();
    await expect(lastRow).toHaveAttribute("data-tree-kind", "file");
    const lastPath = await lastRow.getAttribute("data-tree-path");
    expect(lastPath).toBeTruthy();
    await lastRow.click();
    await expect(tab(page, lastPath!)).toBeVisible();

    // (c) A file in the MIDDLE of the seeded folder — not near either
    // edge of the scroll range — can be scrolled to, selected, and
    // opened. Not mounted at all until scrolled into the window.
    const midPath = "vault/big-folder/file-0150.md";
    const midRow = treeRow(page, midPath);
    await expect(midRow).toHaveCount(0); // proves it really was virtualized away before scrolling
    await scrollUntilVisible(viewport, midRow);
    await expect(midRow).toBeVisible();
    await midRow.click();
    await expect(tab(page, midPath)).toBeVisible();
  });

  test("the first file in a vault-scale folder is reachable from the top without scrolling", async ({ page }) => {
    await gotoApp(page);
    await seedBigFolder(page);

    const firstPath = "vault/big-folder/file-0000.md";
    const firstRow = treeRow(page, firstPath);
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(tab(page, firstPath)).toBeVisible();
  });

  test("(d) a normal, below-threshold tree opens files exactly as before — virtualization never engages", async ({ page }) => {
    await gotoApp(page);

    // No VirtualList viewport at all: the demo vault's own tree (well
    // under VIRTUALIZE_ROW_THRESHOLD) stays on the original recursive
    // `<ul role="tree">` path.
    await expect(page.getByTestId("explorer-tree-viewport")).toHaveCount(0);
    await expect(page.getByRole("tree")).toBeVisible();

    await openFromTree(page, "vault/notes/reading-list.md");
    await expect(tab(page, "vault/notes/reading-list.md")).toBeVisible();

    await openFromTree(page, "vault/src/indexer.ts", { pin: true });
    await expect(tab(page, "vault/src/indexer.ts")).toBeVisible();
  });
});

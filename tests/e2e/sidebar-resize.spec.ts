/**
 * Phase 6.5c exit criteria (DESIGN-SPEC Amendments item 10): drag the
 * Explorer sidebar's right edge to resize it (reusing `local/PaneGroup.tsx`'s
 * `ResizeHandle` — the same drag primitive a pane divider uses), clamped to
 * a sensible min/max, and persisted across a reload the same way every
 * other `useSettingsStore` field is.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test.describe("sidebar resize", () => {
  test("dragging the resize handle grows/shrinks the sidebar", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    await expect(handle).toBeVisible();

    const widthBefore = (await sidebar.boundingBox())!.width;
    expect(widthBefore).toBeCloseTo(288, 0); // useSettingsStore's DEFAULT_SIDEBAR_WIDTH

    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 120, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    const widthAfterGrow = (await sidebar.boundingBox())!.width;
    expect(widthAfterGrow - widthBefore).toBeGreaterThan(90);
  });

  test("resize is clamped to a minimum around 180px", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    const handleBox = (await handle.boundingBox())!;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Drag far to the left, well past any reasonable minimum.
    await page.mouse.move(handleBox.x - 600, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    const widthAfter = (await sidebar.boundingBox())!.width;
    expect(widthAfter).toBeGreaterThanOrEqual(178); // MIN_SIDEBAR_WIDTH (180), 2px slack for rounding
    expect(widthAfter).toBeLessThan(220);
  });

  test("resized width persists across a reload", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    const handleBox = (await handle.boundingBox())!;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 150, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    const widthAfterDrag = (await sidebar.boundingBox())!.width;
    expect(widthAfterDrag).toBeGreaterThan(320);

    await page.reload();
    await expect(page.locator('[data-tree-path="vault/notes/architecture.md"]')).toBeVisible();
    const widthAfterReload = (await page.getByTestId("explorer-sidebar").boundingBox())!.width;
    expect(widthAfterReload).toBeCloseTo(widthAfterDrag, 0);
  });
});

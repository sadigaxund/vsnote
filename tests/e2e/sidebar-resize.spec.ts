/**
 * Phase 6.5c exit criteria (DESIGN-SPEC Amendments item 10): drag the
 * Explorer sidebar's right edge to resize it (reusing `local/PaneGroup.tsx`'s
 * `ResizeHandle` — the same drag primitive a pane divider uses), clamped to
 * a sensible min/max, and persisted across a reload the same way every
 * other `useSettingsStore` field is.
 *
 * Phase 8 (DESIGN-SPEC Amendments round 3 item 20, "Sidebar collapse/
 * expand") supersedes the old "clamped to a minimum ~180px" behavior:
 * dragging PAST that same threshold now collapses the sidebar to exactly
 * zero width instead of stopping at the minimum — no half-dead sliver in
 * between. Expanding back happens either by dragging the (still-mounted,
 * still-draggable) handle back out, or via the activity bar's VSCode-style
 * icon semantics (clicking the CURRENT view's icon toggles closed/open;
 * clicking a DIFFERENT view's icon always opens that view).
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

  test("dragging past the collapse threshold snaps the sidebar to exactly zero width (item 20)", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    let handleBox = (await handle.boundingBox())!;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Drag far to the left, well past the ~120px collapse threshold.
    await page.mouse.move(handleBox.x - 600, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    // Exactly zero — no half-dead sliver between 0 and MIN_SIDEBAR_WIDTH.
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    const widthAfter = (await sidebar.boundingBox())!.width;
    expect(widthAfter).toBe(0);

    // The handle stays mounted and draggable while collapsed (the "thin
    // grab edge") — dragging it back out restores a sensible width, not
    // wherever the cursor happened to land.
    handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 250, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
    const widthRestored = (await sidebar.boundingBox())!.width;
    expect(widthRestored).toBeGreaterThanOrEqual(178); // MIN_SIDEBAR_WIDTH (180), 2px slack for rounding
  });

  test("collapsed state persists across a reload", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    const handleBox = (await handle.boundingBox())!;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 600, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    // Not `gotoApp()` here — its own boot-wait asserts the tree row is
    // VISIBLE, which a collapsed (zero-width) sidebar deliberately isn't
    // (the row is still mounted, just clipped — see `Sidebar.tsx`'s doc on
    // why the `<aside>` stays in the DOM at width 0 rather than unmounting,
    // so the resize handle keeps working). Wait on the still-open tab
    // instead, which doesn't depend on sidebar visibility at all.
    await page.reload();
    await expect(page.locator('[role="tab"][data-tab-path="vault/notes/architecture.md"]').first()).toBeVisible();
    await expect(page.getByTestId("explorer-sidebar")).toHaveAttribute("data-collapsed", "true");
    expect((await page.getByTestId("explorer-sidebar").boundingBox())!.width).toBe(0);
  });

  test("the sidebar REGION's width/collapse is shared across Explorer, Search, and Source Control — not a per-panel copy (course-correction to item 20)", async ({ page }) => {
    await gotoApp(page);
    const explorerSidebar = page.getByTestId("explorer-sidebar");
    const handle = page.getByTestId("sidebar-resize-handle");
    const handleBox = (await handle.boundingBox())!;

    // Resize while Explorer is active.
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 130, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();
    const explorerWidth = (await explorerSidebar.boundingBox())!.width;
    expect(explorerWidth).toBeGreaterThan(320); // grew from the 288 default

    // Switch to Search — must render at the SAME width, not a frozen 288.
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Search" }).click();
    const searchPanel = page.getByTestId("search-panel");
    await expect(searchPanel).toBeVisible();
    const searchWidth = (await searchPanel.boundingBox())!.width;
    expect(searchWidth).toBeCloseTo(explorerWidth, 0);

    // Switch to Source Control — same story.
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Source Control" }).click();
    const scmPanel = page.getByTestId("scm-panel");
    await expect(scmPanel).toBeVisible();
    const scmWidth = (await scmPanel.boundingBox())!.width;
    expect(scmWidth).toBeCloseTo(explorerWidth, 0);

    // Drag-collapse while Source Control is the ACTIVE panel (not Explorer)
    // — proves the resize handle and collapse threshold are region-level,
    // not Explorer-panel-specific.
    const scmHandleBox = (await page.getByTestId("sidebar-resize-handle").boundingBox())!;
    await page.mouse.move(scmHandleBox.x + scmHandleBox.width / 2, scmHandleBox.y + scmHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(scmHandleBox.x - 600, scmHandleBox.y + scmHandleBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(scmPanel).toHaveAttribute("data-collapsed", "true");
    expect((await scmPanel.boundingBox())!.width).toBe(0);

    // Restore it, then confirm Explorer reflects the SAME restored state —
    // proving it's one shared region, not three independent copies.
    const restoreHandleBox = (await page.getByTestId("sidebar-resize-handle").boundingBox())!;
    await page.mouse.move(restoreHandleBox.x + restoreHandleBox.width / 2, restoreHandleBox.y + restoreHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(restoreHandleBox.x + 250, restoreHandleBox.y + restoreHandleBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(scmPanel).toHaveAttribute("data-collapsed", "false");

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Explorer" }).click();
    await expect(explorerSidebar).toHaveAttribute("data-collapsed", "false");
    expect((await explorerSidebar.boundingBox())!.width).toBeGreaterThanOrEqual(178);
  });

  test("the Extensions activity view renders a real stub panel, never a blank gap (course-correction to item 20)", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    const extensionsPanel = page.getByTestId("extensions-panel");
    await expect(extensionsPanel).toBeVisible();
    await expect(extensionsPanel).toContainText(/not implemented/i);
    // Same shared region width as every other view (default 288 here since
    // this test never dragged the handle).
    expect((await extensionsPanel.boundingBox())!.width).toBeCloseTo(288, 0);
  });

  test("activity bar: clicking the CURRENT view's icon toggles the sidebar closed then open; a DIFFERENT view's icon always opens it (VSCode semantics, item 20)", async ({ page }) => {
    await gotoApp(page);
    const sidebar = page.getByTestId("explorer-sidebar");
    const explorerIcon = page.getByTestId("app-activitybar").getByRole("button", { name: "Explorer" });

    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    // Same (currently-active) icon => toggle closed.
    await explorerIcon.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    // Same icon again => toggle back open.
    await explorerIcon.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    // Collapse it, then switch to a DIFFERENT view — must open (uncollapse)
    // and show that view, not stay collapsed.
    await explorerIcon.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    const scmIcon = page.getByTestId("app-activitybar").getByRole("button", { name: "Source Control" });
    await scmIcon.click();
    await expect(page.getByRole("textbox", { name: "Commit message" })).toBeVisible();

    // Switching back to Explorer (a different-from-scm icon) must also
    // open it uncollapsed.
    await explorerIcon.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
    await expect(sidebar).toBeVisible();
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

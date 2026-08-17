/**
 * Round 6 item 16 — Format/Insert/Export as PDF live in the tab bar's
 * pre-existing `…` menu (per pane), NOT in a title-bar `⋯`. The Phase 15
 * title-bar overflow menu is gone; `EditorTabBar`'s `documentActions` slot
 * (filled by `EditorPane` with `OverflowMenuItems`) is the single home.
 * Also covers item 38's gating following the move: markdown in an editable
 * mode enables Format/Insert; a non-markdown tab disables them.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, openFromTree } from "./fixtures";

test.describe("tab bar overflow menu", () => {
  test("Format/Insert/Export live in the tab bar's … menu; the title bar has no overflow menu", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId("app-titlebar").getByRole("button", { name: "More actions" })).toHaveCount(0);

    await page.getByTestId("overflow-menu-trigger-root").click();
    await expect(page.getByTestId("overflow-menu-format")).toBeVisible();
    await expect(page.getByTestId("overflow-menu-insert")).toBeVisible();
    await expect(page.getByTestId("overflow-menu-export-pdf")).toBeVisible();
    // The pre-existing tab-management items still follow, in the same menu.
    await expect(page.getByRole("menuitem", { name: "Close all tabs" })).toBeVisible();

    // architecture.md (markdown, editable) — Format/Insert enabled.
    await expect(page.getByTestId("overflow-menu-format")).not.toHaveAttribute("data-disabled");
    await page.keyboard.press("Escape");
  });

  test("Format/Insert disable for a non-markdown tab (gating followed the move)", async ({ page }) => {
    await gotoApp(page);
    await openFromTree(page, "vault/metrics.csv", { pin: true });
    await page.getByTestId("overflow-menu-trigger-root").click();
    await expect(page.getByTestId("overflow-menu-format")).toHaveAttribute("data-disabled", "");
    await expect(page.getByTestId("overflow-menu-export-pdf")).toHaveAttribute("data-disabled", "");
    // Tab management stays usable regardless of file kind.
    await expect(page.getByRole("menuitem", { name: "Close others" })).toBeEnabled();
  });
});

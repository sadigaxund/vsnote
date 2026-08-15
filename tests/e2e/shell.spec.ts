/**
 * Phase 1 exit criteria: the static shell's regions are all present and the
 * design tokens (dark theme, teal accent) are actually applied — not just
 * visually plausible in a screenshot, but real computed CSS values.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test.describe("shell", () => {
  test("renders every layout region from DESIGN-SPEC", async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    // DESIGN-SPEC Amendments round 3 item 18 ("Header consolidation"): the
    // centered global-search Input is gone — replaced by a compact
    // command-palette icon button + `⌘K` hint in the title bar's right
    // cluster, whose only job is opening the command palette (same
    // behavior the old, unwired Input never actually had — see
    // `components/TitleBar.tsx`'s doc).
    await expect(page.getByTestId("app-titlebar").getByRole("button", { name: "Command palette" })).toBeVisible();
    await expect(page.getByTestId("app-activitybar")).toBeVisible();
    await expect(page.getByTestId("explorer-sidebar")).toBeVisible();
    await expect(page.getByRole("tree")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Open editors" })).toBeVisible();
    // Item 18's other half: with exactly one pane open (the boot default),
    // there is NO separate `editor-header` band at all — the title bar
    // carries the mode toggle for the focused pane instead.
    await expect(page.getByTestId("editor-header")).toHaveCount(0);
    await expect(page.getByTestId("app-titlebar").getByRole("radio", { name: "Rendered" })).toBeVisible();
    await expect(page.getByTestId("app-statusbar")).toBeVisible();
  });

  test("opening the command palette from the title bar's compact affordance works (item 18)", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-titlebar").getByRole("button", { name: "Command palette" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Explorer lists the exact seeded demo vault contents, assets/ collapsed by default", async ({ page }) => {
    await gotoApp(page);
    for (const path of [
      "vault/notes",
      "vault/src",
      "vault/assets",
      "vault/metrics.csv",
      "vault/vault.config.json",
    ]) {
      await expect(page.locator(`[data-tree-path="${path}"]`)).toBeVisible();
    }
    // assets/ starts collapsed (DESIGN-SPEC §3) — cover.png shouldn't be
    // visible until the folder is expanded.
    await expect(page.locator('[data-tree-path="vault/assets/cover.png"]')).toBeHidden();
    await page.locator('[data-tree-path="vault/assets"]').click();
    await expect(page.locator('[data-tree-path="vault/assets/cover.png"]')).toBeVisible();
  });

  test("applies the Slate dark theme + teal accent design tokens", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("html")).toHaveClass(/dark/);

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        accent: cs.getPropertyValue("--color-primary").trim(),
        chromeBg: cs.getPropertyValue("--app-chrome-bg").trim(),
        editorBg: cs.getPropertyValue("--app-editor-bg").trim(),
      };
    });
    expect(tokens.accent.toLowerCase()).toBe("#27d2c5");
    expect(tokens.chromeBg).toBeTruthy();
    expect(tokens.editorBg).toBeTruthy();

    // The active tab's teal top edge (EditorTabBar.tsx: `borderTop: "2px
    // solid var(--color-primary)"` when active) — a real rendered pixel
    // check, not just "the CSS variable is defined somewhere."
    const activeTab = page.locator('[role="tab"][aria-selected="true"]').first();
    const borderTopColor = await activeTab.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(borderTopColor).toBe("rgb(39, 210, 197)"); // #27d2c5
  });

  test("pinned tabs render non-italic; a single-click preview tab renders italic", async ({ page }) => {
    await gotoApp(page);
    // Every DEFAULT_TABS entry except cover.png opens pinned (App.tsx).
    const architectureLabel = page.locator('[role="tab"][data-tab-path="vault/notes/architecture.md"] span').first();
    await expect(architectureLabel).toHaveCSS("font-style", "normal");

    // Single-click (not double-click) a not-yet-open file to open it as a
    // preview tab — DESIGN-SPEC: preview tab = italic name.
    await page.locator('[data-tree-path="vault/notes/reading-list.md"]').click();
    const previewLabel = page.locator('[role="tab"][data-tab-path="vault/notes/reading-list.md"] span').first();
    await expect(previewLabel).toHaveCSS("font-style", "italic");
  });
});

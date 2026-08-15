/**
 * Phase 6.5c exit criteria (DESIGN-SPEC Amendments item 11): Settings opens
 * as a real TAB in the editor area — never a `role="dialog"` modal — with a
 * left category nav, a search box that filters rows across every category,
 * the "Default view mode" per-file-type row spelled out explicitly (never
 * just "mode" — the exact wording that confused the user in the old
 * dialog), and its "Rendered view" sliders actually reconfiguring the live
 * `LivePreviewEditor` CM6 instance, not just updating a stored number
 * nothing reads.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, openSettingsTab, tab } from "./fixtures";

test.describe("Settings view", () => {
  test("opens as a tab (not a dialog), with a gear icon in the tab strip", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await openSettingsTab(page);

    // A real tab, not a modal overlay.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const settingsTab = tab(page, "settings");
    await expect(settingsTab).toBeVisible();
    await expect(settingsTab).toHaveAttribute("aria-selected", "true");

    // The original architecture.md tab is still there, untouched — opening
    // Settings didn't replace or close anything.
    await expect(tab(page, "vault/notes/architecture.md")).toBeVisible();
  });

  test("category nav switches which settings are shown", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);

    // Appearance is the default category.
    await expect(page.getByTestId("settings-row-theme")).toBeVisible();
    await expect(page.getByTestId("settings-row-font-size")).toHaveCount(0);

    await page.getByTestId("settings-nav-editor").click();
    await expect(page.getByTestId("settings-row-font-size")).toBeVisible();
    await expect(page.getByTestId("settings-row-theme")).toHaveCount(0);

    await page.getByTestId("settings-nav-keyboard").click();
    const shortcuts = page.getByTestId("settings-row-shortcuts");
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts.getByText("⌘K")).toBeVisible();
    await expect(shortcuts.getByText(/Command palette/)).toBeVisible();
  });

  test("search filters rows across every category, independent of the selected nav item", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);

    // Sitting on "Appearance"; search for something that only exists under
    // "Rendered view" and confirm it surfaces anyway.
    await page.getByTestId("settings-search").fill("content max-width");
    await expect(page.getByTestId("settings-row-content-width")).toBeVisible();
    // Rows that don't match are gone, including ones from the CURRENTLY
    // selected category.
    await expect(page.getByTestId("settings-row-theme")).toHaveCount(0);

    await page.getByTestId("settings-search").fill("zzz-does-not-exist-zzz");
    await expect(page.getByText(/No settings match/)).toBeVisible();

    await page.getByTestId("settings-search").fill("");
    await expect(page.getByTestId("settings-row-theme")).toBeVisible();
  });

  test('the per-file-type default mode row is explicitly labeled "Default view mode", never just "mode"', async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-rendered-view").click();

    const row = page.getByTestId("settings-row-default-view-mode");
    await expect(row).toBeVisible();
    await expect(row.getByText("Default view mode", { exact: true })).toBeVisible();
    // The spec's own example wording, spelled out per file type — not a
    // bare "mode" label anywhere in this row.
    await expect(row.getByText("Default view when opening Markdown:")).toBeVisible();
    await expect(row.getByText("Default view when opening JSON:")).toBeVisible();
  });

  test("changing the Rendered view content-width/margin/line-spacing sliders actually reconfigures the live LivePreviewEditor", async ({ page }) => {
    await gotoApp(page);
    // Boot's active tab (architecture.md) is already Rendered mode.
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();
    const before = await content.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { maxWidth: cs.maxWidth, paddingLeft: cs.paddingLeft, lineHeight: getComputedStyle(el.closest(".cm-scroller")!).lineHeight };
    });

    await openSettingsTab(page);
    await page.getByTestId("settings-nav-rendered-view").click();

    // Drag the content-width slider to its max and the margin slider to its
    // max — `fill` on a native <input type="range"> dispatches a real
    // `input` event, which is exactly what the settings store's onChange
    // handlers listen for.
    await page.getByLabel("Rendered content max-width").fill("100");
    await page.getByLabel("Rendered left/right margins").fill("96");
    await page.getByLabel("Rendered line spacing").fill("2.4");

    // Switch back to the markdown tab (still mounted — Settings opened in
    // the SAME pane as a new tab, didn't replace it) and confirm the CM6
    // view picked up the new values with no remount needed.
    await tab(page, "vault/notes/architecture.md").click();
    const after = await content.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { maxWidth: cs.maxWidth, paddingLeft: cs.paddingLeft, lineHeight: getComputedStyle(el.closest(".cm-scroller")!).lineHeight };
    });

    expect(after.maxWidth).not.toBe(before.maxWidth);
    expect(after.paddingLeft).not.toBe(before.paddingLeft);
    expect(after.lineHeight).not.toBe(before.lineHeight);
  });

  test('Git & Sync shows read-only repo info and disabled "coming soon" remote-sync fields (no SSH key UI)', async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-git-sync").click();

    const repoInfo = page.getByTestId("settings-row-repo-info");
    await expect(repoInfo.getByText("feat/incremental-index")).toBeVisible();
    await expect(repoInfo.getByText(/↑3 ↓1/)).toBeVisible();

    await expect(page.getByTestId("settings-row-remote-sync").getByText("Coming soon")).toBeVisible();
    const remoteUrlInput = page.getByLabel("Remote URL");
    await expect(remoteUrlInput).toBeDisabled();
    const tokenInput = page.getByLabel("Personal access token");
    await expect(tokenInput).toBeDisabled();
    // No SSH-key management anywhere in this category (DESIGN-SPEC
    // Amendments item 11: browsers can't speak SSH).
    await expect(page.getByText(/SSH key/i)).toHaveCount(0);
  });

  test("Storage category exposes persistence status, export, and reset actions", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-storage").click();

    await expect(page.getByTestId("settings-row-persistence")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export vault as .zip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset demo vault…" })).toBeVisible();
  });

  test("the Settings tab survives a reload", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.reload();
    await expect(page.locator(`[data-tree-path="vault/notes/architecture.md"]`)).toBeVisible();
    await expect(tab(page, "settings")).toBeVisible();
  });
});

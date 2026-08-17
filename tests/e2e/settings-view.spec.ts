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

  test("content max-width slider's top position is Full — removes the cap, labeled, and persists across reload", async ({ page }) => {
    // DESIGN-SPEC Amendments round 4 item 25.
    await gotoApp(page);
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-rendered-view").click();

    const row = page.getByTestId("settings-row-content-width");
    const slider = page.getByLabel("Rendered content max-width");
    await slider.fill("100");

    // The readout above the slider reads "Full", not a ch number.
    await expect(row.getByText("Full", { exact: true })).toBeVisible();

    // Switching to the live markdown tab, the cap is really gone.
    await tab(page, "vault/notes/architecture.md").click();
    const content = page.locator(".cm-content").first();
    await expect(content).toHaveCSS("max-width", "none");

    // Persists across reload — a fresh boot must still show "Full" and
    // still render with no cap, not silently fall back to a ch value.
    await page.reload();
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-rendered-view").click();
    await expect(page.getByTestId("settings-row-content-width").getByText("Full", { exact: true })).toBeVisible();
    await tab(page, "vault/notes/architecture.md").click();
    await expect(page.locator(".cm-content").first()).toHaveCSS("max-width", "none");
  });

  test("Git & Sync shows real repo info and a live, enabled remote-sync form (no SSH key UI)", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.getByTestId("settings-nav-git-sync").click();

    const repoInfo = page.getByTestId("settings-row-repo-info");
    await expect(repoInfo.getByText("feat/incremental-index")).toBeVisible();
    // Phase 11 (real sync): a fresh vault that has never talked to a
    // remote reports real ↑0 ↓0 — never the old simulated ↑3 ↓1 seed.
    await expect(repoInfo.getByText(/↑0 ↓0/)).toBeVisible();

    // No more "Coming soon" placeholder — the form is live.
    await expect(page.getByTestId("settings-row-remote-sync").getByText("Coming soon")).toHaveCount(0);
    // Phase 10.5a (single-origin refactor, roadmap §5.4): no more editable
    // Remote URL field — the sync remote is implicit (`<origin>/git/
    // vault.git`), shown read-only in the Repository DataList above.
    await expect(page.getByLabel("Remote URL")).toHaveCount(0);
    await expect(repoInfo.getByText(/\/git\/vault\.git$/)).toBeVisible();
    const tokenInput = page.getByLabel("Personal access token");
    await expect(tokenInput).toBeEnabled();
    await expect(page.getByTestId("git-test-connection")).toBeVisible();

    // This test deliberately never signs in first (see `git-sync.spec.ts`
    // for the real, signed-in/token-generated/backend-up path) — clicking
    // "Test connection" with an empty token exercises the real
    // "reachable, but the credentials are rejected" path against the e2e
    // run's actual shared backend (port 8788, proxied same-origin — see
    // `vite.config.ts`): a real 401 from `GET /git/vault.git/info/refs`,
    // mapped by `git/remote.ts::mapError` to `SyncError("auth", ...)`. Must
    // degrade to a clear, specific message — never hang, never crash, never
    // an unhandled rejection (this whole page would otherwise show a
    // Playwright "pageerror" — there is none here because the test doesn't
    // fail).
    await page.getByTestId("git-test-connection").click();
    // DESIGN-SPEC item 41(e) split "Test connection" into three distinct
    // outcomes, so this message is now the auth-rejected one specifically
    // ("credential", singular). Still asserts the message is about the
    // credential rather than merely non-empty.
    await expect(page.getByTestId("git-test-result")).toHaveText(/credential|auth/i);
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

  test("DESIGN-SPEC Amendments round 3 item 23: compact/default/comfortable density measurably scale real chrome band heights", async ({ page }) => {
    await gotoApp(page);

    async function bandHeights() {
      return {
        titlebar: (await page.getByTestId("app-titlebar").boundingBox())!.height,
        tabbar: (await page.getByRole("tablist", { name: "Open editors" }).boundingBox())!.height,
        sidebarHeader: (await page.getByTestId("sidebar-header").boundingBox())!.height,
        treeRow: (await page.locator('[data-tree-path="vault/notes/architecture.md"]').boundingBox())!.height,
        statusbar: (await page.getByTestId("app-statusbar").boundingBox())!.height,
      };
    }

    const defaultHeights = await bandHeights();
    // `default` is the pixel-sampled regression gate — exact values, not
    // just "some positive number" (this is a real change vs. Phase 6.5c,
    // which only ever scaled row/tab horizontal padding).
    expect(defaultHeights.titlebar).toBeCloseTo(40, 0);
    expect(defaultHeights.statusbar).toBeCloseTo(22, 0);

    await openSettingsTab(page);
    await page.getByRole("radio", { name: "Compact" }).click();
    await tab(page, "vault/notes/architecture.md").click();
    const compactHeights = await bandHeights();

    await openSettingsTab(page);
    await page.getByRole("radio", { name: "Comfortable" }).click();
    await tab(page, "vault/notes/architecture.md").click();
    const comfortableHeights = await bandHeights();

    // Every band strictly increases compact -> default -> comfortable —
    // "visibly different at a glance," proven with real measured numbers.
    for (const key of ["titlebar", "tabbar", "sidebarHeader", "treeRow", "statusbar"] as const) {
      expect(compactHeights[key], `${key} compact < default`).toBeLessThan(defaultHeights[key]);
      expect(defaultHeights[key], `${key} default < comfortable`).toBeLessThan(comfortableHeights[key]);
    }
  });

  test("the Settings tab survives a reload", async ({ page }) => {
    await gotoApp(page);
    await openSettingsTab(page);
    await page.reload();
    await expect(page.locator(`[data-tree-path="vault/notes/architecture.md"]`)).toBeVisible();
    await expect(tab(page, "settings")).toBeVisible();
  });
});

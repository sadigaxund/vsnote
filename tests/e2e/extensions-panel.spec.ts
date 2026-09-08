/**
 * R5-9 ("Markii as an extension") exit criteria: the Extensions panel
 * lists Markii, clicking it opens the extension page as an editor-area
 * tab, the page's right-rail TOC scroll-spies, its search filters rows,
 * and the master `Enabled` switch actually turns off directive rendering
 * in a `.mk.md` note's live preview (not just a cosmetic no-op) — see
 * `ExtensionsPanel.tsx`/`ExtensionPage.tsx`/`useMarkiiExtensionSettingsStore.ts`
 * for what's real vs. state-only this round.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, tab, treeRow } from "./fixtures";

test.describe("Extensions panel and the Markii extension page", () => {
  test("lists Markii and opens its extension page on click", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    const panel = page.getByTestId("extensions-panel");
    await expect(panel).toBeVisible();

    const row = page.getByTestId("extension-row-markii");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Markii");
    await expect(page.getByTestId("extension-markii-enabled")).toBeVisible();

    await row.click();
    await expect(tab(page, "extension/markii")).toBeVisible();
    const extensionPage = page.getByTestId("extension-page-markii");
    await expect(extensionPage).toBeVisible();
    await expect(extensionPage.getByRole("heading", { name: "Markii", level: 1 })).toBeVisible();
    await expect(extensionPage).toContainText("markii-org");
  });

  test("the right-rail TOC scroll-spies between sections", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    await page.getByTestId("extension-row-markii").click();
    const extensionPage = page.getByTestId("extension-page-markii");
    await expect(extensionPage).toBeVisible();

    const packsNav = page.getByTestId("settings-nav-packs");
    await expect(packsNav).toBeVisible();
    await packsNav.click();
    await expect(page.getByTestId("extension-group-packs")).toBeInViewport();
    await expect(packsNav).toHaveAttribute("aria-current", "true");

    const aboutNav = page.getByTestId("settings-nav-about");
    await aboutNav.click();
    await expect(page.getByTestId("extension-group-about")).toBeInViewport();
    await expect(aboutNav).toHaveAttribute("aria-current", "true");
    await expect(packsNav).not.toHaveAttribute("aria-current", "true");
  });

  test("search filters the extension page's rows", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    await page.getByTestId("extension-row-markii").click();
    const extensionPage = page.getByTestId("extension-page-markii");
    await expect(extensionPage).toBeVisible();
    await expect(page.getByTestId("extension-row-markii-fence-sugar")).toBeVisible();
    await expect(page.getByTestId("extension-row-markii-scripts-disabled-device")).toBeVisible();

    await page.getByTestId("extension-page-search").fill("fence sugar");
    await expect(page.getByTestId("extension-row-markii-fence-sugar")).toBeVisible();
    await expect(page.getByTestId("extension-row-markii-scripts-disabled-device")).toHaveCount(0);
    await expect(page.getByTestId("extension-group-about")).toHaveCount(0);
  });

  test("Settings keeps a pointer row into Extensions", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await expect(page.getByTestId("settings-open-extensions")).toBeVisible();
    await page.getByTestId("settings-open-extensions").click();
    await expect(page.getByTestId("extension-page-markii")).toBeVisible();
  });

  test("the Enabled switch turns off directive rendering in live preview", async ({ page }) => {
    await gotoApp(page);

    // Create a .mk.md note with a container directive (same mechanic
    // `markii-live-preview.spec.ts` uses).
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("extension-toggle.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/extension-toggle.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("Some intro text.\n\n:::center\nHello from inside.\n:::\n");

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await rendered.getByText("Some intro text.", { exact: false }).click();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();

    // Flip the master switch off from the Extensions panel — opened once;
    // it stays open (sidebar visibility is independent of the active tab),
    // so no need to re-click the activity-bar icon between toggles (a
    // second click on an already-active icon COLLAPSES the sidebar
    // instead — `App.tsx`'s `handleActivitySelect`).
    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    const enabledSwitch = page.getByTestId("extension-markii-enabled");
    await enabledSwitch.click();

    // Same note, still in Rendered mode: the directive widget is gone and
    // the raw `:::` fences show through as plain text instead.
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(true);

    // Flip it back on: the widget returns.
    await enabledSwitch.click();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
  });

  /**
   * R5-9b — "Hide script blocks" (Rendering section): `render.tsx`'s
   * `hideScriptBlocks` option, threaded in by `MarkdownPreviewPane.tsx`.
   * Only a fence whose meta carries a valid `{name=...}` (a real Markii
   * script block, per `@markii/core`'s `extractScripts` rule) is affected —
   * an ordinary fenced code block must stay visible either way.
   */
  test("Hide script blocks removes a script fence from the Preview pane but leaves ordinary code alone", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("hide-script-blocks.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/hide-script-blocks.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type(
      "Intro paragraph.\n\n```lua {name=stars}\nreturn 1\n```\n\n```lua\nreturn 2\n```\n\nOutro paragraph.\n",
    );

    await page.getByTestId("tabbar-preview-toggle").click();
    const preview = page.getByTestId("markdown-preview-pane");
    await expect(preview).toContainText("Outro paragraph.");
    await expect(preview).toContainText("return 1");
    await expect(preview).toContainText("return 2");

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    await page.getByTestId("extension-row-markii").click();
    const hideSwitch = page.getByTestId("markii-hide-script-blocks");
    await expect(hideSwitch).toBeVisible();
    await hideSwitch.click();

    // Opening the extension page navigated the tab away from the note
    // (single-pane, one active tab) — switch back to it; `previewOpen`
    // lives on `OpenTab` (`MarkdownPreviewPane.tsx`'s own doc), so the
    // pane reappears re-rendered against the new setting.
    await tab(page, "vault/src/hide-script-blocks.mk.md").click();
    await expect(preview).toBeVisible();

    // The script block (real name attribute) is gone; the ordinary fence
    // and the surrounding prose are untouched.
    await expect.poll(async () => (await preview.innerText()).includes("return 1")).toBe(false);
    await expect(preview).toContainText("return 2");
    await expect(preview).toContainText("Intro paragraph.");
    await expect(preview).toContainText("Outro paragraph.");
  });

  /**
   * R5-9b — "Fence sugar" (Editor section): `markiiCompletion.ts`'s
   * `markiiEditorExtensions(fenceSugarEnabled)` gates ONLY the manual-typing
   * outer-fence-lengthening Enter keymap (R3-12/DESIGN-SPEC item 117).
   * Mirrors `markii-rendered-editor-sugar.spec.ts`'s own "hand-typing a
   * nested container opener lengthens the outer pair" case, but with the
   * toggle off: the outer fence must stay at three colons instead of
   * growing to four.
   */
  test("Fence sugar off leaves a hand-typed nested container opener's outer fence alone", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    await page.getByTestId("extension-row-markii").click();
    const fenceSugarSwitch = page.getByTestId("markii-fence-sugar");
    await expect(fenceSugarSwitch).toBeVisible();
    await fenceSugarSwitch.click();

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Explorer" }).click();
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("fence-sugar-off.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/fence-sugar-off.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await expect(page.getByRole("radio", { name: "Rendered" })).toBeChecked();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await rendered.click();

    await page.keyboard.type(":::");
    const popup = page.locator(".cm-tooltip-autocomplete");
    await expect(popup).toBeVisible();
    const centerOption = popup.locator("li:has(.cm-completionLabel:text-is('center'))").first();
    await expect(centerOption).toBeVisible();
    await centerOption.click();
    await expect.poll(async () => await rendered.innerText()).toContain(":::center");

    await page.keyboard.type(":::note");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");

    // With Fence sugar off, the outer `center` pair stays at three colons
    // (compare `markii-rendered-editor-sugar.spec.ts`, where the same
    // sequence WITH the toggle on lengthens it to four).
    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await expect.poll(async () => (await source.innerText())).toMatch(/^:::center/m);
    await expect.poll(async () => (await source.innerText())).not.toMatch(/^::::/m);
    await expect.poll(async () => (await source.innerText())).toContain(":::note");
  });

  /**
   * R5-9b — "Reveal hint" (Editor section): `decorations.ts`'s
   * `maybePushRevealHint` is gated by `revealHintEnabled`, threaded in by
   * `LivePreviewEditor.tsx`. Off means the once-per-session ".mk-reveal-hint"
   * span never appears, even the first time a directive is revealed.
   */
  test("Reveal hint off never shows the once-per-session reveal hint", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Extensions" }).click();
    await page.getByTestId("extension-row-markii").click();
    const revealHintSwitch = page.getByTestId("markii-reveal-hint");
    await expect(revealHintSwitch).toBeVisible();
    await revealHintSwitch.click();

    await page.getByTestId("app-activitybar").getByRole("button", { name: "Explorer" }).click();
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("reveal-hint-off.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/reveal-hint-off.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("Some intro text.\n\n:::center\nHello from inside.\n:::\n");

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    // Move the caret INTO the directive to reveal its raw source — the
    // exact action that would normally trigger the hint.
    await rendered.getByText("Hello from inside.", { exact: false }).click();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(true);
    await expect(rendered.locator(".mk-reveal-hint")).toHaveCount(0);
  });
});

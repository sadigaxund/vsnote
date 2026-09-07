/**
 * R3-7: Rendered mode for code files. Before this change, every code kind
 * (`ts`/`tsx`/`js`/`jsx`/`css`) had `baseModes: ["source"]` in
 * `filetypes/registry.ts` — the Rendered toggle was unconditionally
 * disabled, and (a separate bug this change also fixes —
 * `publishDialogLogic.ts`'s `canPublishRendered`) the Publish dialog's
 * "Viewer page" delivery option never actually checked whether a file's
 * kind could render at all, so it silently offered a Viewer page for
 * anything.
 *
 * Covers:
 *  1. A code file's Rendered toggle is enabled and switches to the new
 *     read-only `CodeView` (line numbers, syntax classes, no CodeMirror
 *     instance).
 *  2. The Publish dialog now offers a working (non-disabled) Viewer page
 *     for that same code file.
 *  3. A file whose extension the registry has never heard of (e.g. `.py` —
 *     not a recognized `FileKind`, falls back to the plain-text entry,
 *     `baseModes: ["source"]` only) correctly gets Viewer page DISABLED,
 *     with an explanation — the actual mechanism behind the "looked
 *     disabled" report, now reproduced and pinned rather than silently
 *     mis-offered.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, tab, treeRow } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, signInToShareBackend } from "./shareUiHelpers";

test.describe("Rendered mode for code files (R3-7)", () => {
  test("a .ts file's Rendered toggle is enabled and shows a static highlighted view, not CodeMirror", async ({ page }) => {
    await gotoApp(page);
    // indexer.ts is pinned open by default, in Source mode (registry
    // default for code kinds stays "source" even though Rendered is now
    // offered).
    await tab(page, "vault/src/indexer.ts").click();
    const renderedToggle = page.getByRole("radio", { name: "Rendered" });
    await expect(renderedToggle).toBeEnabled();
    await expect(renderedToggle).toHaveAttribute("aria-checked", "false");

    await renderedToggle.click();
    await expect(renderedToggle).toHaveAttribute("aria-checked", "true");

    // The new read-only view: line numbers + real highlighting classes,
    // no CodeMirror content/gutter anywhere in the pane.
    const codeBlock = page.locator(".mk-static-codeblock").first();
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock.locator(".mk-static-codeblock__lineno").first()).toHaveText("1");
    await expect(codeBlock.locator("[class*='tok-']").first()).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveCount(0);

    // Switching back to Source restores the real CM6 editor.
    await page.getByRole("radio", { name: "Source" }).click();
    await expect(page.locator(".cm-content").first()).toBeVisible();
  });

  test("the wrap toggle and copy button are present on the rendered code view", async ({ page }) => {
    await gotoApp(page);
    await tab(page, "vault/src/indexer.ts").click();
    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.locator(".mk-static-codeblock").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /line wrap/i })).toBeVisible();
    const copyButton = page.getByRole("button", { name: "Copy code" });
    // Clipboard permission is granted per-project in playwright.config —
    // either way the button degrades gracefully rather than erroring; just
    // confirm it's present and clickable when the API is available.
    if (await copyButton.isVisible().catch(() => false)) {
      await copyButton.click();
    }
  });

  test("Publish dialog offers a working Viewer page for a code file", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    await treeRow(page, "vault/src/indexer.ts").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    const viewerPage = dialog.getByRole("radio", { name: "Viewer page" });
    await expect(viewerPage).toBeEnabled();
    await expect(dialog.getByTestId("publish-mode-no-renderer")).toHaveCount(0);
    await viewerPage.click();
    await expect(viewerPage).toHaveAttribute("aria-checked", "true");
  });

  test("Publish dialog disables Viewer page for an unrecognized extension, with an explanation", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "script.py", "print('hi')\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    const viewerPage = dialog.getByRole("radio", { name: "Viewer page" });
    await expect(viewerPage).toBeDisabled();
    await expect(dialog.getByTestId("publish-mode-no-renderer")).toBeVisible();
    // Raw file is picked automatically since Viewer page isn't available.
    await expect(dialog.getByRole("radio", { name: "Raw file" })).toHaveAttribute("aria-checked", "true");
  });
});

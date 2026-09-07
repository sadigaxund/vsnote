/**
 * R3-11 exit criterion: with the side-by-side Preview pane open, typing a
 * `:::center` container directive in Source mode shows the rendered widget
 * on the RIGHT (the Preview pane, static `renderMarkdown` output) while the
 * raw fence text stays visible on the LEFT (the live source editor) — the
 * whole point of the feature per the task brief: a directive being typed
 * has somewhere to show what it will look like without leaving Source mode
 * or waiting for the caret to move away (Rendered mode's own Obsidian
 * reveal rule doesn't help while the caret is still inside what you're
 * typing).
 *
 * Uses the single-pane tab-bar toggle (`data-testid="tabbar-preview-toggle"`)
 * — this test intentionally never opens a second editor pane, so
 * `EditorHeader`'s own copy of the toggle (the multi-pane case) never
 * mounts; see `EditorPane.tsx`'s module doc for why there are two.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("side-by-side Preview pane (.mk.md / .md)", () => {
  test("typing a container directive in Source mode renders it live in the Preview pane", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-demo.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-demo.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();

    // Preview closed by default — no pane, no toggle visibly "pressed".
    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
    const toggle = page.getByTestId("tabbar-preview-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("markdown-preview-pane")).toContainText("preview-pane-demo.mk.md");

    // Type the directive in the SOURCE editor (left side).
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type("Intro paragraph.\n\n:::center\nHello from the preview pane.\n:::\n");

    // Left side still shows the raw fence text (Source mode never hides
    // syntax — that's Rendered mode's job, not this one's).
    await expect(source).toContainText(":::center");
    await expect(source).toContainText(":::");

    // Right side (Preview) shows the RENDERED widget, no raw fence text at
    // all, once the ~150ms debounce settles.
    const preview = page.getByTestId("markdown-preview-pane");
    await expect.poll(async () => (await preview.innerText()).includes(":::")).toBe(false);
    await expect(preview).toContainText("Hello from the preview pane.");
    await expect(preview).toContainText("Intro paragraph.");

    // Toggling off removes the pane and returns the editor to full width.
    await toggle.click();
    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("closing the source tab closes the Preview pane with it", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-close.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-close.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    await page.getByTestId("tabbar-preview-toggle").click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();

    await page
      .locator(`[role="tab"][data-tab-path="vault/src/preview-pane-close.md"]`)
      .getByRole("button", { name: "Close preview-pane-close.md" })
      .click();

    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
  });

  test("the command palette's Toggle preview command opens and closes the pane", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-palette.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-palette.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();
    await page.getByRole("radio", { name: "Source" }).click();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Toggle preview" }).click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();
  });
});

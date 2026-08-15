/**
 * Phase 3 exit criteria: CM6 mounts in Source mode with real syntax
 * highlighting, the git gutter's marker count agrees with the diff chip,
 * Diff mode renders a real vs-HEAD comparison, and a real commit clears
 * every indicator together.
 *
 * Phase 6.5b (DESIGN-SPEC Amendments round 2) landed the two items an
 * earlier in-flight scope note here said were deliberately left loose:
 *  - Item 9's find widget (`tests/e2e/find-widget.spec.ts` has the full
 *    coverage — opening/prefill, native highlighting, navigation, replace,
 *    per-pane targeting, Esc). This file no longer needs its own Ctrl+F
 *    test since that spec owns the feature end to end.
 *  - Item 13 replaced the Diff-mode Split/Unified `SegmentedControl` with a
 *    compact icon-only one in `EditorHeader` — still `getByRole("radio",
 *    {name: "Unified"})` (the button keeps its accessible name via
 *    `aria-label` even with the label text hidden), so the test below now
 *    also drives the toggle and cross-checks the DOM it actually produces
 *    (`@codemirror/merge`'s `.cm-mergeViewEditor` — two side-by-side
 *    editors in split mode, zero in unified, per
 *    `node_modules/@codemirror/merge/dist/index.js`).
 */
import { test, expect } from "@playwright/test";
import { gotoApp, tab } from "./fixtures";

test.describe("editor + diff", () => {
  test("CM6 mounts in Source mode with real syntax highlighting", async ({ page }) => {
    await gotoApp(page);
    // indexer.ts is pinned open by default, in Source mode already
    // (registry default for code kinds).
    await tab(page, "vault/src/indexer.ts").click();
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();
    await expect(page.locator(".cm-gutters").first()).toBeVisible();
    // Real tokenization, not plain unstyled text: `editor/theme.ts`'s
    // `HighlightStyle.define(...)` generates CM6's own hashed per-tag CSS
    // classes (e.g. `class="ͼc"`) on syntax spans inside `.cm-line` — only
    // present when a language parser + highlighter actually ran, never on
    // plain unstyled text nodes.
    await expect(content.locator(".cm-line span[class]").first()).toBeVisible();
  });

  test("git gutter's added+modified marker count equals the diff chip's +N", async ({ page }) => {
    await gotoApp(page);
    await tab(page, "vault/src/indexer.ts").click();
    await expect(page.locator(".cm-gutters").first()).toBeVisible();

    const chipText = await page.getByTestId("app-titlebar").getByText(/^\+\d+$/).first().textContent();
    const expectedAdded = Number(chipText?.replace("+", ""));
    expect(expectedAdded).toBeGreaterThan(0);

    const markerCount = await page
      .locator(".cm-git-gutter-mark--added, .cm-git-gutter-mark--modified")
      .count();
    expect(markerCount).toBe(expectedAdded);
  });

  test("Diff mode renders a real @codemirror/merge comparison vs HEAD", async ({ page }) => {
    await gotoApp(page);
    // architecture.md: DESIGN-SPEC's spec-mandated +12 -5.
    const header = page.getByTestId("app-titlebar");
    await expect(header).toContainText("+12");
    await expect(header).toContainText("-5");

    await page.getByRole("radio", { name: "Diff" }).click();
    // Real @codemirror/merge output (not a static placeholder): its own
    // change-highlight classes appear, and there's more than one of them
    // (this file has both additions and removals per the chip above).
    await expect(page.locator(".cm-changedLine, .cm-deletedLine, .cm-insertedLine").first()).toBeVisible();
    const highlightCount = await page.locator(".cm-changedLine, .cm-deletedLine, .cm-insertedLine").count();
    expect(highlightCount).toBeGreaterThan(1);
  });

  test("Diff layout toggle (item 13): icon-only SegmentedControl swaps MergeView between split and unified", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("radio", { name: "Diff" }).click();

    // Split is the default: two side-by-side `.cm-mergeViewEditor`s (HEAD +
    // working), per `@codemirror/merge`'s `MergeView`.
    await expect(page.locator(".cm-mergeViewEditor")).toHaveCount(2);

    // The layout toggle lives in the editor header, next to the mode
    // toggle — icon-only, but still `role="radio"` with an `aria-label`
    // (SegmentedControl's `iconOnly` prop), each wrapped in a `Tooltip`.
    const header = page.getByTestId("app-titlebar");
    const unifiedBtn = header.getByRole("radio", { name: "Unified" });
    const splitBtn = header.getByRole("radio", { name: "Split" });
    await expect(unifiedBtn).toBeVisible();
    await expect(splitBtn).toBeVisible();
    await expect(splitBtn).toHaveAttribute("aria-checked", "true");

    await unifiedBtn.click();
    // Unified mode is a single EditorView with `unifiedMergeView` — no
    // `.cm-mergeViewEditor` wrapper at all, and the real merge output
    // (`.cm-changedLine`/etc.) is still present, just in one column.
    await expect(page.locator(".cm-mergeViewEditor")).toHaveCount(0);
    await expect(page.locator(".cm-changedLine, .cm-deletedLine, .cm-insertedLine").first()).toBeVisible();
    await expect(unifiedBtn).toHaveAttribute("aria-checked", "true");

    // The toggle is NOT rendered outside Diff mode.
    await page.getByRole("radio", { name: "Source" }).click();
    await expect(header.getByRole("radio", { name: "Unified" })).toHaveCount(0);
  });

  test("commit flow clears the tree letters, badge, and diff chip together", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Source Control" }).click();
    const commitBox = page.getByRole("textbox", { name: "Commit message" });
    await expect(commitBox).toBeVisible();
    await commitBox.fill("chore: commit everything for the e2e test");
    await page.getByRole("button", { name: "Commit" }).click();

    await expect(page.getByText("No changes.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Source Control" })).toContainText("0");
    await expect(page.getByTestId("app-titlebar")).not.toContainText("+12");
  });
});

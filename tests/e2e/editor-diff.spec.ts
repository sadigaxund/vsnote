/**
 * Phase 3 exit criteria: CM6 mounts in Source mode with real syntax
 * highlighting, the git gutter's marker count agrees with the diff chip,
 * Diff mode renders a real vs-HEAD comparison, and a real commit clears
 * every indicator together.
 *
 * Two exit-criteria items are deliberately NOT covered as tightly as they
 * could be, per an in-flight scope note from a concurrent Phase 6.5 worker
 * (DESIGN-SPEC.md's "Amendments round 2", commit `5ac81d7`, items 9 & 13):
 *  - Ctrl+F today opens CM6's stock `@codemirror/search` panel
 *    (`.cm-panel.cm-search`), but item 9 replaces it with a VSCode-style
 *    floating find/replace widget with entirely different DOM. A spec
 *    pinned to `.cm-panel.cm-search` would need rewriting the moment that
 *    lands, so it's intentionally omitted here rather than committed only
 *    to immediately go stale — revisit once the new find widget ships.
 *  - Diff mode's exact line-count-vs-chip cross-check is omitted for the
 *    same reason: item 13 replaces the ad-hoc Split/Unified
 *    `SegmentedControl` (today's `getByRole("radio", {name: "Unified"})`)
 *    with a compact icon-only control, so any test driving today's control
 *    by its visible text would break immediately. The test below checks
 *    Diff mode renders a REAL `@codemirror/merge` comparison (not the
 *    exact count match) until that control's redesign lands.
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

    const chipText = await page.getByTestId("editor-header").getByText(/^\+\d+$/).first().textContent();
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
    const header = page.getByTestId("editor-header");
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

  test("commit flow clears the tree letters, badge, and diff chip together", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "Source Control" }).click();
    const commitBox = page.getByRole("textbox", { name: "Commit message" });
    await expect(commitBox).toBeVisible();
    await commitBox.fill("chore: commit everything for the e2e test");
    await page.getByRole("button", { name: "Commit" }).click();

    await expect(page.getByText("No changes.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Source Control" })).toContainText("0");
    await expect(page.getByTestId("editor-header")).not.toContainText("+12");
  });
});

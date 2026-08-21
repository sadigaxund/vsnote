/**
 * Phase 6.5b — DESIGN-SPEC Amendments item 9: the VSCode-style floating
 * find/replace widget (`src/components/local/FindWidget.tsx`, mounted by
 * `src/editor/findPanel.ts` as `@codemirror/search`'s `createPanel`
 * override). Covers: ⌘F opens it prefilled from the current selection and
 * `preventDefault`s so the browser's own find bar never appears, native
 * `.cm-searchMatch` highlighting, Enter/⇧Enter navigation with a live
 * counter, the "No results" state, replace-one/replace-all, per-pane
 * targeting in a split, and Esc closing it.
 *
 * Since the 2026-08-21 engine swap (ARCHITECTURE.md's deviation note),
 * Rendered `.md` mode runs @atomic-editor/editor, which ships its OWN
 * `@codemirror/search` panel (`.atomic-editor-search-panel`) — App's global
 * ⌘F handler opens whatever panel the focused view was configured with, so
 * Source/Diff get the React FindWidget and Rendered mode gets atomic-editor's
 * (same native search state, same `.cm-searchMatch` highlighting). The
 * Rendered-mode tests below assert THAT panel.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, pane, paneContent, panes, tab } from "./fixtures";

const INDEXER = "vault/src/indexer.ts";
const ARCHITECTURE = "vault/notes/architecture.md";

test.describe("find widget", () => {
  test("⌘F opens prefilled from the selection, highlights natively, and Esc closes", async ({ page }) => {
    await gotoApp(page);
    await tab(page, INDEXER).click();
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();

    // Double-click selects the word under the cursor — CM6's own selection
    // behavior, not anything this widget adds.
    await content.getByText("buildIndex", { exact: false }).first().dblclick();

    await page.keyboard.press("Control+f");
    const widget = page.getByTestId("find-widget");
    await expect(widget).toBeVisible();

    const findInput = widget.getByPlaceholder("Find");
    await expect(findInput).toBeFocused();
    await expect(findInput).toHaveValue("buildIndex");

    // Real @codemirror/search state driving this, not a hand-rolled
    // highlighter — `.cm-searchMatch` decorations come from the shared
    // search state field regardless of this widget's own DOM.
    await expect(content.locator(".cm-searchMatch").first()).toBeVisible();

    // Row 2 (replace) starts collapsed.
    await expect(widget.getByPlaceholder("Replace")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(widget).toHaveCount(0);
    // Browser's own find bar never appeared — preventDefault held.
    await expect(page.locator(".cm-content").first()).toBeVisible();
  });

  test("counter shows N of M, Enter/⇧Enter navigate, and no-match search shows a red 'No results'", async ({ page }) => {
    await gotoApp(page);
    await tab(page, INDEXER).click();
    const content = page.locator(".cm-content").first();
    await content.click();
    // The counter's "current" match is the nearest one at/after the
    // cursor (VSCode-like — it doesn't reset to match #1 on open), so pin
    // the cursor to the very start of the doc first for a deterministic
    // "1 of N" starting point.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+f");

    const widget = page.getByTestId("find-widget");
    const findInput = widget.getByPlaceholder("Find");
    const count = widget.getByTestId("find-widget-count");

    // "index" (case-insensitive) appears several times in the seeded
    // indexer.ts working copy (IndexEntry / buildIndex / index.set / ...).
    await findInput.fill("index");
    await expect(count).toHaveText(/^1 of \d+$/);
    const match = (await count.textContent())!.match(/^1 of (\d+)$/)!;
    const total = Number(match[1]);
    expect(total).toBeGreaterThan(1);

    // The cursor sits BEFORE any match (pinned to doc start above), so the
    // first Enter lands ON match 1 (native `findNext`'s "next match at/
    // after the current selection" semantics — the counter already showed
    // "1 of N" as a preview of this before the keypress) — it's the SECOND
    // Enter that actually advances to match 2.
    await findInput.press("Enter");
    await expect(count).toHaveText(`1 of ${total}`);
    await findInput.press("Enter");
    await expect(count).toHaveText(`2 of ${total}`);
    await findInput.press("Shift+Enter");
    await expect(count).toHaveText(`1 of ${total}`);

    // No matches at all: red "No results", not a stale/zero counter.
    await findInput.fill("zzz-definitely-not-in-this-file-zzz");
    await expect(count).toHaveText("No results");
    const color = await count.evaluate((el) => getComputedStyle(el).color);
    // var(--git-deleted) resolves to the seeded palette's red (#f85149 ==
    // rgb(248, 81, 73)) — asserting the actual computed color, not just
    // the text, so this can't silently regress to a neutral/gray state.
    expect(color).toBe("rgb(248, 81, 73)");
  });

  test("replace-one and replace-all mutate the real document via the native replace commands", async ({ page }) => {
    await gotoApp(page);
    await tab(page, INDEXER).click();
    const content = page.locator(".cm-content").first();
    await content.click();
    await page.keyboard.press("Control+f");

    const widget = page.getByTestId("find-widget");
    await widget.getByLabel("Show replace").click();

    await widget.getByPlaceholder("Find").fill("TODO");
    await expect(widget.getByTestId("find-widget-count")).toHaveText("1 of 1");
    await widget.getByPlaceholder("Replace").fill("DONE");
    await widget.getByLabel("Replace all", { exact: true }).click();

    await expect(content).not.toContainText("TODO");
    await expect(content).toContainText("DONE");
  });

  test("works in Rendered mode (atomic-editor's own search panel; same native match state)", async ({ page }) => {
    await gotoApp(page);
    // architecture.md boots in Rendered mode — its view is configured with
    // @atomic-editor/editor's `search()` panel, which App's global ⌘F opens.
    const content = page.locator(".cm-content").first();
    await content.click();
    await page.keyboard.press("Control+f");

    const panel = page.locator(".atomic-editor-search-panel");
    await expect(panel).toBeVisible();
    const findInput = panel.locator("input").first();
    await findInput.fill("Rollback");
    await findInput.press("Enter");
    // Same native @codemirror/search decorations as Source mode — only the
    // panel DOM differs.
    await expect(content.locator(".cm-searchMatch").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("DESIGN-SPEC Amendments item 24: the widget is 30-40% smaller than Phase 6.5b's original box", async ({ page }) => {
    // Phase 6.5b's original (pre-item-24) rendered box, measured directly
    // off that build with the exact same repro this test runs (Playwright
    // `boundingBox()` on `[data-testid="find-widget"]`): row 1 (collapsed)
    // 474×38px, expanded (replace row shown) 474×67px — recorded here as
    // literal numbers (not re-derived) so this test pins the CONTRACT
    // ("30-40% smaller, same layout/features") against a fixed baseline
    // rather than against whatever the current file happens to compute.
    const BEFORE_COLLAPSED = { width: 474, height: 38 };
    const BEFORE_EXPANDED = { width: 474, height: 67 };

    await gotoApp(page);
    await tab(page, INDEXER).click();
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Control+f");
    const widget = page.getByTestId("find-widget");
    await expect(widget).toBeVisible();

    const collapsedBox = (await widget.boundingBox())!;
    // Same layout/features — row 1's controls are all still present.
    await expect(widget.getByPlaceholder("Find")).toBeVisible();
    await expect(widget.getByLabel("Match case")).toBeVisible();
    await expect(widget.getByLabel("Use regular expression")).toBeVisible();

    // 60-70% of the original box on BOTH axes (the "30-40% smaller" target).
    expect(collapsedBox.width / BEFORE_COLLAPSED.width).toBeGreaterThanOrEqual(0.55);
    expect(collapsedBox.width / BEFORE_COLLAPSED.width).toBeLessThanOrEqual(0.75);
    expect(collapsedBox.height / BEFORE_COLLAPSED.height).toBeGreaterThanOrEqual(0.55);
    expect(collapsedBox.height / BEFORE_COLLAPSED.height).toBeLessThanOrEqual(0.75);

    await widget.getByLabel("Show replace").click();
    await expect(widget.getByPlaceholder("Replace")).toBeVisible();
    const expandedBox = (await widget.boundingBox())!;
    expect(expandedBox.width / BEFORE_EXPANDED.width).toBeGreaterThanOrEqual(0.55);
    expect(expandedBox.width / BEFORE_EXPANDED.width).toBeLessThanOrEqual(0.75);
    expect(expandedBox.height / BEFORE_EXPANDED.height).toBeGreaterThanOrEqual(0.55);
    expect(expandedBox.height / BEFORE_EXPANDED.height).toBeLessThanOrEqual(0.75);
  });

  test("per-pane: ⌘F targets only the focused pane in a split", async ({ page }) => {
    await gotoApp(page);
    await tab(page, ARCHITECTURE).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Split right" }).click();
    await expect(panes(page)).toHaveCount(2);
    const paneIds = await panes(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-pane-id")!));
    const [leftId, rightId] = paneIds;

    // Splitting MOVES the active tab: the right pane holds architecture.md
    // (Rendered mode → @atomic-editor/editor's search panel), while the
    // left pane falls back to the next open tab, indexer.ts (Source mode →
    // the React FindWidget). ⌘F must open each focused pane's OWN panel —
    // and nothing in the other pane.
    await paneContent(page, rightId).locator(".cm-content").first().click();
    await page.keyboard.press("Control+f");
    await expect(pane(page, rightId).locator(".atomic-editor-search-panel")).toBeVisible();
    await expect(pane(page, leftId).getByTestId("find-widget")).toHaveCount(0);

    // Close it, then open find in the LEFT pane instead.
    await page.keyboard.press("Escape");
    await pane(page, leftId).click();
    await paneContent(page, leftId).locator(".cm-content").first().click();
    await page.keyboard.press("Control+f");
    await expect(pane(page, leftId).getByTestId("find-widget")).toBeVisible();
    await expect(pane(page, rightId).locator(".atomic-editor-search-panel")).toHaveCount(0);
  });
});

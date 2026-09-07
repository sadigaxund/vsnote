/**
 * Phase 4 exit criteria — the centerpiece: Obsidian-style live preview.
 * Blurred = no raw markdown markers anywhere. Caret in the bold word reveals
 * EXACTLY ONE `**…**` pair (a real count assertion, not just "some markup is
 * visible") while headings/links stay rendered, not raw. Moving away
 * (blur) re-renders it clean again.
 *
 * Uses the seeded `architecture.md` working-tree content (fs/seed.ts's
 * `ARCHITECTURE_MD_WORKING`), which DESIGN-SPEC's own Phase 4 exit
 * criterion names directly: "cursor in the bold word reveals only
 * `**append-only**`".
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test.describe("live preview (Rendered mode)", () => {
  test("unfocused: no raw markdown markers, headings/links/lists render styled", async ({ page }) => {
    await gotoApp(page);
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();

    const text = (await content.innerText()).trim();
    expect(text).not.toContain("**"); // no raw bold markers anywhere
    expect(text).not.toMatch(/^#{1,6}\s/m); // no raw "# Heading" lines
    expect(text).not.toContain("[indexer.ts]("); // link rendered, not raw markdown

    // Styled, not raw: the H1 line class + a styled link span for the link.
    // (Class names are @atomic-editor/editor's — see ARCHITECTURE.md's
    // deviation note on the 2026-08-21 engine swap.)
    await expect(page.locator(".cm-atomic-h1")).toBeVisible();
    await expect(content.locator(".cm-atomic-link", { hasText: "indexer.ts" })).toBeVisible();
  });

  test("clicking into the bold word reveals exactly one **…** pair; blurring re-hides it", async ({ page }) => {
    await gotoApp(page);
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();

    const countMarkers = async () => {
      const text = await content.innerText();
      return (text.match(/\*\*/g) ?? []).length;
    };

    expect(await countMarkers()).toBe(0);

    await content.getByText("append-only", { exact: false }).click();
    await expect.poll(countMarkers).toBe(2); // exactly one **…** pair revealed

    // Everything else stays rendered while that one span is revealed.
    const revealedText = await content.innerText();
    expect(revealedText).not.toMatch(/^#{1,6}\s/m);
    expect(revealedText).not.toContain("[indexer.ts](");
    expect(revealedText).toContain("**append-only**");

    // Blur (click a real element outside the editor) re-hides it.
    await page.getByPlaceholder("Filter files").click();
    await expect.poll(countMarkers).toBe(0);
  });

  test("moving the cursor to a different paragraph re-renders the previous reveal", async ({ page }) => {
    await gotoApp(page);
    const content = page.locator(".cm-content").first();
    const countMarkers = async () => (await content.innerText()).match(/\*\*/g)?.length ?? 0;

    await content.getByText("append-only", { exact: false }).click();
    await expect.poll(countMarkers).toBe(2);

    // Click into the H1 heading instead — its own `#` reveals, but the bold
    // marker from before must be gone (not both revealed at once).
    await content.getByText("Indexing architecture", { exact: false }).click();
    await expect.poll(countMarkers).toBe(0); // bold marker re-hidden
    await expect(content).toContainText("# Indexing architecture"); // heading mark now revealed at the new cursor
  });

  /**
   * Regression guard for the fix in this changeset (ee14f44 shipped this
   * multi-line selection behavior with no e2e guard at all).
   *
   * `RectangleMarker.forRange`/`rectanglesForRange`
   * (`node_modules/@codemirror/view/dist/index.js`) draws a multi-line
   * selection as one rect per visual line: the first and last lines from
   * the actual measured cursor position (always correct — atomic-editor's
   * own `.cm-content` box), every CONTINUATION line ("between" lines, fully
   * covered) from a `leftSide`/`rightSide` pair computed ONCE per selection
   * from `.cm-content`'s bounding rect plus a `.cm-line`'s computed
   * horizontal padding. If that shared inset lives on the wrong element
   * (`.cm-content` or `.cm-scroller` instead of `.cm-line` itself — see
   * `src/index.css`'s "Live-preview selection alignment" comment for the
   * two different ways this went wrong), the continuation lines' rects
   * diverge from the first/last lines' rects: they either undershoot the
   * text (pre-ee14f44) or overshoot into the reading column's margins
   * (ee14f44 itself). Asserting every selected line's rect shares exactly
   * one left edge and one right edge catches BOTH failure modes without
   * hard-coding a pixel value that would break on font/measure changes.
   */
  test("multi-line selection spans exactly the text column on every line, including a partial last line", async ({
    page,
  }) => {
    await gotoApp(page);
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();

    // A real multi-line selection: click into the middle of a line, Home to
    // its start, then Shift+Down three times to cross at least one full
    // "continuation" line before landing partway into a fourth (partial,
    // "open-ended") line — the exact shape `rectanglesForRange` special-cases
    // (top piece, one or more "between" pieces, bottom piece).
    await content.getByText("append-only", { exact: false }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");

    const rects = await page.locator(".cm-selectionBackground").evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    // At least top + one "between" + bottom piece expected for a 4-line
    // selection; if this ever comes back thin, the keyboard recipe above
    // stopped producing a multi-line selection and the test below would
    // otherwise pass vacuously.
    expect(rects.length).toBeGreaterThanOrEqual(3);

    const contentBox = await content.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });

    const lefts = new Set(rects.map((r) => Math.round(r.left)));
    const rights = new Set(rects.map((r) => Math.round(r.right)));
    // One consistent left edge and one consistent right edge across every
    // selected line — not "first line differs from the rest" (the original
    // bug) and not "some lines are wider than others" (the ee14f44
    // regression: continuation lines bleeding into the margins).
    expect(lefts.size).toBe(1);
    expect(rights.size).toBe(1);

    // And that one shared edge sits at the text column, not out in the
    // margins flanking it: within a few px of `.cm-content`'s own box,
    // never at `.cm-scroller`'s wider edge.
    const [left] = lefts;
    const [right] = rights;
    expect(Math.abs(left - contentBox.left)).toBeLessThanOrEqual(4);
    expect(Math.abs(right - contentBox.right)).toBeLessThanOrEqual(4);
  });
});

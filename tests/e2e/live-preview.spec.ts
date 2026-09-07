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

    // The column the text actually occupies, measured the same way
    // CodeMirror's own `rectanglesForRange` measures it: the first
    // `.cm-line`'s box inset by its own horizontal padding. That is the
    // library's definition of `leftSide`/`rightSide`, so asserting against
    // it pins the selection to the glyph column rather than to whichever
    // element happens to carry the inset this month.
    const column = await content.evaluate((el) => {
      const line = el.querySelector(".cm-line");
      if (!line) throw new Error("no .cm-line");
      const r = line.getBoundingClientRect();
      const cs = window.getComputedStyle(line);
      return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
    });

    // No rect may start left of the column or end right of it: that is the
    // margin bleed the ee14f44 inset caused, and the mirror-image
    // undershoot the inset before it caused.
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(column.left - 1);
      expect(r.right).toBeLessThanOrEqual(column.right + 1);
    }

    // The full-width "between" pieces must span the column exactly. The
    // first and last pieces are open-ended at one side only, since the
    // selection starts and ends mid-document, so they are not required to.
    const widest = Math.max(...rects.map((r) => r.right - r.left));
    const spanning = rects.filter((r) => r.right - r.left > widest - 1);
    expect(spanning.length).toBeGreaterThanOrEqual(1);
    for (const r of spanning) {
      expect(Math.abs(r.left - column.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.right - column.right)).toBeLessThanOrEqual(1);
    }
  });

  /**
   * R4 defect A — clicking into the editor previously painted a low-alpha
   * halo (`box-shadow`) at `.cm-content`'s own box edges: the reading
   * column's centered `max-width` + `margin-inline: auto` box (see
   * `index.css`'s "Live-preview selection alignment" note), which reads as
   * two vertical lines exactly where the margins end. Root cause: the
   * generic `:focus-visible` outline+halo rule (`index.css`, round 10 item
   * 102) matches `.cm-content` because it is `contenteditable` — same as
   * `input`/`textarea`, it matches on a plain mouse click, not just
   * keyboard nav. Fixed by suppressing outline/box-shadow on
   * `.cm-editor`/`.cm-content`/`.cm-scroller` specifically (the caret
   * already indicates focus); this guards the regression directly instead
   * of only visually.
   */
  test("clicking into the editor paints no outline/halo on .cm-editor/.cm-content", async ({ page }) => {
    await gotoApp(page);
    const content = page.locator(".cm-content").first();
    await content.getByText("append-only", { exact: false }).click();

    const painted = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const sel of [".cm-editor", ".cm-content", ".cm-scroller"]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const s = getComputedStyle(el);
        const hasOutline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const hasShadow = s.boxShadow !== "none";
        if (hasOutline || hasShadow) offenders.push(`${sel}: outline=${s.outline} boxShadow=${s.boxShadow}`);
      }
      return offenders;
    });
    expect(painted).toEqual([]);
  });
});

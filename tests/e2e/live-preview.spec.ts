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
});

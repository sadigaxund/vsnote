/**
 * Phase M2 (docs/PLAN-2026-09-05-refresh.md §6) exit criterion: the
 * Obsidian live-preview cursor rule (DESIGN-SPEC item 61 and earlier —
 * "raw syntax revealed only around the cursor, instant re-render on
 * leave") applied to a markii container directive inside a `.mk.md` file's
 * Rendered mode. Mirrors `live-preview.spec.ts`'s own structure (plain
 * `.md`'s bold-marker reveal test) but for `:::name{}...:::`.
 *
 * There's no seeded `.mk.md` fixture in the demo vault yet, so this test
 * creates one via the Explorer's "New File" flow (same mechanic
 * `fs-git.spec.ts`'s "create, rename, and delete a file" test uses), types
 * a container directive in Source mode, then switches to Rendered mode to
 * exercise the cursor rule.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("markii directive live preview (.mk.md Rendered mode)", () => {
  test("cursor outside a container directive shows the rendered widget; cursor inside reveals raw source", async ({
    page,
  }) => {
    await gotoApp(page);

    // Create `vault/src/directive-demo.mk.md` via the Explorer context menu.
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("directive-demo.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/directive-demo.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    // Type the document in Source mode — a plain paragraph, then a
    // container directive, so the "cursor elsewhere" case has somewhere
    // real to click.
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("Some intro text.\n\n:::center\nHello from inside.\n:::\n");

    // Rendered mode: with the cursor nowhere near the directive, it must
    // show as a rendered widget, not raw `:::` fences.
    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(false);
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
    await expect(rendered.locator(".mk-live-preview-block")).toContainText("Hello from inside.");

    // Move the cursor inside the container by clicking its rendered text —
    // CM6 places the caret at the nearest document position, which for a
    // block-widget-replaced range lands inside the hidden span. Raw source
    // must reappear, and the widget must be gone (Obsidian's own reveal
    // behavior: only ever one representation on screen for a given span,
    // never both).
    await rendered.locator(".mk-live-preview-block").click();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(true);
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    await expect(rendered).toContainText("Hello from inside.");
    await expect(rendered).toContainText(":::");

    // Moving away re-renders it clean again — click into the intro
    // paragraph instead.
    await rendered.getByText("Some intro text.", { exact: false }).click();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(false);
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
  });

  /**
   * Regression guard for `mkBlockVerticalNavigation`
   * (`src/markdown/directiveLezer/decorations.ts`) — arrowing into a
   * collapsed container directive's block widget used to leave the caret
   * visually stuck at the widget's right/bottom edge (a `Decoration.replace
   * ({ block: true })` range has no text for CM6's x-preserving vertical
   * motion to land in, so it resolved to the range's END regardless of
   * approach direction) instead of entering the block. The status bar's
   * `Ln n, Col n` readout (`src/components/StatusBar.tsx`) is used as a
   * precise, DOM-visible proxy for the actual caret position — there is no
   * other way to read a CM6 selection's document offset from outside the
   * page.
   *
   * Document (1-based lines):
   *   1  Some intro text.
   *   2  (blank)
   *   3  :::center
   *   4  Hello from inside.
   *   5  :::
   *   6  (blank)
   *   7  Outro text.
   *
   * Both approaches start from the END of the adjacent paragraph (a large,
   * non-zero horizontal caret position) specifically so the browser's
   * x-preserving vertical motion is actually exercised — starting from
   * column 1 would trivially land at the block's left edge even without
   * the fix and prove nothing.
   */
  test("arrowing into a collapsed container directive enters it instead of getting stuck at its edge", async ({
    page,
  }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("directive-nav.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/directive-nav.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await source.click();
    await page.keyboard.type(
      "Some intro text.\n\n:::center\nHello from inside.\n:::\n\nOutro text.\n",
    );

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();

    const lnCol = page.locator("text=/^Ln \\d+, Col \\d+$/");

    // Entering from ABOVE: end of line 1, then down through the blank line
    // 2, then into the container — must land on its OPENING fence line
    // (line 3), at the very start of it, not swallowed into the widget.
    await rendered.getByText("Some intro text.", { exact: false }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    await expect(lnCol).toHaveText("Ln 3, Col 1");

    // Leave the block again (re-collapses) before testing the other
    // direction, so this second approach also starts from a real reveal
    // transition rather than continuing inside an already-open block.
    await rendered.getByText("Outro text.", { exact: false }).click();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();

    // Entering from BELOW: end of line 7, then up through the blank line 6,
    // then into the container — must land on its CLOSING fence line
    // (line 5), at the very end of it (the last real position in the
    // block), not swallowed into the widget from the other side.
    await rendered.getByText("Outro text.", { exact: false }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    await expect(lnCol).toHaveText("Ln 5, Col 4");
  });
});

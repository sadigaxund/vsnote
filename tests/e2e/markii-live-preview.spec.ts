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
});

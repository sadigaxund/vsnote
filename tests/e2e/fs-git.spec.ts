/**
 * Phase 2 exit criteria: real git status letters (M/A/D/U) + strikethrough
 * on the tree, the Source Control badge count, the `+12 -5` diff chip being
 * a genuinely COMPUTED diff (not a hardcoded prop), file ops (create/
 * rename/delete), tree drag & drop moving a file (and that move changing
 * git status), and the filter input.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("fs + git", () => {
  test("tree shows the exact seeded M/A/D/U letters, deleted file struck through", async ({ page }) => {
    await gotoApp(page);

    await expect(treeRow(page, "vault/notes/architecture.md")).toContainText("M");
    await expect(treeRow(page, "vault/src/indexer.ts")).toContainText("M");
    await expect(treeRow(page, "vault/metrics.csv")).toContainText("M");
    await expect(treeRow(page, "vault/notes/daily-2026-08-14.md")).toContainText("U");
    await expect(treeRow(page, "vault/src/GraphView.tsx")).toContainText("A");

    const deletedRow = treeRow(page, "vault/src/legacy-parser.ts");
    await expect(deletedRow).toContainText("D");
    const nameSpan = deletedRow.locator("span").filter({ hasText: "legacy-parser.ts" });
    await expect(nameSpan).toHaveCSS("text-decoration-line", "line-through");
  });

  test("Source Control badge shows the total changed-file count", async ({ page }) => {
    await gotoApp(page);
    // architecture.md, indexer.ts, metrics.csv (M) + legacy-parser.ts (D) +
    // GraphView.tsx (A) + daily-2026-08-14.md (U) = 6, per DESIGN-SPEC §3.
    const scmButton = page.getByRole("button", { name: "Source Control" });
    await expect(scmButton).toBeVisible();
    await expect(scmButton).toContainText("6");
  });

  test("the +12 -5 chip is a real computed diff, not a hardcoded prop", async ({ page }) => {
    await gotoApp(page);
    // architecture.md is the default active tab; its diff chip lives in the
    // editor header regardless of mode (fetched independent of Rendered/
    // Source/Diff — EditorPane.tsx's effect keys only on the path).
    const header = page.getByTestId("app-titlebar");
    await expect(header).toContainText("+12");
    await expect(header).toContainText("-5");

    // Prove it's computed: edit the file in Source mode and save a bigger
    // change — the chip must change to reflect the new real diff.
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nExtra appended line for the diff test.\n");
    await page.keyboard.press("Control+s");
    await expect(header).not.toContainText("+12");
  });

  test("create, rename, and delete a file via the Explorer", async ({ page }) => {
    await gotoApp(page);

    // The context menu's "New File" passes an explicit parent path (unlike
    // the sidebar header button, which infers the parent from whichever
    // FILE was last selected — a folder row's click only toggles
    // expand/collapse, per ExplorerTree.tsx, so it never becomes
    // `selectedId`) — the deterministic way to target src/ specifically.
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/untitled.md");
    await expect(newFileRow).toBeVisible();

    // Inline rename input replaces the row's label — scoped to the row
    // itself (`treeRow(...).locator("input")`) rather than an `:focus`
    // pseudo-class check: closing the right-click ContextMenu returns
    // focus to its trigger (the row) shortly after the input's own
    // `autoFocus` fires, a real Radix focus-return race that made
    // `input:focus` flake here — `.fill()` focuses its target itself, so
    // scoping by DOM location sidesteps the race entirely.
    await newFileRow.locator("input").fill("brand-new-note.md");
    await newFileRow.locator("input").press("Enter");
    const renamedRow = treeRow(page, "vault/src/brand-new-note.md");
    await expect(renamedRow).toBeVisible();

    // Rename again via the right-click context menu.
    await renamedRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await renamedRow.locator("input").fill("renamed-again.md");
    await renamedRow.locator("input").press("Enter");
    await expect(treeRow(page, "vault/src/renamed-again.md")).toBeVisible();

    // Delete via context menu + confirm dialog.
    await treeRow(page, "vault/src/renamed-again.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(treeRow(page, "vault/src/renamed-again.md")).toHaveCount(0);
  });

  test("right-click Rename focuses the inline input immediately — no extra click needed", async ({ page }) => {
    // Regression test for a real bug the Phase 7 suite found and the test
    // above worked around rather than fixed (see its own comment): Radix's
    // ContextMenu returning focus to its trigger raced the rename <Input>'s
    // `autoFocus`, and Radix often won. This test types via the keyboard
    // straight after picking "Rename" — no `.fill()`, no extra click — so
    // it fails exactly the way a real user hitting the bug would notice:
    // the first keystrokes going nowhere.
    await gotoApp(page);
    const row = treeRow(page, "vault/notes/reading-list.md");
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();

    const input = row.locator("input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Select-all + type, exactly like a user who clicked Rename and started
    // typing immediately expects to happen.
    await page.keyboard.press("Control+a");
    await page.keyboard.type("renamed-via-keyboard.md");
    await page.keyboard.press("Enter");

    await expect(treeRow(page, "vault/notes/renamed-via-keyboard.md")).toBeVisible();
  });

  test("dragging a file into a folder moves it and changes git status", async ({ page }) => {
    await gotoApp(page);
    // reading-list.md is committed + unmodified (no status letter) at boot.
    const source = treeRow(page, "vault/notes/reading-list.md");
    await expect(source).toBeVisible();
    await expect(source).not.toContainText(/[MADU]/);

    const target = treeRow(page, "vault/src");
    await source.dragTo(target);

    // Old location becomes a synthesized "D" ghost row (git sees the
    // committed path as removed, ARCHITECTURE.md's `useDecoratedTree`
    // doc); new location shows up as untracked "U" — a plain fs rename,
    // not a `git mv`, so git has no rename awareness (ARCHITECTURE.md's
    // drag & drop Deviation note).
    await expect(treeRow(page, "vault/notes/reading-list.md")).toContainText("D");
    await expect(treeRow(page, "vault/src/reading-list.md")).toContainText("U");
  });

  test("the filter input narrows the tree to matching files, auto-expanding folders", async ({ page }) => {
    await gotoApp(page);
    await page.getByPlaceholder("Filter files").fill("indexer");
    await expect(treeRow(page, "vault/src/indexer.ts")).toBeVisible();
    await expect(treeRow(page, "vault/notes/architecture.md")).toHaveCount(0);
    await expect(treeRow(page, "vault/vault.config.json")).toHaveCount(0);

    await page.getByPlaceholder("Filter files").fill("");
    await expect(treeRow(page, "vault/notes/architecture.md")).toBeVisible();
  });
});

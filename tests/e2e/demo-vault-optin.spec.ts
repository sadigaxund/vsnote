/**
 * DESIGN-SPEC Amendments round 9 item 45 (supersedes the item 36 opt-in
 * coverage this file used to carry): a demo build runs on a SEPARATE
 * lightning-fs database with `wipe: true`, so the demo is a per-session
 * sandbox and the destructive "Load demo vault" command was removed
 * entirely. What's covered here — all against the suite's DEMO build (see
 * `package.json`'s `test:e2e`):
 *
 *  1. The self-destruct command can never surface: typing its exact old
 *     label into the palette yields no such action.
 *  2. The sandbox really is ephemeral: an edit made in-session vanishes on
 *     reload, and the seeded demo state comes back pristine.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("demo vault sandbox (item 45)", () => {
  test("the destructive 'Load demo vault' command no longer exists in the palette", async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await page.keyboard.type("Load demo");

    // Filtered to nothing matching the old self-destruct label...
    await expect(palette.getByRole("button", { name: /Load demo vault/i })).toHaveCount(0);

    // The SAFE demo command still exists — clear the filter to reach it.
    for (let i = 0; i < 9; i += 1) await page.keyboard.press("Backspace");
    await palette.getByRole("button", { name: "Reset demo vault…" }).click();
    // It keeps its confirm dialog — wiping even a sandbox deserves consent.
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText(/re-seeds/i)).toBeVisible();
  });

  test("the demo filesystem is ephemeral: session edits vanish on reload", async ({ page }) => {
    await gotoApp(page);

    // Leave a mark that the seeded vault has never contained.
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const draft = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(draft).toBeVisible();
    await draft.locator("input").fill("only-mine.md");
    await draft.locator("input").press("Enter");
    await expect(treeRow(page, "vault/src/only-mine.md")).toBeVisible();

    // Reload = new page load = lightning-fs `wipe: true` drops the sandbox DB,
    // boot re-seeds it from scratch.
    await gotoApp(page);

    await expect(treeRow(page, "vault/src/only-mine.md")).toHaveCount(0);
    await expect(treeRow(page, "vault/notes/architecture.md")).toBeVisible();
    await expect(treeRow(page, "vault/src/searchRank.ts")).toBeVisible();
    await expect(treeRow(page, "vault/metrics.csv")).toBeVisible();
  });
});

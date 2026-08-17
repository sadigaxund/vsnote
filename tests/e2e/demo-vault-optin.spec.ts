/**
 * DESIGN-SPEC Amendments round 5 item 36 — the demo vault is opt-in.
 *
 * What this file can and cannot cover: the suite builds with
 * `VSNOTE_DEMO_VAULT=1` (see `package.json`'s `test:e2e` and the note in
 * `fixtures.ts`), so every spec here runs against a DEMO build. The
 * welcome-vault default is a different bundle and is verified outside
 * Playwright, by building without the flag. What IS covered here is the
 * half that lives in the app rather than the build: the "Load demo vault"
 * palette command, and the fact that it warns before destroying a vault.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow, waitForNoDialog } from "./fixtures";

test.describe("demo vault opt-in (item 36)", () => {
  test("'Load demo vault' warns that it replaces the vault, then restores demo content", async ({ page }) => {
    await gotoApp(page);

    // Prove the load really REPLACES the vault rather than merging into it:
    // add a file that the demo vault has never contained, so its
    // DISAPPEARANCE can only come from a genuine wipe + reseed. (Deleting a
    // seeded file and watching it return is the weaker check — a plain
    // store refresh can resurrect a row without any reseed happening.)
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const draft = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(draft).toBeVisible();
    await draft.locator("input").fill("only-mine.md");
    await draft.locator("input").press("Enter");
    await expect(treeRow(page, "vault/src/only-mine.md")).toBeVisible();

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await page.keyboard.type("Load demo vault");
    await palette.getByRole("button", { name: /Load demo vault/ }).click();

    // The replace warning is the point of the command, not decoration.
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/Replaces your current vault/)).toBeVisible();

    await confirm.getByRole("button", { name: "Load demo vault" }).click();
    await waitForNoDialog(page);

    // The added file is gone (the vault was really replaced) and the demo
    // content is present.
    await expect(treeRow(page, "vault/src/only-mine.md")).toHaveCount(0);
    await expect(treeRow(page, "vault/notes/architecture.md")).toBeVisible();
    await expect(treeRow(page, "vault/notes/reading-list.md")).toBeVisible();
    await expect(treeRow(page, "vault/metrics.csv")).toBeVisible();
  });

  test("cancelling the warning leaves the vault untouched", async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog");
    await page.keyboard.type("Load demo vault");
    await palette.getByRole("button", { name: /Load demo vault/ }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await waitForNoDialog(page);

    await expect(treeRow(page, "vault/notes/architecture.md")).toBeVisible();
  });
});

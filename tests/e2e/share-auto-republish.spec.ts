/**
 * Round 7 item 58 — folder shares FOLLOW the folder: a file created inside
 * a shared folder shows up in the share without a manual "Update share"
 * (debounced client auto-republish, `src/share/autoRepublish.ts`), and a
 * deliberately EXCLUDED file stays excluded across that auto-republish
 * (the exclusion-memory tier of the module's safety contract).
 *
 * Shares the one e2e backend (port 8788) with the other share specs; this
 * file's own folder share targets `vault/src` so it never collides with
 * `share-folder.spec.ts`'s `vault/notes` share.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFolderViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

test.describe("folder share auto-republish (round 7 item 58)", () => {
  test("a new file inside a shared folder appears in the share; an excluded file never does", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFolderViaContextMenu(page, {
      treePath: "vault/src",
      generalAccess: "link",
      renderMode: "rendered",
      excludeRelpaths: ["theme.css"],
    });

    // The excluded file 404s before anything changes (baseline).
    const excluded = await page.request.get(`${link}/theme.css`, { headers: { Accept: "application/json" } });
    expect(excluded.status()).toBe(404);

    // Create a new file INSIDE the shared folder through the real UI.
    await createFileWithContent(page, "vault/src", "auto-added.md", "# added after publish");

    // The debounced republish (3s + network) lands without any manual
    // "Update share" — poll the public share endpoint until it serves it.
    await expect
      .poll(
        async () => (await page.request.get(`${link}/auto-added.md`, { headers: { Accept: "application/json" } })).status(),
        { timeout: 20_000 },
      )
      .toBe(200);
    const added = await page.request.get(`${link}/auto-added.md`, { headers: { Accept: "application/json" } });
    expect((await added.json()).content).toContain("added after publish");

    // The deliberate exclusion survived the auto-republish.
    const stillExcluded = await page.request.get(`${link}/theme.css`, { headers: { Accept: "application/json" } });
    expect(stillExcluded.status()).toBe(404);
  });
});

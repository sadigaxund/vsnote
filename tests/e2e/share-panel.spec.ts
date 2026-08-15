/**
 * The Shared panel (Settings → Sharing → Shared): hit count increments
 * after a fetch, and revoke removes the share from the active list.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME, SHARE_BACKEND_BASE_URL } from "./shareFixtures";
import { publishFileViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; it locates only ITS OWN share row (by the
// unique slug in `link`), never by absolute row count or position.
test.describe("Shared panel", () => {
  test("hit count increments after a fetch; revoke removes the row", async ({ page, context }) => {
    await gotoApp(page);
    await signInToShareBackend(page, SHARE_BACKEND_BASE_URL, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/architecture.md",
      generalAccess: "link",
      renderMode: "rendered",
    });
    const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;
    const row = page.locator('[data-testid^="shared-row-"]', { hasText: identifier });
    await expect(row).toBeVisible();
    const hitsCell = row.locator('[data-testid^="shared-hits-"]');
    await expect(hitsCell).toHaveText("0"); // fresh share, zero hits

    // Fetch the share (a real page visit, not a raw API call) via a second
    // tab in the SAME context — this is the owner checking their own link,
    // not the second-context "stranger" scenario the other specs cover.
    const viewer = await context.newPage();
    await viewer.goto(link);
    await expect(viewer.getByText("Indexing architecture", { exact: false })).toBeVisible();
    await viewer.close();

    await page.getByTestId("shared-refresh").click();
    await expect(hitsCell).not.toHaveText("0");

    await revokeShareByLink(page, link);
    await expect(row).toHaveCount(0);
  });
});

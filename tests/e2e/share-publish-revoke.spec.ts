/**
 * Phase 10 exit criterion (`docs/IMPLEMENTATION-PLAN-V2.md`): publish → open
 * the share in a SECOND browser context (fresh, no shared storage) →
 * content renders → revoke → the same URL now shows the unavailable state.
 * A real backend (`tests/e2e/shareFixtures.ts`) is spawned for this file.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME, SHARE_BACKEND_BASE_URL } from "./shareFixtures";
import { publishFileViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; it locates only ITS OWN share (by the unique
// slug in `link`), never by absolute row count or position.
test.describe("publish → view → revoke (exit criterion)", () => {
  test("a published rendered-mode share is viewable from a fresh context, then dies on revoke", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, SHARE_BACKEND_BASE_URL, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/architecture.md",
      generalAccess: "link",
      renderMode: "rendered",
    });
    expect(link).toContain("/share/");

    // A SECOND, fully independent browser context — no cookies, no
    // localStorage carried over from `page` — standing in for "a stranger
    // who was handed this link".
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();

    await secondPage.goto(link);
    await expect(secondPage.getByText("Indexing architecture", { exact: false })).toBeVisible();
    // No shell chrome on the share route.
    await expect(secondPage.getByTestId("app-titlebar")).toHaveCount(0);
    await expect(secondPage.getByTestId("explorer-sidebar")).toHaveCount(0);

    // Revoke from the owner's Shared panel.
    await revokeShareByLink(page, link);

    // The exact same URL, same context, now dies.
    await secondPage.goto(link);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();
    await expect(secondPage.getByText("Indexing architecture", { exact: false })).toHaveCount(0);

    await secondContext.close();
  });
});

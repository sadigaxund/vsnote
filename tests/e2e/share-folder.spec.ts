/**
 * Phase 10.5 exit criterion (`docs/IMPLEMENTATION-PLAN-V2.md`): publish a
 * folder → browse the tree in a SECOND browser context → an excluded file
 * 404s (the same generic unavailable state as everything else) → revoke →
 * the whole subtree is gone. Plus the Explorer share indicator (own +
 * inherited variants) and the Shared registry's folder-kind listing.
 *
 * Shares the one e2e backend (port 8788, `tests/e2e/globalSetup.ts`) with
 * the other `share-*.spec.ts` files — this file's own folder share has a
 * unique slug, so it never collides with theirs.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME, SHARE_BACKEND_BASE_URL } from "./shareFixtures";
import { publishFolderViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

test.describe("folder shares (roadmap §5.1)", () => {
  test("publish a folder, browse the tree in a second context, an excluded file 404s, revoke kills the subtree", async ({
    page,
    browser,
  }) => {
    await gotoApp(page);
    await signInToShareBackend(page, SHARE_BACKEND_BASE_URL, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFolderViaContextMenu(page, {
      treePath: "vault/notes",
      generalAccess: "link",
      renderMode: "rendered",
      excludeRelpaths: ["reading-list.md"],
    });
    expect(link).toContain("/share/");

    // Explorer own/inherited indicators (roadmap §5.1) — the folder root
    // gets the "own" glyph, a file inside it gets the muted "inherited"
    // one.
    await expect(page.locator('[data-testid="share-indicator-own-vault/notes"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-indicator-inherited-vault/notes/architecture.md"]')).toBeVisible();

    // A SECOND, fully independent browser context — a stranger with the link.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();

    await secondPage.goto(link);
    // Slim reader: tree left, content right, no shell chrome.
    await expect(secondPage.getByTestId("share-folder-tree")).toBeVisible();
    await expect(secondPage.getByTestId("app-titlebar")).toHaveCount(0);
    await expect(secondPage.getByTestId("explorer-sidebar")).toHaveCount(0);
    await expect(secondPage.getByTestId("share-folder-entry-architecture.md")).toBeVisible();
    // The excluded file is simply ABSENT from the listing — not shown,
    // not grayed out.
    await expect(secondPage.getByTestId("share-folder-entry-reading-list.md")).toHaveCount(0);

    // Click into the included file — content renders on the right.
    await secondPage.getByTestId("share-folder-entry-architecture.md").click();
    await expect(secondPage.getByText("Indexing architecture", { exact: false })).toBeVisible();

    // A direct deep link to the EXCLUDED file — the same generic
    // "unavailable" state as every other deny reason (no existence oracle,
    // roadmap §1/§5.1), never a distinct "excluded" message.
    const excludedUrl = `${link}/reading-list.md`;
    await secondPage.goto(excludedUrl);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();

    // A direct deep link to an UNKNOWN relpath — the identical state.
    await secondPage.goto(`${link}/does/not/exist.md`);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();

    // Shared registry (Settings → Sharing) lists the folder share with its
    // kind visible.
    await page.getByTestId("settings-nav-sharing").click();
    const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;
    const row = page.locator('[data-testid^="shared-row-"]', { hasText: identifier });
    await expect(row).toBeVisible();
    await expect(row.getByTestId(/shared-kind-/)).toBeVisible();

    // Revoke — the WHOLE subtree dies, not just the root.
    await revokeShareByLink(page, link);
    await secondPage.goto(link);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();
    await secondPage.goto(`${link}/architecture.md`);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();

    await secondContext.close();
  });
});

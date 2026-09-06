/**
 * The "Shared" activity-bar view (docs/PLAN-2026-09-05-refresh.md §2,
 * replacing Settings → Sharing → Shared / `local/SharedPanel.tsx`): hit
 * count increments after a fetch, and revoke removes the share from the
 * active list.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { openSharedView, publishFileViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; it locates only ITS OWN share row (by the
// unique slug in `link`), never by absolute row count or position.
test.describe("Shared view", () => {
  test("hit count increments after a fetch; revoke removes the row", async ({ page, context }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/architecture.md",
      generalAccess: "link",
      renderMode: "rendered",
    });
    const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;

    await openSharedView(page);
    const row = page.locator("tr", { hasText: identifier });
    await expect(row).toBeVisible();
    // Column order: Source, Link, Mode, Access, Links to/from, Hits,
    // Created, Last accessed, Actions (`SharedView.tsx`'s `columns`).
    const hitsCell = row.locator("td").nth(5);
    await expect(hitsCell).toHaveText("0"); // fresh share, zero hits

    // Fetch the share (a real page visit, not a raw API call) via a second
    // tab in the SAME context — this is the owner checking their own link,
    // not the second-context "stranger" scenario the other specs cover.
    const viewer = await context.newPage();
    await viewer.goto(link);
    await expect(viewer.getByText("Indexing architecture", { exact: false })).toBeVisible();
    await viewer.close();

    await page.getByLabel("Refresh shares").click();
    // Round 7 item 59 — exactly 1, not just "not 0": the real browser
    // navigation above triggers the SPA shell AND its own immediate
    // content re-fetch for the same visit; a double-count regression would
    // silently pass a looser "not 0" assertion.
    await expect(hitsCell).toHaveText("1");

    await revokeShareByLink(page, link);
    await expect(row).toHaveCount(0);
  });
});

/**
 * Phase 10 exit criterion (`docs/IMPLEMENTATION-PLAN-V2.md`): publish → open
 * the share in a SECOND browser context (fresh, no shared storage) →
 * content renders → revoke → the same URL now shows the unavailable state.
 * A real backend (`tests/e2e/shareFixtures.ts`) is spawned for this file.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { publishFileViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; it locates only ITS OWN share (by the unique
// slug in `link`), never by absolute row count or position.
//
// Phase 12c flake fix: this spec used to target the SAME file
// (`vault/notes/architecture.md`) as `share-panel.spec.ts` AND
// `share-password.spec.ts`, all three under the same `e2e-owner` account.
// `fullyParallel: true` runs those spec files concurrently, and the
// Explorer row context menu shows "Manage share…" instead of "Publish…"
// the moment ANY "own" share already exists for that exact path (see
// `ExplorerTree.tsx`'s `ownShare ? <Manage share…> : <Publish…>` branch) —
// so whichever of the three specs' publish call landed on the shared
// backend first silently flipped the other two specs' context menu out
// from under them, and `getByRole("menuitem", { name: "Publish…" })` in
// `shareUiHelpers.ts` waited for an item that would never appear until the
// whole test timed out. Confirmed directly from a failed run's page
// snapshot: the context menu showed "Manage share…" with an existing
// `vault/notes/architecture.md` row already in the Sharing settings table.
// This reproduced under this box's parallel load and never in isolation
// only because the race needs two of the three specs' publish calls to
// actually overlap — plausible under load, near-impossible running solo.
// The real fix is giving each of the three specs its own file so none of
// them can ever collide on the "own share" check, not a bigger timeout
// (which would have masked the same race, just made it rarer).
test.describe("publish → view → revoke (exit criterion)", () => {
  test("a published rendered-mode share is viewable from a fresh context, then dies on revoke", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/reading-list.md",
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
    await expect(secondPage.getByText("Reading list", { exact: false })).toBeVisible();
    // No shell chrome on the share route.
    await expect(secondPage.getByTestId("app-titlebar")).toHaveCount(0);
    await expect(secondPage.getByTestId("explorer-sidebar")).toHaveCount(0);

    // Revoke from the owner's Shared panel.
    await revokeShareByLink(page, link);

    // The exact same URL, same context, now dies.
    await secondPage.goto(link);
    await expect(secondPage.getByTestId("share-unavailable-title")).toBeVisible();
    await expect(secondPage.getByText("Reading list", { exact: false })).toHaveCount(0);

    await secondContext.close();
  });
});

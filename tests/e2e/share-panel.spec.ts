/**
 * The "Shared" activity-bar view (docs/PLAN-2026-09-05-refresh.md §2,
 * replacing Settings → Sharing → Shared / `local/SharedPanel.tsx`): hit
 * count increments after a fetch, and revoke removes the share from the
 * active list.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import {
  createFileWithContent,
  openSharedView,
  publishFileViaContextMenu,
  revokeShareByLink,
  signInToShareBackend,
} from "./shareUiHelpers";

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
    // Column order: Source, Link, Mode, Access, Freshness, Links to, Linked
    // from, Hits, Last accessed, Actions (`SharedView.tsx`'s `columns` —
    // round 10 item 98 split the old single truncating "Links to/from" cell
    // into two narrow numeric columns, shifting Hits to index 6; round 17
    // item 131 then inserted "Freshness" between Access and Links to,
    // shifting Hits again, to index 7).
    const hitsCell = row.locator("td").nth(7);
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

  // R5-6 "Update share" — a fresh file (own path, never touched by the
  // other test above) so editing it can't race the shared demo vault's
  // `architecture.md`. Freshness column index: 4 (Source, Link, Mode,
  // Access, Freshness, ...).
  test("editing a shared file's content shows Stale; Update share clears it and the reader serves the new bytes", async ({ page, context }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const filePath = await createFileWithContent(page, "vault/notes", "stale-refresh-test.md", "original content, v1");

    const link = await publishFileViaContextMenu(page, {
      treePath: filePath,
      generalAccess: "link",
      renderMode: "raw",
    });
    const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;

    await openSharedView(page);
    const row = page.locator("tr", { hasText: identifier });
    await expect(row).toBeVisible();
    const freshnessCell = row.locator("td").nth(4);
    // Freshly published — nothing to flag yet (a plain em dash, no chip).
    await expect(freshnessCell).not.toHaveText("Stale");

    // Edit the file straight in the editor (it's already open from
    // `createFileWithContent`) and save — the share record is untouched,
    // only the vault file's bytes change.
    await page.getByRole("tab", { name: /stale-refresh-test\.md/ }).first().click();
    const editor = page.locator(".cm-content").first();
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("edited content, v2 — no longer matches the pinned snapshot");
    await page.keyboard.press("Control+s");

    await openSharedView(page);
    await page.getByLabel("Refresh shares").click();
    await expect(freshnessCell).toHaveText("Stale");

    // "Update share" from the row's overflow menu.
    await row.getByLabel(/^Actions for/).click();
    await page.getByTestId(/^shared-update-/).click();
    await expect(page.getByText("Share updated", { exact: true })).toBeVisible();
    await expect(freshnessCell).not.toHaveText("Stale");

    // The reader now serves the NEW bytes at the SAME link — a real
    // browser navigation (matching how a visitor actually reaches it;
    // `ShareApp.tsx` re-fetches the content itself via a same-origin
    // `Accept: application/json` request once the SPA shell mounts).
    const viewer = await context.newPage();
    await viewer.goto(link);
    await expect(viewer.getByText("edited content, v2", { exact: false })).toBeVisible();
    await viewer.close();

    await revokeShareByLink(page, link);
  });
});

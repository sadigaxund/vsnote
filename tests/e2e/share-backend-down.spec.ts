/**
 * Backend-down degradation (CLAUDE.md rule 3 + this phase's brief): with NO
 * server running at all, the app boots normally, the vault works, and
 * share affordances are visible but disabled with a "backend not running"
 * hint. Deliberately does NOT import `shareFixtures.ts` / spawn anything —
 * this spec's first three tests rely on the app's DEFAULT configured share
 * backend URL (`http://127.0.0.1:8787`, `npm run server`'s port) being
 * genuinely unreachable, which holds regardless of the rest of the e2e
 * run: `tests/e2e/globalSetup.ts` only ever starts a backend on 8788 (the
 * `share-*.spec.ts` files' dedicated e2e port), never 8787.
 *
 * The fourth test is different: the app's own `/share/<slug>` route proxies
 * through to `SLATE_SHARE_PROXY_TARGET` (8788, baked in at build time for
 * this whole run — see `vite.config.ts`'s `shareAuthProxy` doc), and since
 * Phase 10's global setup now keeps ONE real backend alive on 8788 for the
 * ENTIRE run (so the four `share-*.spec.ts` files stop racing each other
 * over that port), 8788 is never actually down during this test. A
 * `page.route()` network-level abort simulates the "genuinely unreachable"
 * case that test needs instead — see that test for detail.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("backend-down degradation", () => {
  test("the app boots and the vault works with no share backend running", async ({ page }) => {
    await gotoApp(page);
    // Ordinary vault features stay fully functional.
    await treeRow(page, "vault/notes/architecture.md").click();
    await expect(page.locator(".cm-content").first()).toBeVisible();
  });

  test("Settings → Sharing shows the offline hint, not a crash", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-titlebar").getByRole("button", { name: "Settings" }).click();
    await page.getByTestId("settings-nav-sharing").click();

    await expect(page.getByTestId("share-backend-status")).toHaveText("Offline", { timeout: 10_000 });
    await expect(page.getByText(/backend not running/i)).toBeVisible();
    await expect(page.getByText(/npm run server/i)).toBeVisible();
  });

  test("the Publish dialog stays reachable but shows the offline hint instead of the form", async ({ page }) => {
    await gotoApp(page);
    await treeRow(page, "vault/notes/architecture.md").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Publish…" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Publish…" }).click();

    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/backend not running/i)).toBeVisible({ timeout: 10_000 });
    // The general-access/role form never renders while offline.
    await expect(dialog.getByTestId("publish-general-access")).toHaveCount(0);
  });

  test("the share route itself degrades to the unreachable state, not a crash", async ({ page }) => {
    // `ShareApp.tsx` fetches its content via a relative, same-origin
    // `/share/<slug>` request (`Accept: application/json`), proxied to the
    // e2e run's single shared backend on 8788 — which, unlike port 8787
    // above, IS up for this whole run (see this file's module doc). Abort
    // just that JSON fetch at the network level to simulate a genuinely
    // unreachable backend, while letting the plain page navigation to this
    // same URL through untouched (`resourceType() === "document"`) so the
    // SPA's own client-side router still serves `ShareApp.tsx` normally.
    await page.route("**/share/some-nonexistent-slug-abcdefgh", (route) => {
      if (route.request().resourceType() === "document") return route.continue();
      return route.abort("connectionrefused");
    });
    await page.goto("/share/some-nonexistent-slug-abcdefgh");
    await expect(page.getByText(/can't reach the server/i)).toBeVisible({ timeout: 10_000 });
  });
});

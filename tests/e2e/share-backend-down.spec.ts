/**
 * Backend-down degradation (CLAUDE.md rule 3 + this phase's brief): with NO
 * server reachable, the app boots normally, the vault works, and share
 * affordances are visible but disabled with a "backend not running" hint.
 *
 * Single-origin refactor (Phase 10.5a, roadmap §5.4) changed HOW this is
 * simulated: pre-Phase-10.5a, the app had a Settings-configurable "Sharing
 * base URL" that defaulted to `http://127.0.0.1:8787` — a port this e2e run
 * never starts anything on (only 8788, the `share-*.spec.ts` files'
 * dedicated backend) — so the first three tests below got "genuinely
 * unreachable" for free, with no test-side simulation needed at all. That
 * default no longer exists: `/api/*` is now a plain RELATIVE fetch, proxied
 * same-origin by `vite.config.ts` to the e2e run's actual shared backend
 * (port 8788, which IS up for this whole run — see `tests/e2e/
 * globalSetup.ts`). All four tests below therefore now use the SAME
 * technique — a `page.route()` network-level abort of `/api/**` (this
 * file's own `abortApiRequests` helper) — that the pre-existing fourth test
 * already used for `/share/**`, simulating a genuinely unreachable backend
 * without needing a real down port to exploit.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

/** Aborts every `/api/**` request at the network level — real page
 * navigations (`resourceType() === "document"`) pass through untouched, so
 * the SPA shell itself still loads fine; only the backend calls fail,
 * simulating a genuinely unreachable backend. Must be registered BEFORE
 * `gotoApp()` so the very first boot-time probe is already caught. */
async function abortApiRequests(page: Page): Promise<void> {
  await page.route("**/api/**", (route) => {
    if (route.request().resourceType() === "document") return route.continue();
    return route.abort("connectionrefused");
  });
}

test.describe("backend-down degradation", () => {
  test("the app boots and the vault works with no share backend running", async ({ page }) => {
    await abortApiRequests(page);
    await gotoApp(page);
    // Ordinary vault features stay fully functional.
    await treeRow(page, "vault/notes/architecture.md").click();
    await expect(page.locator(".cm-content").first()).toBeVisible();
  });

  test("Settings → Sharing shows the offline hint, not a crash", async ({ page }) => {
    await abortApiRequests(page);
    await gotoApp(page);
    await page.getByTestId("app-titlebar").getByRole("button", { name: "Settings" }).click();
    await page.getByTestId("settings-nav-sharing").click();

    await expect(page.getByTestId("share-backend-status")).toHaveText("Offline", { timeout: 10_000 });
    await expect(page.getByText(/backend not running/i)).toBeVisible();
    await expect(page.getByText(/npm run server/i)).toBeVisible();
  });

  test("the Publish dialog stays reachable but shows the offline hint instead of the form", async ({ page }) => {
    await abortApiRequests(page);
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
    // e2e run's single shared backend on 8788 — same technique as
    // `abortApiRequests` above, scoped to this one `/share/*` path instead
    // of `/api/**` (this is the ONE path a plain page navigation must NOT
    // be aborted on, since it's ALSO this app's own client-side route for
    // the rendered-share page — see this file's module doc and `vite.
    // config.ts`'s `shareAuthProxy` doc for the same distinction).
    await page.route("**/share/some-nonexistent-slug-abcdefgh", (route) => {
      if (route.request().resourceType() === "document") return route.continue();
      return route.abort("connectionrefused");
    });
    await page.goto("/share/some-nonexistent-slug-abcdefgh");
    await expect(page.getByText(/can't reach the server/i)).toBeVisible({ timeout: 10_000 });
  });
});

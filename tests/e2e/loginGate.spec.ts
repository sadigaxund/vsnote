/**
 * Phase 17 Milestone C1 — the app-wide login gate (`src/boot.tsx` +
 * `src/components/LoginGate.tsx`). Two concerns, deliberately split into
 * two `describe` blocks with different `test.use({ serviceWorkers })`
 * settings:
 *
 * 1. "Gate appears + real login lands in the shell" needs the gate to
 *    actually render, which needs `login_required: true` from `GET
 *    /api/app-config` — but this suite's shared backend runs with
 *    `VSNOTE_REQUIRE_LOGIN=false` (see `shareFixtures.ts`'s doc: every
 *    OTHER spec in this suite needs the shell open by default), so this
 *    describe block intercepts JUST that one public, unauthenticated probe
 *    via `page.route()` to force it, then completes the login against the
 *    REAL backend (`POST /api/auth/login`, the same `useShareStore.login()`
 *    Settings -> Sharing's own "Sign in" row calls) — no other `/api/*`
 *    call is touched. `serviceWorkers: "block"` is load-bearing here, not
 *    cosmetic: `vite.config.ts`'s `runtimeCaching` route for `/api/app-
 *    config` makes the SERVICE WORKER itself issue the real network fetch
 *    once it's controlling the page, and that SW-internal fetch does NOT
 *    honor `page.route()`'s fulfillment (confirmed empirically — the route
 *    handler fires, but the SW's own real network response wins) — a
 *    genuine, verified Chromium/Playwright interaction, not a guess. This
 *    spec doesn't exercise PWA/offline behavior at all, so disabling the SW
 *    for it entirely sidesteps the conflict rather than fighting it.
 *
 * 2. "Offline never gates" mirrors `tests/e2e/probes.spec.ts`'s own
 *    offline-cold-start probe verbatim (real SW installed, then
 *    `context.setOffline(true)` + reload) and asserts the shell renders
 *    with zero console errors — the exact hard-gate contract CLAUDE.md
 *    rule 3 and the phase brief both require. This block deliberately does
 *    NOT block service workers: the offline-safe fallback IS the service
 *    worker route from `vite.config.ts` (see `share/api.ts::getAppConfig`'s
 *    doc for why that's necessary at all).
 */
import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";

async function forceLoginRequired(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/app-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ login_required: true, password_login: true, cf_access: false }),
    }),
  );
}

test.describe("Phase 17 login gate — real login flow", () => {
  test.use({ serviceWorkers: "block" });

  test("gate appears when login_required is true; a real login against the real backend lands in the shell with no reload", async ({ page }) => {
    await forceLoginRequired(page);
    await page.goto("/");

    await expect(page.getByTestId("login-gate")).toBeVisible();
    // The shell must never render behind the gate.
    await expect(page.getByTestId("app-titlebar")).toHaveCount(0);

    await page.getByTestId("login-username").fill(DEMO_OWNER_USERNAME);
    await page.getByTestId("login-password").fill(DEMO_OWNER_PASSWORD);
    await page.getByTestId("login-submit").click();

    // Real POST /api/auth/login against the real backend — flips straight
    // into the shell, no reload, no second navigation.
    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    await expect(page.getByTestId("login-gate")).toHaveCount(0);
  });

  test("wrong credentials show a clear one-row error and keep the gate up", async ({ page }) => {
    await forceLoginRequired(page);
    await page.goto("/");
    await expect(page.getByTestId("login-gate")).toBeVisible();

    await page.getByTestId("login-username").fill(DEMO_OWNER_USERNAME);
    await page.getByTestId("login-password").fill("definitely-the-wrong-password");
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page.getByTestId("app-titlebar")).toHaveCount(0);
  });
});

test.describe("Phase 17 login gate — offline never gates", () => {
  test("a genuinely offline cold start never shows the gate — shell renders, zero console errors", async ({ page, context }) => {
    await gotoApp(page); // real online first load, installs the SW
    await page.evaluate(() => navigator.serviceWorker.ready);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    await expect(page.getByTestId("login-gate")).toHaveCount(0);

    await context.setOffline(false);
    expect(errors).toEqual([]);
  });
});

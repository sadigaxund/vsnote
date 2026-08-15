import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 7 e2e suite (IMPLEMENTATION-PLAN.md): one spec per phase's exit
 * criteria, run against a real production build served by `vite preview` —
 * NOT `vite dev` — so the service-worker/precache specs (`probes.spec.ts`)
 * exercise the actual PWA build artifacts, not a dev server that never
 * registers a service worker (see `vite.config.ts`'s `devOptions` comment).
 *
 * Port 5290 is this suite's own — never 5173 (the user's other app running
 * locally) and never a bare/implicit port. `webServer` below lets Playwright
 * own the server's lifecycle (start before the run, tear down after) rather
 * than a hand-run background process, so there's no PID to track/kill
 * ourselves and no chance of colliding with an unrelated process on this
 * port.
 */
const PORT = 5290;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // Each `test()` already gets a fresh, isolated BrowserContext (its own
    // localStorage/IndexedDB/Cache Storage) from Playwright's built-in
    // `page` fixture — the mechanism this suite relies on for "no reliance
    // on scratchpad state or prior-session artifacts": every spec boots the
    // app cold and lets `fs/seed.ts`'s idempotent `ensureSeeded()` build the
    // demo vault fresh, rather than reusing storage another test left behind.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Serves whatever is currently in `dist/` — `npm run test:e2e` runs
    // `vite build` immediately before `playwright test` (see package.json),
    // so this is always a fresh production build, never a stale one.
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

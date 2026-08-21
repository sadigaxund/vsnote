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
  // One share backend (port 8788) for the ENTIRE run, started before any
  // spec/worker and stopped after all of them finish — see
  // `tests/e2e/globalSetup.ts` / `tests/e2e/shareFixtures.ts`'s module
  // docstring. `fullyParallel` below runs spec files concurrently across
  // multiple worker processes, all sharing the one `vite preview` server
  // (`webServer`), which itself proxies share routes to one fixed backend
  // URL baked in at build time — so per-file/per-worker backends would
  // fight over the same port instead of each getting their own.
  globalSetup: "./tests/e2e/globalSetup.ts",
  globalTeardown: "./tests/e2e/globalTeardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Phase 13 (docs/IMPLEMENTATION-PLAN-V2.md): deliberately zero, in CI and
  // locally alike, so a flake is never silently hidden by a pass-on-retry.
  // This suite is 157 vitest + 90 playwright, zero failures, under
  // CI=true — there is no currently-named flake to spend a retry budget
  // on. The concrete reason this matters: the live-preview defect fixed in
  // commit 834063d presented as an intermittent e2e failure; with retries
  // enabled, CI would have failed that spec once, passed on the retry, and
  // reported green while real users kept seeing raw markdown that never
  // resolved on load. Raising this above 0 requires naming the specific
  // spec and the reason, right here, not just bumping a number.
  retries: 0,
  // Local runs get a BOUND worker count too (TODO §6.5): unbounded default =
// ~CPU count, and ~16 concurrent browser workers hammering the ONE shared
// backend turned into intermittent sign-in/manifest failures that never
// reproduce serially. 4 keeps the suite fast without stampeding it.
workers: process.env.CI ? 2 : 4,
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
    // `--host 127.0.0.1` is load-bearing on CI, not cosmetic. `vite preview`
    // defaults to host "localhost", which a GitHub Actions runner resolves to
    // ::1 (IPv6) only, while `use.baseURL` above dials 127.0.0.1 (IPv4).
    // Playwright's own `port` readiness check was satisfied by the IPv6
    // listener, so it reported no webServer problem at all and started the
    // run, and then every single spec failed instantly with
    // net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5290/ because nothing
    // was listening on IPv4. Locally this never appeared: "localhost"
    // resolves to 127.0.0.1 first, so the binding happened to match. Pinning
    // the bind address to the exact host baseURL uses removes the mismatch
    // instead of relying on name resolution order.
    command: `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    // Surface the preview server's own output. Without this its startup and
    // crash messages are swallowed, which is what made the failure above
    // present as "90 tests all failed" with no server diagnostics anywhere.
    stdout: "pipe",
    stderr: "pipe",
  },
});

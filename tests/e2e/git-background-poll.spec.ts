/**
 * Phase 12 (DESIGN-SPEC Amendments round 4, item 26b) — the background
 * `/git` poll (`App.tsx`'s `GIT_BACKGROUND_FETCH_MS` interval, roadmap
 * §5.2's "~60s while the backend is reachable") must make ZERO requests to
 * `/git` while signed out, and resume once the user signs in.
 *
 * Why this matters (the headline user-visible bug item 26 fixes): before
 * this phase, that interval gated on `useShareStore`'s `reachability` field
 * alone — a soft, tri-state signal that starts `"unknown"` and is NEVER
 * probed at boot by design (`App.tsx`'s boot effect doc explains why: an
 * eager `whoami()` broke `probes.spec.ts`'s offline-cold-start assertion).
 * In practice this meant the interval fired unconditionally for every
 * signed-out session, hitting `/git` with no credentials every ~60s — and a
 * browser `fetch()` that sees `WWW-Authenticate: Basic` on ANY response (the
 * git-http router's old, unconditional 401 challenge — see `git_http.py`'s
 * `_is_git_client`, item 26a's server-side half) pops the browser's own
 * native login dialog. The fix gates the interval on `authenticated`
 * instead — a hard boolean, `false` until an explicit sign-in.
 *
 * This is a network-level (`page.on("request")`) proof, not an assertion on
 * internal store state — the spec brief explicitly calls for this: internal
 * state could say "gated" while a stray call still went out.
 *
 * The interval's real period (60s) is impractical to wait out for real in a
 * spec; `App.tsx` exposes a test-only override
 * (`window.__gitBackgroundFetchMsOverride`, same inert-unless-set shape as
 * `lib/renderProbe.ts`'s `__renderProbeEnabled`) set here via
 * `page.addInitScript` BEFORE navigation, so the effect's very first
 * `setInterval` call already uses the short period.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { signInToShareBackend } from "./shareUiHelpers";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";

const FAST_POLL_MS = 400;

function trackGitRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/\/git\//.test(new URL(url).pathname)) urls.push(url);
  });
  return urls;
}

test.describe("background /git poll — suspended while signed out (item 26b)", () => {
  test("makes zero /git requests while signed out, across several would-be ticks", async ({ page }) => {
    await page.addInitScript((ms) => {
      (window as unknown as { __gitBackgroundFetchMsOverride?: number }).__gitBackgroundFetchMsOverride = ms;
    }, FAST_POLL_MS);

    const gitRequests = trackGitRequests(page);
    await gotoApp(page);

    // Several ticks' worth of real wall-clock time — there is no positive
    // DOM signal for "nothing happened", so this is a deliberate wait, not
    // a race: long enough (7x the fast period) that a single missed/slow
    // tick can't produce a false pass, short enough to stay a fast spec.
    await page.waitForTimeout(FAST_POLL_MS * 7);

    expect(gitRequests).toEqual([]);
  });

  test("resumes /git polling once the user signs in", async ({ page }) => {
    await page.addInitScript((ms) => {
      (window as unknown as { __gitBackgroundFetchMsOverride?: number }).__gitBackgroundFetchMsOverride = ms;
    }, FAST_POLL_MS);

    const gitRequests = trackGitRequests(page);
    await gotoApp(page);

    // Confirm the same pre-sign-in silence this file's other test proves,
    // as a sanity baseline before flipping to signed-in.
    await page.waitForTimeout(FAST_POLL_MS * 3);
    expect(gitRequests).toEqual([]);

    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    // `signInToShareBackend` itself already proves `authenticated` flipped
    // true (it waits on the "Sign out" button, which only renders once
    // `useShareStore`'s `authenticated` is true) — the very next tick
    // should now make a real request. `git.fetch()` may well fail
    // server-side (no sync token configured in this spec) — that's fine,
    // irrelevant to this assertion; only that the request left the browser
    // at all matters here.
    await expect
      .poll(() => gitRequests.length, {
        message: "expected at least one /git request after signing in",
        timeout: FAST_POLL_MS * 10,
      })
      .toBeGreaterThan(0);
  });
});

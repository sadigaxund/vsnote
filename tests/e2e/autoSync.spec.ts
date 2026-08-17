/**
 * Phase 17 Milestone C1 — proves an auto-sync POLICY actually triggers a
 * real `syncNow()` run with zero manual "Sync now" click, using the
 * "on-save" policy (`src/git/autoSyncPolicy.ts`'s `notifySaveSettled`,
 * wired from `App.tsx`'s two save call sites).
 *
 * `ON_SAVE_DEBOUNCE_MS` (4s in production) is impractical to wait out for
 * real in a spec — `App.tsx` exposes a test-only override
 * (`window.__vsnoteAutoSyncTimerScaleOverride`, same inert-unless-set shape
 * as `git-background-poll.spec.ts`'s `__gitBackgroundFetchMsOverride`) set
 * here via `page.addInitScript` BEFORE navigation, so the scheduler's very
 * first debounce timer already uses the scaled-down delay.
 *
 * Uses its own, randomly-named git repo (Settings -> Git & Sync ->
 * "Repository name") rather than the fixed "vault" repo `git-sync.spec.ts`
 * targets — that file's own tests share ONE physical bare repo and rely on
 * `mode: "serial"` + explicit resets to avoid racing each other; this spec
 * runs in its own file (a different Playwright worker may run it
 * concurrently with `git-sync.spec.ts`), so it sidesteps that entirely by
 * never touching the same repo name at all.
 */
import { expect, test } from "@playwright/test";
import { DEFAULT_ACTIVE_PATH, gotoApp, seedSettings, tab } from "./fixtures";
import { signInToShareBackend } from "./shareUiHelpers";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";

// 4000ms * 0.05 = 200ms — comfortably fast for a spec, comfortably above
// any timer-granularity noise.
const TIMER_SCALE = 0.05;

test("the \"on-save\" auto-sync toggle triggers a real sync run with no manual Sync click", async ({ page }) => {
  await page.addInitScript((scale) => {
    (window as unknown as { __vsnoteAutoSyncTimerScaleOverride?: number }).__vsnoteAutoSyncTimerScaleOverride = scale;
  }, TIMER_SCALE);

  // A fresh, unique repo name for this run only — see module doc. Round 7
  // item 53 retired the freeform Repository-name input, so the isolation
  // repo is seeded straight into the persisted settings; item 52's setup
  // gate is likewise seeded complete (the guided flow has its own spec,
  // sync-setup.spec.ts).
  const repoName = `autosync-e2e-${Date.now()}`;
  await seedSettings(page, { gitSyncSetupComplete: true, gitRepoName: repoName });

  await gotoApp(page);
  await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

  await page.getByTestId("settings-nav-git-sync").click();

  await page.getByTestId("git-generate-token").click();
  const tokenInput = page.getByLabel("Personal access token");
  await expect(tokenInput).not.toHaveValue("");

  // Flip on the "After each save" toggle (round 7 item 54: combinable
  // switches, not an exclusive select).
  await page.getByTestId("git-sync-on-save").click();

  // Edit and save a real file — no Commit/Push/Sync click anywhere below.
  await tab(page, DEFAULT_ACTIVE_PATH).click();
  await page.getByRole("radio", { name: "Source" }).click();
  const cm = page.locator(".cm-content").first();
  await cm.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\non-save auto-sync proof ${repoName}\n`);
  await page.keyboard.press("Control+s");

  // The scaled-down debounce fires, `notifySaveSettled` calls the SAME
  // `syncNow()` pipeline a manual Sync click uses (auto-commit -> fetch ->
  // bootstrap push into the fresh repo) — proven here by the status bar's
  // "not synced yet" placeholder being replaced with a real synced label,
  // and ahead/behind settling at ↑0 ↓0, entirely on its own.
  const statusBar = page.getByTestId("app-statusbar");
  await expect(statusBar).not.toContainText("not synced yet", { timeout: 10_000 });
  await expect(statusBar).toContainText("↑0 ↓0");
});

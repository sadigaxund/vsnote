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

  // "After each save" is ON by default once sync setup is complete, per the
  // 2026-09-05 storage decision (docs/PLAN-2026-09-05-refresh.md §1, Option
  // B: auto-sync on save is the default, not an opt-in). This used to click
  // the toggle to turn it on; doing that now turns it OFF and the rest of
  // the test silently proves nothing, so assert the default instead.
  await expect(page.getByTestId("git-sync-on-save")).toHaveAttribute("data-state", "checked");

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
  // bootstrap push into the fresh repo) — proven here entirely on its own,
  // with no Commit/Push/Sync click anywhere above.
  //
  // The status bar's ahead/behind pair ("↑0 ↓0") was replaced by the
  // durability indicator in the 2026-09-05 storage change
  // (docs/PLAN-2026-09-05-refresh.md §1 item 3): a "N unsynced" count and a
  // "last pushed" label. The push is therefore asserted through the
  // last-pushed segment losing its "never pushed" placeholder, which is the
  // same fact the old assertion was after (a push actually reached the
  // server), stated against the segment that now carries it. Note the
  // "N unsynced" count is deliberately NOT asserted to reach zero: it
  // counts uncommitted working-tree changes as well as unpushed commits,
  // and the demo vault carries untracked files of its own throughout.
  const statusBar = page.getByTestId("app-statusbar");
  await expect(statusBar).not.toContainText("not synced yet", { timeout: 10_000 });
  await expect(statusBar).not.toContainText("never pushed", { timeout: 10_000 });
});

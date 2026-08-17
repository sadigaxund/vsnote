/**
 * Round 7 item 52 — the guided, zero-git-knowledge sync setup flow, driven
 * end to end against the real e2e backend: fresh vault -> setup invitation
 * -> "This VSNote server" -> sign in inline -> one-click sync token ->
 * "Turn on sync" -> the full Git & Sync category appears with the item 53
 * identity chip. The negative half (the gate itself, the never-shown
 * implicit URL, the disabled finish button) lives in settings-view.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { gotoApp, openSettingsTab } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";

test("guided setup: sign in, mint a sync token, turn on sync, land on the full category", async ({ page }) => {
  await gotoApp(page);
  await openSettingsTab(page);
  await page.getByTestId("settings-nav-git-sync").click();

  await expect(page.getByTestId("sync-setup-intro")).toBeVisible();
  await page.getByTestId("sync-setup-begin").click();

  // "This VSNote server" is preselected; sign in right here (the panel
  // reuses the ONE auth implementation, useShareStore.login).
  await page.getByTestId("sync-setup-username").fill(DEMO_OWNER_USERNAME);
  await page.getByTestId("sync-setup-password").fill(DEMO_OWNER_PASSWORD);
  await page.getByTestId("sync-setup-signin").click();

  await page.getByTestId("sync-setup-create-token").click();
  await expect(page.getByTestId("sync-setup-token-ready")).toBeVisible();

  const finish = page.getByTestId("sync-setup-finish");
  await expect(finish).toBeEnabled();
  await finish.click();

  // The gate is gone: the full category renders, led by the identity chip
  // (repo + branch, `main` by default now), and the setup view is history.
  await expect(page.getByTestId("vault-identity-chip")).toContainText("main");
  await expect(page.getByTestId("sync-setup-intro")).toHaveCount(0);
  // The minted token landed in the Remote sync form.
  await expect(page.getByLabel("Personal access token")).not.toHaveValue("");

  // Survives a reload — setup is persisted, never re-shown over a working
  // configuration.
  await page.reload();
  await openSettingsTab(page);
  await page.getByTestId("settings-nav-git-sync").click();
  await expect(page.getByTestId("vault-identity-chip")).toBeVisible();
  await expect(page.getByTestId("sync-setup-intro")).toHaveCount(0);
});

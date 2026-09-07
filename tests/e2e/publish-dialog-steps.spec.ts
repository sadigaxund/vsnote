/**
 * The rebuilt stepped Publish dialog (docs/PLAN-2026-09-05-refresh.md §4):
 * the five-step flow end to end, raw mode never offering password
 * protection, the one-time per-share token with its ready-made curl line,
 * and the "Links in this file" list (§5) with a working "Share too".
 *
 * Shares the one e2e backend (port 8788, `tests/e2e/globalSetup.ts`) with
 * the other `share-*.spec.ts` files — every share below targets freshly
 * created vault files, so this file's publishes can never race theirs on
 * the "own share" Explorer context-menu flip (see
 * `share-publish-revoke.spec.ts`'s longer note on that exact class of
 * flake).
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, signInToShareBackend } from "./shareUiHelpers";

test.describe("Publish dialog — stepped flow", () => {
  test("walks Mode -> Who can open -> Protection -> Link -> Result end to end", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "steps-flow.md", "# Steps flow\n\nContent.\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    // Step 1 — Mode.
    await expect(dialog.getByTestId("publish-step-mode")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("publish-mode-description")).toBeVisible();
    await dialog.getByTestId("publish-continue").click();

    // Step 2 — Who can open (default: anyone with the link).
    await expect(dialog.getByTestId("publish-step-access")).toHaveAttribute("aria-selected", "true");
    await dialog.getByTestId("publish-continue").click();

    // Step 3 — Protection.
    await expect(dialog.getByTestId("publish-step-protection")).toHaveAttribute("aria-selected", "true");
    await dialog.getByTestId("publish-continue").click();

    // Step 4 — Link.
    await expect(dialog.getByTestId("publish-step-link")).toHaveAttribute("aria-selected", "true");
    const alias = `steps-flow-${Date.now()}`;
    await dialog.getByTestId("publish-alias").fill(alias);
    await dialog.getByTestId("publish-submit").click();

    // Step 5 — Result.
    await expect(dialog.getByTestId("publish-step-result")).toHaveAttribute("aria-selected", "true");
    const link = await dialog.getByTestId("publish-result-link").inputValue();
    expect(link).toContain(`/share/${alias}`);
    await dialog.getByTestId("publish-done").click();
    await expect(dialog).toBeHidden();
  });

  test("raw mode never offers password protection", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "raw-no-password.md", "raw content\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("radio", { name: "Raw file" }).click();
    await dialog.getByTestId("publish-continue").click(); // -> access
    await dialog.getByTestId("publish-continue").click(); // -> protection

    await dialog.getByTestId("publish-auth-mode").click();
    await expect(page.getByRole("option", { name: "Password" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "No credential" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Share token" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog.getByText(/can't require a password/i)).toBeVisible();

    await dialog.getByTestId("publish-continue").click(); // -> link (leave dialog open, don't submit)
  });

  test("token protection mints a one-time token with a working curl line", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "token-once.md", "token-protected content\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Raw file" }).click();
    await dialog.getByTestId("publish-continue").click(); // -> access
    await dialog.getByTestId("publish-continue").click(); // -> protection
    await dialog.getByTestId("publish-auth-mode").click();
    await page.getByRole("option", { name: "Share token" }).click();
    await dialog.getByTestId("publish-continue").click(); // -> link
    await dialog.getByTestId("publish-submit").click(); // -> result

    const link = await dialog.getByTestId("publish-result-link").inputValue();
    expect(link).toContain("/share/");

    // §4.2 — one-time reveal: the token appears exactly once, with a clear
    // "you will not see this again" warning and a ready-made curl line
    // built from the SAME link and token shown above.
    await expect(dialog.getByTestId("publish-token-warning")).toBeVisible();
    const token = await dialog.getByTestId("publish-generated-token").inputValue();
    expect(token.length).toBeGreaterThan(10);
    const curlLine = await dialog.getByTestId("publish-curl-line").inputValue();
    expect(curlLine).toBe(`curl -H 'Authorization: Bearer ${token}' ${link}`);

    await dialog.getByTestId("publish-done").click();
    await expect(dialog).toBeHidden();
    // Server-side enforcement of the token requirement (a request with no
    // credential denied uniformly) is `server/`'s own contract, out of
    // scope for this pass (CLAUDE.md: do not touch server/) — this spec
    // covers the CLIENT side only: the dialog mints exactly one token, on
    // Result step, with a working curl line built from it.
  });

  test('"Links in this file" lists shared and not-shared siblings, and "Share too" publishes the sibling', async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const sharedSiblingPath = await createFileWithContent(page, "vault/notes", "links-sibling-shared.md", "# Shared sibling\n");
    const unsharedSiblingPath = await createFileWithContent(page, "vault/notes", "links-sibling-unshared.md", "# Unshared sibling\n");
    void unsharedSiblingPath;

    // Publish the sibling that WILL show as already shared.
    await treeRow(page, sharedSiblingPath).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const firstDialog = page.getByTestId("publish-dialog");
    await firstDialog.getByTestId("publish-continue").click();
    await firstDialog.getByTestId("publish-continue").click();
    await firstDialog.getByTestId("publish-continue").click();
    await firstDialog.getByTestId("publish-submit").click();
    await expect(firstDialog.getByTestId("publish-result-link")).toBeVisible();
    await firstDialog.getByTestId("publish-done").click();
    await expect(firstDialog).toBeHidden();

    const mainContent = [
      "# Links main",
      "",
      "[Already shared](./links-sibling-shared.md)",
      "",
      "[Not shared yet](./links-sibling-unshared.md)",
      "",
    ].join("\n");
    const mainPath = await createFileWithContent(page, "vault/notes", "links-main.md", mainContent);

    await treeRow(page, mainPath).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("publish-continue").click(); // -> access
    await dialog.getByTestId("publish-continue").click(); // -> protection
    await dialog.getByTestId("publish-continue").click(); // -> link

    const links = dialog.getByTestId("publish-file-links");
    await expect(links).toBeVisible();
    const sharedRow = dialog.getByTestId("publish-file-link-vault/notes/links-sibling-shared.md");
    await expect(sharedRow).toContainText("Shared as /share/");
    const unsharedRow = dialog.getByTestId("publish-file-link-vault/notes/links-sibling-unshared.md");
    await expect(unsharedRow).toContainText("Not shared");

    const shareTooButton = dialog.getByTestId("publish-share-too-vault/notes/links-sibling-unshared.md");
    await expect(shareTooButton).toBeVisible();
    await shareTooButton.click();
    // The row itself flips from "Not shared" to "Shared as /share/x" once
    // `handleShareSibling` publishes it and the store's `shares` update
    // re-derives `fileLinks` — scoped to THIS row, not the whole dialog
    // (the already-shared sibling's row also contains "Shared as /share/…").
    await expect(unsharedRow).toContainText("Shared as /share/", { timeout: 10_000 });
  });

  // R3-4 — short custom aliases ("get", "help") are now legal (min length
  // dropped from 8 to 2), but a short alias on an "anyone with the link"
  // share is guessable, so the Link step shows a non-blocking inline hint.
  // Publishing must still succeed — the hint is advisory only.
  test("shows a short-alias hint on 'anyone with the link' but never blocks publishing", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "short-alias.md", "# Short alias\n\nContent.\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("publish-continue").click(); // -> access (default: anyone with the link)
    await dialog.getByTestId("publish-continue").click(); // -> protection
    await dialog.getByTestId("publish-continue").click(); // -> link

    const alias = `sa${Date.now().toString(36)}`.slice(0, 7); // stays under the 8-char hint threshold
    await dialog.getByTestId("publish-alias").fill(alias);
    await expect(dialog.getByTestId("publish-alias-short-hint")).toBeVisible();
    await expect(dialog.getByTestId("publish-alias-short-hint")).toContainText(
      "Short aliases are guessable; add a password or restrict access if this should stay private.",
    );

    await dialog.getByTestId("publish-submit").click();
    await expect(dialog.getByTestId("publish-step-result")).toHaveAttribute("aria-selected", "true");
    const link = await dialog.getByTestId("publish-result-link").inputValue();
    expect(link).toContain(`/share/${alias}`);
  });

  test("does not show the short-alias hint once restricted to specific people", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "short-alias-restricted.md", "restricted\n");

    await treeRow(page, path).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Publish…" }).click();
    const dialog = page.getByTestId("publish-dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("publish-continue").click(); // -> access
    await dialog.getByRole("radio", { name: "Only people I list" }).click();
    await dialog.getByTestId("publish-continue").click(); // -> protection
    await dialog.getByTestId("publish-continue").click(); // -> link

    await dialog.getByTestId("publish-alias").fill("short1");
    await expect(dialog.getByTestId("publish-alias-short-hint")).toHaveCount(0);
  });
});

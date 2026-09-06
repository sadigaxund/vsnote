/**
 * Phase 10 (sharing) e2e UI helpers — drive the STEPPED Publish dialog
 * (docs/PLAN-2026-09-05-refresh.md §4, rebuilt this pass) and the "Shared"
 * activity-bar view (§2) exactly the way a user would (no bare timeouts,
 * only auto-waiting Playwright locators/assertions, matching `fixtures.ts`'s
 * existing discipline).
 */
import { expect, type Page } from "@playwright/test";
import { openSettingsTab, treeRow } from "./fixtures";

/** Opens Settings → Sharing, waits for "Online", and signs in. Leaves the
 * Settings tab open. Share MANAGEMENT itself lives in the "Shared"
 * activity-bar view now (`openSharedView` below) — Settings → Sharing keeps
 * only the backend connection/sign-in row and the admin blob-size row. */
export async function signInToShareBackend(page: Page, username: string, password: string): Promise<void> {
  await openSettingsTab(page);
  await page.getByTestId("settings-nav-sharing").click();
  await expect(page.getByTestId("share-backend-status")).toHaveText("Online", { timeout: 10_000 });
  await page.getByTestId("share-login-username").fill(username);
  await page.getByTestId("share-login-password").fill(password);
  await page.getByTestId("share-login-submit").click();
  await expect(page.getByTestId("share-signout")).toBeVisible();
}

/** Opens the "Shared" TAB (docs/PLAN-2026-09-05-refresh.md §2, course-
 * corrected mid-pass to a full-width tab — same mechanism as opening
 * Settings), replacing Settings → Sharing → Shared. Idempotent: if the tab
 * is already open/focused, clicking the activity-bar icon again just
 * re-focuses it (no collapse-toggle risk the old sidebar-panel version had). */
export async function openSharedView(page: Page): Promise<void> {
  const view = page.getByTestId("shared-view");
  if (await view.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Shared", exact: true }).click();
  await expect(view).toBeVisible();
}

export interface PublishOptions {
  treePath: string;
  generalAccess?: "restricted" | "link";
  renderMode?: "raw" | "rendered";
  password?: string;
  authMode?: "none" | "password" | "token";
  alias?: string;
  /** A single per-principal role grant — the People row on the "Who can
   * open" step when `generalAccess: "restricted"`. */
  grant?: { principal: string; role: "viewer" | "editor" };
}

/** Advances the dialog from whichever of the first four steps it's
 * currently on to the next one ("Continue"), or submits ("Publish"/"Save")
 * from the Link step. */
async function continueStep(dialog: import("@playwright/test").Locator): Promise<void> {
  const submit = dialog.getByTestId("publish-submit");
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    return;
  }
  await dialog.getByTestId("publish-continue").click();
}

/** Right-click → "Publish…" on a file row, drive the FIVE-STEP dialog
 * (Mode → Who can open → Protection → Link → Result), and return the
 * resulting share link (read from the Result step's read-only link field).
 * For `authMode: "token"`, also returns the one-time minted token so a
 * caller can assert the "you will not see this again" flow. */
export async function publishFileViaContextMenu(page: Page, opts: PublishOptions): Promise<string> {
  await treeRow(page, opts.treePath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Publish…" }).click();

  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog).toBeVisible();

  // Step 1 — Mode.
  if (opts.renderMode) {
    await dialog.getByRole("radio", { name: opts.renderMode === "rendered" ? "Viewer page" : "Raw file" }).click();
  }
  await continueStep(dialog);

  // Step 2 — Who can open.
  if (opts.generalAccess === "restricted") {
    await dialog.getByTestId("publish-general-access").getByLabel("Only people I list").click();
  }
  if (opts.grant) {
    await dialog.getByTestId("publish-grant-principal").fill(opts.grant.principal);
    if (opts.grant.role === "editor") {
      await dialog.getByLabel("Role for the new person").click();
      await page.getByRole("option", { name: "Can edit" }).click();
    }
    await dialog.getByTestId("publish-grant-add").click();
  }
  await continueStep(dialog);

  // Step 3 — Protection.
  const authMode = opts.authMode ?? (opts.password ? "password" : undefined);
  if (authMode) {
    await dialog.getByTestId("publish-auth-mode").click();
    await page.getByRole("option", { name: authMode === "password" ? "Password" : authMode === "token" ? "Share token" : "No credential" }).click();
    if (authMode === "password" && opts.password) {
      await dialog.getByTestId("publish-password").fill(opts.password);
    }
  }
  await continueStep(dialog);

  // Step 4 — Link.
  if (opts.alias) {
    await dialog.getByTestId("publish-alias").fill(opts.alias);
  }
  await continueStep(dialog); // submits (Publish/Save) from this step

  // Step 5 — Result.
  const linkInput = dialog.getByTestId("publish-result-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  await dialog.getByTestId("publish-done").click();
  await expect(dialog).toBeHidden();
  return link;
}

/** Same flow as `publishFileViaContextMenu`, but also returns the one-time
 * minted share token (§4.2) for `authMode: "token"` callers — read BEFORE
 * dismissing the dialog, since the plaintext is never re-served. */
export async function publishFileWithToken(page: Page, opts: Omit<PublishOptions, "authMode" | "password">): Promise<{ link: string; token: string }> {
  await treeRow(page, opts.treePath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Publish…" }).click();

  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog).toBeVisible();
  if (opts.renderMode) {
    await dialog.getByRole("radio", { name: opts.renderMode === "rendered" ? "Viewer page" : "Raw file" }).click();
  }
  await continueStep(dialog);
  if (opts.generalAccess === "restricted") {
    await dialog.getByTestId("publish-general-access").getByLabel("Only people I list").click();
  }
  await continueStep(dialog);
  await dialog.getByTestId("publish-auth-mode").click();
  await page.getByRole("option", { name: "Share token" }).click();
  await continueStep(dialog);
  if (opts.alias) await dialog.getByTestId("publish-alias").fill(opts.alias);
  await continueStep(dialog);

  const linkInput = dialog.getByTestId("publish-result-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  await expect(dialog.getByTestId("publish-token-warning")).toBeVisible();
  const tokenInput = dialog.getByTestId("publish-generated-token");
  const token = await tokenInput.inputValue();
  await dialog.getByTestId("publish-done").click();
  await expect(dialog).toBeHidden();
  return { link, token };
}

/** Creates a new file (Explorer "New File" under `parentPath`, renamed to
 * `filename`), opens it, types `content` into its editor, and saves
 * (⌘S/Ctrl+S). Returns the new file's vault display path. */
export async function createFileWithContent(page: Page, parentPath: string, filename: string, content: string): Promise<string> {
  await treeRow(page, parentPath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File" }).click();
  const draftPath = `${parentPath}/.vsnote-draft-file`;
  const draftRow = treeRow(page, draftPath);
  await expect(draftRow).toBeVisible();
  await draftRow.locator("input").fill(filename);
  await draftRow.locator("input").press("Enter");

  const finalPath = `${parentPath}/${filename}`;
  const row = treeRow(page, finalPath);
  await expect(row).toBeVisible();
  await row.dblclick();

  const sourceToggle = page.getByRole("radio", { name: "Source" });
  if (await sourceToggle.isVisible().catch(() => false)) {
    await sourceToggle.click();
  }

  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(content);
  await page.keyboard.press("Control+s");
  return finalPath;
}

/** Revokes a share from the "Shared" activity-bar view, matched by its
 * slug/alias (the identifier segment of `link`). */
export async function revokeShareByLink(page: Page, link: string): Promise<void> {
  const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;
  await openSharedView(page);
  const row = page.locator("tr", { hasText: identifier });
  await expect(row).toBeVisible();
  await row.getByLabel(/^Actions for/).click();
  await page.getByTestId(/^shared-revoke-/).click();
  await page.getByRole("button", { name: "Revoke" }).last().click();
}

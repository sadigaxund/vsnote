/**
 * Phase 10 (sharing) e2e UI helpers — drive the Publish dialog / Settings
 * "Sharing" category / the Shared panel exactly the way a user would (no
 * bare timeouts, only auto-waiting Playwright locators/assertions, matching
 * `fixtures.ts`'s existing discipline).
 */
import { expect, type Page } from "@playwright/test";
import { openSettingsTab, treeRow } from "./fixtures";

/** Opens Settings → Sharing, waits for "Online" (single-origin refactor,
 * Phase 10.5a: no more Backend URL field to fill — `/api/*` is a relative
 * fetch that reaches the real backend via `vite.config.ts`'s proxy in this
 * dev/preview e2e run, same as it does same-origin in production), and
 * signs in. Leaves the Settings tab open (Sharing category active) —
 * callers that need the Explorer sidebar don't need to switch away from it
 * first, since the sidebar is independent of which editor tab is focused. */
export async function signInToShareBackend(page: Page, username: string, password: string): Promise<void> {
  await openSettingsTab(page);
  await page.getByTestId("settings-nav-sharing").click();
  await expect(page.getByTestId("share-backend-status")).toHaveText("Online", { timeout: 10_000 });
  await page.getByTestId("share-login-username").fill(username);
  await page.getByTestId("share-login-password").fill(password);
  await page.getByTestId("share-login-submit").click();
  await expect(page.getByTestId("share-signout")).toBeVisible();
}

export interface PublishOptions {
  treePath: string;
  generalAccess?: "restricted" | "link";
  renderMode?: "raw" | "rendered";
  password?: string;
  alias?: string;
  /** Round 6 items 11/12 — a single per-principal role grant, driven
   * through the dialog's "Roles" row (the switch + principal input + role
   * select, none of which carry their own testid — see `PublishDialog.tsx`,
   * targeted here by accessible name/role instead). */
  grant?: { principal: string; role: "viewer" | "editor" };
}

/** Right-click → "Publish…" on a file row, fill the dialog, submit, and
 * return the resulting share link (read straight from the dialog's own
 * read-only link field — the same value `buildShareLink` produced). */
export async function publishFileViaContextMenu(page: Page, opts: PublishOptions): Promise<string> {
  await treeRow(page, opts.treePath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Publish…" }).click();

  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog).toBeVisible();

  if (opts.generalAccess === "link") {
    await dialog.getByTestId("publish-general-access").click();
    await page.getByRole("option", { name: "Anyone with the link" }).click();
  }
  if (opts.renderMode) {
    // Round 7 item 57 — delivery labels: Viewer page / Raw file.
    await dialog.getByRole("radio", { name: opts.renderMode === "rendered" ? "Viewer page" : "Raw file" }).click();
  }
  if (opts.password) {
    // Round 6 item 4 — the old Password switch is now a three-way
    // credential select (No credential / Password / API token).
    await dialog.getByTestId("publish-auth-mode").click();
    await page.getByRole("option", { name: "Password" }).click();
    await dialog.getByTestId("publish-password").fill(opts.password);
  }
  if (opts.alias) {
    await dialog.getByTestId("publish-alias").fill(opts.alias);
  }
  if (opts.grant) {
    // Round 7 item 60 — the People list: fill the add row, pick the role,
    // press Add (grants are visible state now, not a write-only switch).
    await dialog.getByTestId("publish-grant-principal").fill(opts.grant.principal);
    if (opts.grant.role === "editor") {
      await dialog.getByLabel("Role for the new person").click();
      await page.getByRole("option", { name: "Can edit" }).click();
    }
    await dialog.getByTestId("publish-grant-add").click();
  }

  await dialog.getByTestId("publish-submit").click();
  const linkInput = dialog.getByTestId("publish-result-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  await dialog.getByTestId("publish-done").click();
  await expect(dialog).toBeHidden();
  return link;
}

/** Creates a new file (Explorer "New File" under `parentPath`, renamed to
 * `filename`), opens it, types `content` into its editor, and saves
 * (⌘S/Ctrl+S). Returns the new file's vault display path. Used by the
 * sandbox spec to publish attacker-controlled content that doesn't exist in
 * the seeded demo vault. */
export async function createFileWithContent(page: Page, parentPath: string, filename: string, content: string): Promise<string> {
  await treeRow(page, parentPath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File" }).click();
  // DESIGN-SPEC Amendments round 4 item 30: the draft row is an in-memory
  // placeholder (`.vsnote-draft-file`, never a real fs path) with an empty
  // name field, not a real `untitled.md`.
  const draftPath = `${parentPath}/.vsnote-draft-file`;
  const draftRow = treeRow(page, draftPath);
  await expect(draftRow).toBeVisible();
  await draftRow.locator("input").fill(filename);
  await draftRow.locator("input").press("Enter");

  const finalPath = `${parentPath}/${filename}`;
  const row = treeRow(page, finalPath);
  await expect(row).toBeVisible();
  await row.dblclick();

  // Some kinds (html, json, csv, image) default to Rendered mode, whose
  // preview isn't a CM6 surface at all (e.g. `.html` opens
  // `renderers/HtmlPreview.tsx`'s plain iframe) — force Source explicitly
  // so `.cm-content` below is always the real editable view, regardless of
  // the file's default mode.
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

export interface PublishFolderOptions {
  treePath: string;
  generalAccess?: "restricted" | "link";
  renderMode?: "raw" | "rendered";
  /** relpaths (relative to `treePath`) to UNCHECK before submitting —
   * these must be ABSENT from the resulting share, not merely hidden
   * (roadmap §5.1). */
  excludeRelpaths?: string[];
}

/** Right-click → "Publish…" on a FOLDER row (Phase 10.5), optionally
 * unchecking entries in the checkbox tree, submit, and return the
 * resulting share link. */
export async function publishFolderViaContextMenu(page: Page, opts: PublishFolderOptions): Promise<string> {
  await treeRow(page, opts.treePath).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Publish…" }).click();

  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("checkbox-tree")).toBeVisible();

  if (opts.generalAccess === "link") {
    await dialog.getByTestId("publish-general-access").click();
    await page.getByRole("option", { name: "Anyone with the link" }).click();
  }
  if (opts.renderMode) {
    await dialog.getByRole("radio", { name: opts.renderMode === "rendered" ? "Viewer page" : "Raw file" }).click();
  }
  for (const relpath of opts.excludeRelpaths ?? []) {
    await dialog.getByTestId(`checkbox-tree-toggle-${relpath}`).click();
  }

  await dialog.getByTestId("publish-submit").click();
  const linkInput = dialog.getByTestId("publish-result-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  await dialog.getByTestId("publish-done").click();
  await expect(dialog).toBeHidden();
  return link;
}

/** Revokes a share from the Shared panel (Settings → Sharing → Shared),
 * matched by its slug/alias (the identifier segment of `link`). */
export async function revokeShareByLink(page: Page, link: string): Promise<void> {
  const identifier = new URL(link).pathname.split("/").filter(Boolean).pop()!;
  await page.getByTestId("settings-nav-sharing").click();
  const row = page.locator('[data-testid^="shared-row-"]', { hasText: identifier });
  await expect(row).toBeVisible();
  await row.getByLabel("Revoke").click();
  await page.getByRole("button", { name: "Revoke" }).last().click();
}

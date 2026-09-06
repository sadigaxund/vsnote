/**
 * Coverage for the round 6 items 10-13 rebuild of `share/ShareApp.tsx`: the
 * reader now reuses the main shell's own local components (TitleBar,
 * ExplorerTree in readOnly mode, EditorTabBar, the Rendered/Source
 * SegmentedControl) on the app's dark theme tokens, and — new capability —
 * an "editor" role can edit and save content back through the same PUT the
 * server re-gates (`server/app/routers/share_public.py`).
 *
 * Shares the one e2e backend (port 8788, `tests/e2e/globalSetup.ts`) with
 * the other `share-*.spec.ts` files — every share below targets a vault
 * path none of those files touch (`vault/assets`, `vault/notes/
 * markdown-kitchen-sink.md`, and a freshly-created file for the editor-role
 * test), so this file's publishes can never race theirs on the "own share"
 * Explorer context-menu flip (see `share-publish-revoke.spec.ts`'s longer
 * note on that exact class of flake).
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFileViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

test.describe("rebuilt share reader (round 6 items 10-13)", () => {
  // The former "shell: titlebar + tree + tabs" test published a FOLDER
  // share; folder shares were removed in the 2026-09-05 refresh
  // (docs/PLAN-2026-09-05-refresh.md §4.4). The chrome assertions it made
  // are re-established against a single-file share by the reader rewrite.

  test("viewer role: role badge, no save button, Source toggle stays read-only", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/markdown-kitchen-sink.md",
      generalAccess: "link",
      renderMode: "rendered",
    });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    await expect(secondPage.getByText("Markdown kitchen sink", { exact: false })).toBeVisible();
    await expect(secondPage.getByTestId("share-role-badge")).toHaveText("Shared with you");
    await expect(secondPage.getByTestId("share-save")).toHaveCount(0);

    // Rendered -> Source toggle still works for a viewer; the surface stays
    // a real CM6 editor, just non-editable.
    await secondPage.getByRole("radio", { name: "Source" }).click();
    const editor = secondPage.locator(".cm-content").first();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await editor.click();
    await secondPage.keyboard.type("this should never appear");
    // Read-only: the keystrokes above must not have reached the document.
    // (Not a `.cm-content` textContent before/after diff — CM6 virtualizes
    // long documents, so the rendered slice can legitimately differ across
    // scroll/focus events even with zero edits; the marker text's total
    // absence from the page is the robust signal.)
    await expect(secondPage.getByText("this should never appear")).toHaveCount(0);

    await secondContext.close();
  });

  test("editor role: grant lets the owner edit and the save round-trips", async ({ page }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const seedContent = "# Editor role test\n\nOriginal content.\n";
    const path = await createFileWithContent(page, "vault/notes", "editor-role-test.md", seedContent);

    // Grant the OWNER's own resolved principal the editor role, so
    // visiting the share link from this SAME browser context (session
    // cookie carried over) resolves to role "editor" rather than the
    // default "viewer". `auth.py`'s `AuthContext.principal` is
    // `user.email or user.username` — email wins — so this must be
    // `DEMO_OWNER_EMAIL`, not the username, to match server-side
    // (`policy.py::_grant_role`).
    const link = await publishFileViaContextMenu(page, {
      treePath: path,
      generalAccess: "link",
      renderMode: "rendered",
      grant: { principal: DEMO_OWNER_EMAIL, role: "editor" },
    });

    // Same context/page — the app session cookie (Path=/) travels with it.
    await page.goto(link);
    await expect(page.getByTestId("share-role-badge")).toHaveText("Shared with you, can edit");

    const saveButton = page.getByTestId("share-save");
    await expect(saveButton).toBeDisabled();

    // Source mode for a deterministic cursor position (avoids the live
    // preview's markdown decorations for this plain append).
    await page.getByRole("radio", { name: "Source" }).click();
    const editor = page.locator(".cm-content").first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("Control+End");
    const marker = "Edited via the share editor role.";
    await page.keyboard.type(`\n\n${marker}`);

    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    // KNOWN BUG (found while writing this test, not a test defect — see
    // this file's header comment / the task report): as of this writing
    // this PUT 404s in THIS dev/preview e2e harness. `vite.config.ts`'s
    // `shareAuthProxy` `bypass()` (~line 182) proxies `/share/{id}` to the
    // backend only when the request sends `Accept: application/json`
    // (its heuristic for "JSON fetch, not a real browser navigation").
    // `putShareContent` (`src/share/api.ts` ~line 439) sets only
    // `Content-Type: text/plain` on its PUT, no `Accept` header, so it
    // fails that check and gets treated as a navigation — vite's own
    // static/SPA handling 404s it before it ever reaches the FastAPI
    // backend. Production is unaffected (single-origin, no proxy at all),
    // but this also breaks the editor-role Save button under plain
    // `npm run dev`/`vite preview`. Left as a real (currently red)
    // assertion per instructions: report the product bug, don't patch
    // around it in the test.
    await expect(saveButton).toHaveText("Saved");
    await expect(saveButton).toBeDisabled();
    await expect(page.getByTestId("share-save-error")).toHaveCount(0);

    // Reload — the persisted edit is served back from the share's blob.
    await page.reload();
    await expect(page.getByText(marker, { exact: false })).toBeVisible();
  });
});

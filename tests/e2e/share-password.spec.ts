/**
 * Password-protected share flow, and the no-existence-oracle contract
 * (`server/README.md`'s "Every deny reason is the SAME 404" section):
 * unauthenticated → generic "unavailable, or requires a password" state;
 * wrong password → the IDENTICAL generic state, never a "wrong password"
 * message; correct password → content renders.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { publishFileViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; its own share is a fresh, uniquely-slugged row
// so other specs' shares in the same DB never affect it.
//
// Phase 12c flake fix: this used to target the same file
// (`vault/notes/architecture.md`) as `share-panel.spec.ts` AND
// `share-publish-revoke.spec.ts`, under the same `e2e-owner` account — a
// real cross-spec race (see `share-publish-revoke.spec.ts`'s longer note),
// since the Explorer row context menu flips from "Publish…" to "Manage
// share…" the instant ANY of the three specs' publish call for that exact
// path lands first on the shared backend. Each of the three now targets a
// different seeded vault file so none of them can collide.
test.describe("password-protected share", () => {
  test("wrong password shows the identical generic state; correct password renders content", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const link = await publishFileViaContextMenu(page, {
      treePath: "vault/notes/daily-2026-08-14.md",
      generalAccess: "link",
      renderMode: "rendered",
      password: "correct-share-password-1",
    });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();

    // No session at all yet — the uniform generic state.
    await secondPage.goto(link);
    const unavailableTitle = secondPage.getByTestId("share-unavailable-title");
    await expect(unavailableTitle).toBeVisible();
    const genericText = await unavailableTitle.textContent();

    // Wrong password — the SAME generic state, byte-identical text, never
    // a distinct "wrong password" message (that would reopen the
    // existence oracle server/README.md's policy gate exists to close).
    await secondPage.getByTestId("share-password-input").fill("definitely-the-wrong-password");
    await secondPage.getByTestId("share-password-submit").click();
    await expect(unavailableTitle).toBeVisible();
    expect(await unavailableTitle.textContent()).toBe(genericText);
    await expect(secondPage.getByText(/wrong password/i)).toHaveCount(0);

    // Correct password — content renders.
    await secondPage.getByTestId("share-password-input").fill("correct-share-password-1");
    await secondPage.getByTestId("share-password-submit").click();
    await expect(secondPage.getByText("Wired the git status matrix", { exact: false })).toBeVisible();
  });
});

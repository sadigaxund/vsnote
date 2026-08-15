/**
 * Rendered-mode sandbox (`docs/ROADMAP-SHARING-AUTH.md` §1's security
 * bullet, Phase 10's to build per the phase brief): shared markdown must
 * never let embedded raw HTML execute or inject live DOM; shared HTML must
 * render only inside a sandboxed iframe (`sandbox=""`, no `allow-scripts`)
 * loaded via `srcdoc`. Both assertions would FAIL if the protection were
 * removed — a sentinel `window.__xss` that must stay `undefined`, and a
 * direct check of the iframe's `sandbox` attribute.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFileViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

const MARKDOWN_PAYLOAD = `# XSS probe

<script>window.__xss = 1;</script>

<img src="x" onerror="window.__xss = 1">

Regular text after the payload.
`;

const HTML_PAYLOAD = `<html><body><script>window.__xss = 1;</script><h1>xss probe</h1></body></html>`;

// The share backend (port 8788) is started once for the whole run by
// `tests/e2e/globalSetup.ts` — see `shareFixtures.ts`'s module docstring.
// This spec shares that one backend/database with the other three
// `share-*.spec.ts` files; both tests below publish content under unique
// filenames and read back only their own resulting share link.
test.describe("rendered-mode sandbox", () => {
  test("markdown: embedded raw HTML never executes or becomes live DOM", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const path = await createFileWithContent(page, "vault/notes", "xss-probe.md", MARKDOWN_PAYLOAD);
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    await expect(secondPage.getByText("XSS probe", { exact: false })).toBeVisible();
    await expect(secondPage.getByText("Regular text after the payload", { exact: false })).toBeVisible();

    // The sentinel a real script execution would set — must never be set.
    const xssFlag = await secondPage.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(xssFlag).toBeUndefined();

    // No live <script>/onerror-primed <img> in the actual DOM — the
    // payload rendered as inert text (CM6 syntax highlighting), not markup.
    await expect(secondPage.locator("script", { hasText: "__xss" })).toHaveCount(0);
    await expect(secondPage.locator("img[onerror]")).toHaveCount(0);

    await secondContext.close();
  });

  test("html: renders only inside a sandboxed iframe with no allow-scripts", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const path = await createFileWithContent(page, "vault/notes", "xss-probe.html", HTML_PAYLOAD);
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    const iframe = secondPage.locator("iframe");
    await expect(iframe).toBeVisible();
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");

    // The sentinel would be set on the TOP page's window if the iframe's
    // script somehow escaped the sandbox (it can't reach the parent even
    // if it ran, since there's no allow-same-origin/allow-top-navigation —
    // this asserts the observable, page-visible consequence).
    const xssFlag = await secondPage.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(xssFlag).toBeUndefined();

    await secondContext.close();
  });
});

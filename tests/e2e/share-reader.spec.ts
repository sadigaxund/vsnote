/**
 * Coverage for the chrome-less public reader rewrite
 * (docs/PLAN-2026-09-05-refresh.md §4.3 + the client half of §5): a visitor
 * gets the document and nothing else (no TitleBar, no tabs, no tree, no
 * Rendered/Source toggle, no role badge), and a "blog" made of ordinary
 * linked shares reads identically to a single-file share — links between
 * shared files just work, an unshared sibling degrades to muted text, and
 * the browser's own back button is the only navigation needed.
 *
 * Shares the one e2e backend (port 8788, `tests/e2e/globalSetup.ts`) with
 * the other `share-*.spec.ts` files — every share below targets vault paths
 * none of those files touch, so this file's publishes can never race theirs
 * on the "own share" Explorer context-menu flip (see
 * `share-publish-revoke.spec.ts`'s longer note on that exact class of
 * flake).
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFileViaContextMenu, revokeShareByLink, signInToShareBackend } from "./shareUiHelpers";

test.describe("chrome-less public reader", () => {
  test("a viewer gets the document and nothing else", async ({ page, browser }) => {
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
    // No app shell of any kind on this route.
    await expect(secondPage.getByTestId("app-titlebar")).toHaveCount(0);
    await expect(secondPage.getByTestId("explorer-sidebar")).toHaveCount(0);
    await expect(secondPage.locator('[data-testid^="tab-"]')).toHaveCount(0);
    await expect(secondPage.getByRole("radio", { name: "Source" })).toHaveCount(0);
    await expect(secondPage.getByRole("radio", { name: "Rendered" })).toHaveCount(0);
    await expect(secondPage.getByTestId("share-role-badge")).toHaveCount(0);
    await expect(secondPage.getByTestId("share-save")).toHaveCount(0);
    // No CodeMirror editor instance anywhere on this route.
    await expect(secondPage.locator(".cm-editor")).toHaveCount(0);

    await secondContext.close();
  });

  test("a blog of linked shares: clicking navigates, back button returns, an unshared sibling is muted text", async ({
    page,
    browser,
  }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const postAContent = [
      "# Blog post A",
      "",
      "This is the first post.",
      "",
      "[Read part two](./blog-post-b.md)",
      "",
      "[Unshared draft](./blog-post-unshared.md)",
      "",
    ].join("\n");
    const postBContent = ["# Blog post B", "", "This is the second post.", "", "[Back to part one](./blog-post-a.md)", ""].join("\n");

    const pathA = await createFileWithContent(page, "vault/notes", "blog-post-a.md", postAContent);
    const pathB = await createFileWithContent(page, "vault/notes", "blog-post-b.md", postBContent);
    // The unshared sibling exists in the vault but is never published — the
    // link map must never resolve it.
    await createFileWithContent(page, "vault/notes", "blog-post-unshared.md", "# Unshared draft\n\nNever published.\n");

    const linkA = await publishFileViaContextMenu(page, { treePath: pathA, generalAccess: "link", renderMode: "rendered" });
    const linkB = await publishFileViaContextMenu(page, { treePath: pathB, generalAccess: "link", renderMode: "rendered" });
    expect(linkB).toContain("/share/");

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(linkA);
    await expect(secondPage.getByRole("heading", { name: "Blog post A" })).toBeVisible();

    // The unshared sibling degrades to muted, non-clickable text carrying
    // a "Not shared" tooltip — never a dead, clickable link.
    const unsharedLink = secondPage.getByText("Unshared draft", { exact: false }).last();
    await expect(unsharedLink).toBeVisible();
    await expect(unsharedLink).toHaveAttribute("title", "Not shared");
    await expect(unsharedLink).not.toHaveAttribute("href");
    await expect(secondPage.getByRole("link", { name: "Unshared draft" })).toHaveCount(0);

    // Clicking the resolved link navigates — a real page load, not a
    // client-side route — to the second share.
    await secondPage.getByRole("link", { name: "Read part two" }).click();
    await expect(secondPage).toHaveURL(linkB);
    await expect(secondPage.getByRole("heading", { name: "Blog post B" })).toBeVisible();

    // Navigate back to post A by clicking ITS resolved link on post B's
    // page (the link map is symmetric), then prove the browser's own back
    // button alone gets you home too.
    await secondPage.getByRole("link", { name: "Back to part one" }).click();
    await expect(secondPage).toHaveURL(linkA);
    await expect(secondPage.getByRole("heading", { name: "Blog post A" })).toBeVisible();

    await secondPage.getByRole("link", { name: "Read part two" }).click();
    await expect(secondPage).toHaveURL(linkB);
    await secondPage.goBack();
    await expect(secondPage).toHaveURL(linkA);
    await expect(secondPage.getByRole("heading", { name: "Blog post A" })).toBeVisible();

    await secondContext.close();
  });

  test("revoking a share breaks the other share's link to it immediately, with no republish", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const indexContent = ["# Blog index", "", "[Only post](./blog-post-only.md)", ""].join("\n");
    const pathIndex = await createFileWithContent(page, "vault/notes", "blog-index.md", indexContent);
    const pathOnly = await createFileWithContent(page, "vault/notes", "blog-post-only.md", "# The only post\n\nContent.\n");

    const linkIndex = await publishFileViaContextMenu(page, { treePath: pathIndex, generalAccess: "link", renderMode: "rendered" });
    const linkOnly = await publishFileViaContextMenu(page, { treePath: pathOnly, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(linkIndex);
    await expect(secondPage.getByRole("link", { name: "Only post" })).toBeVisible();

    // Revoke the linked-to share from the OWNER's page — no republish of the
    // index share happens here.
    await revokeShareByLink(page, linkOnly);

    // The exact same index URL, reloaded (no republish) — the link map is
    // recomputed fresh on every fetch, so the now-revoked target simply
    // disappears from it.
    await secondPage.reload();
    await expect(secondPage.getByRole("link", { name: "Only post" })).toHaveCount(0);
    const degraded = secondPage.getByText("Only post", { exact: false }).last();
    await expect(degraded).toBeVisible();
    await expect(degraded).toHaveAttribute("title", "Not shared");

    await secondContext.close();
  });
});

test.describe("R3-5: selectable reading text + visitor reading preferences", () => {
  test("reader body text is selectable, and a code block's line-number gutter is excluded from the selection", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const content = [
      "# Selectable text",
      "",
      "This paragraph is real reading content a visitor must be able to select and copy.",
      "",
      "```txt",
      "line one",
      "line two",
      "line three",
      "```",
      "",
    ].join("\n");
    const path = await createFileWithContent(page, "vault/notes", "selection-doc.md", content);
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    // Prose: triple-clicking a paragraph must yield a real, non-empty
    // selection (the bug: `body`'s chrome-wide `user-select: none` reached
    // this route with no opt-in, so nothing was selectable at all).
    await secondPage.getByText("This paragraph is real reading content", { exact: false }).click({ clickCount: 3 });
    const proseSelection = await secondPage.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(proseSelection.trim().length).toBeGreaterThan(0);
    expect(proseSelection).toContain("real reading content");

    // Code block: drag-select from inside the first line's TEXT (never the
    // gutter) down through the third line's text. A real browser excludes
    // `user-select: none` subtrees from the resulting selection, so the
    // line-number spans ("1"/"2"/"3") must not appear glued to their line's
    // text even though they sit right next to it in the DOM.
    // Collapse the paragraph selection before dragging. The triple-click
    // above selects the paragraph plus its trailing whitespace, which
    // reaches into the code block's own region, so a mousedown on the first
    // code line lands INSIDE the existing selection and Chromium starts a
    // drag-and-drop of the selected text instead of a new selection: the
    // drag below then has no effect at all. Reproduced directly, and it is
    // not a timing artifact (waiting past the multi-click interval does not
    // help; collapsing the selection does).
    await secondPage.evaluate(() => window.getSelection()?.removeAllRanges());

    const lines = secondPage.locator(".mk-static-codeblock__text");
    const firstBox = await lines.nth(0).boundingBox();
    const lastBox = await lines.nth(2).boundingBox();
    if (!firstBox || !lastBox) throw new Error("code block lines not found");
    await secondPage.mouse.move(firstBox.x + 2, firstBox.y + firstBox.height / 2);
    await secondPage.mouse.down();
    await secondPage.mouse.move(lastBox.x + lastBox.width - 2, lastBox.y + lastBox.height / 2, { steps: 5 });
    await secondPage.mouse.up();
    const codeSelection = await secondPage.evaluate(() => window.getSelection()?.toString() ?? "");
    const normalized = codeSelection.replace(/\s+/g, "");
    expect(normalized).toContain("lineone");
    expect(normalized).toContain("linethree");
    // The tell-tale sign of a gutter digit leaking into the selection: it
    // would sit immediately before its line's text with nothing between.
    expect(normalized).not.toMatch(/1lineone/);
    expect(normalized).not.toMatch(/2linetwo/);
    expect(normalized).not.toMatch(/3linethree/);

    await secondContext.close();
  });

  test("fix(markdown): select-all in a code file share never sweeps up the header's filename", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const path = await createFileWithContent(page, "vault/notes", "select-all-code.ts", "const answer = 42;\nexport default answer;\n");
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    const filename = secondPage.locator(".mk-static-codeblock__filename");
    await expect(filename).toHaveText("select-all-code.ts");

    await secondPage.locator(".mk-static-codeblock__text").first().click();
    await secondPage.keyboard.press("Control+a");
    const selection = await secondPage.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selection).toContain("const answer = 42");
    expect(selection).not.toContain("select-all-code.ts");

    await secondContext.close();
  });

  test("feat(share) R6: a json share defaults to the tree renderer, and Source shows highlighted text", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const path = await createFileWithContent(page, "vault/notes", "r6-data.json", '{"name": "vsnote", "count": 3}');
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    // Defaults to the tree renderer — the library's TreeView, not raw text.
    await expect(secondPage.getByText("name", { exact: true })).toBeVisible();
    await expect(secondPage.getByText("vsnote", { exact: true })).toBeVisible();
    await expect(secondPage.locator(".mk-static-codeblock")).toHaveCount(0);

    // Switching to Source shows the raw, highlighted JSON text instead.
    await secondPage.getByTestId("share-view-mode").getByText("Source", { exact: true }).click();
    await expect(secondPage.locator(".mk-static-codeblock")).toBeVisible();
    await expect(secondPage.locator(".mk-static-codeblock__text").first()).toContainText("vsnote");

    await secondContext.close();
  });

  test("feat(share) R6: a csv share renders a table with header row cells", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const path = await createFileWithContent(page, "vault/notes", "r6-rows.csv", "name,score\nalpha,1\nbeta,2\n");
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    await expect(secondPage.getByRole("columnheader", { name: "name" })).toBeVisible();
    await expect(secondPage.getByRole("columnheader", { name: "score" })).toBeVisible();
    await expect(secondPage.getByRole("cell", { name: "alpha" })).toBeVisible();

    // Source shows the raw CSV text.
    await secondPage.getByTestId("share-view-mode").getByText("Source", { exact: true }).click();
    await expect(secondPage.locator(".mk-static-codeblock__text").first()).toContainText("name");

    await secondContext.close();
  });

  test("feat(share): changing Settings > Sharing > Reader appearance changes what visitors see, and survives a reload", async ({
    page,
    browser,
  }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const content = ["# Reading preferences", "", "Some prose whose rendered size changes with the font-size control.", ""].join("\n");
    const path = await createFileWithContent(page, "vault/notes", "prefs-doc.md", content);
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    // Defaults, before any owner setting is touched: system theme (no
    // override attribute), medium font.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);
    const readerRoot = secondPage.locator(".share-reader");
    const doc = secondPage.locator(".mk-doc");
    await expect(readerRoot).not.toHaveAttribute("data-reader-theme");
    await expect(readerRoot).toHaveAttribute("data-reader-fontsize", "m");
    const baseFontSize = await doc.evaluate((el) => getComputedStyle(el).fontSize);

    // Owner changes theme + font size in Settings > Sharing > Reader
    // appearance — an OWNER-wide setting, not per-visitor. Publishing above
    // opened/focused the new file's own tab, so Settings needs re-focusing
    // (its tab is still open in the background — `openSettingsTab` would
    // re-click the gear and re-assert `settings-view`, which is simpler
    // here since we already know it's open).
    await page.getByRole("tab", { name: "Settings" }).click();
    const settings = page.getByTestId("reader-appearance-settings");
    await expect(settings).toBeVisible();
    const themeSave = page.waitForResponse((r) => r.url().includes("/api/reader-prefs") && r.request().method() === "PUT");
    await settings.getByTestId("reader-appearance-theme").getByText("Dark", { exact: true }).click();
    await themeSave;
    const fontSave = page.waitForResponse((r) => r.url().includes("/api/reader-prefs") && r.request().method() === "PUT");
    await settings.getByTestId("reader-appearance-fontsize").getByText("L", { exact: true }).click();
    await fontSave;

    // A FRESH visitor load (not a reload of the already-open reader) picks
    // up the new owner setting — it's baked into the content response, not
    // pushed live to an already-open tab.
    const thirdContext = await browser.newContext();
    const thirdPage = await thirdContext.newPage();
    await thirdPage.goto(link);
    const thirdRoot = thirdPage.locator(".share-reader");
    await expect(thirdRoot).toHaveAttribute("data-reader-theme", "dark");
    await expect(thirdRoot).toHaveAttribute("data-reader-fontsize", "l");
    await expect
      .poll(async () => thirdPage.locator(".mk-doc").evaluate((el) => getComputedStyle(el).fontSize))
      .not.toBe(baseFontSize);

    // Survives a reload of that same tab too (it's server-persisted, not
    // session state).
    await thirdPage.reload();
    await expect(thirdPage.locator(".share-reader")).toHaveAttribute("data-reader-theme", "dark");
    await expect(thirdPage.locator(".share-reader")).toHaveAttribute("data-reader-fontsize", "l");

    await secondContext.close();
    await thirdContext.close();
  });
});

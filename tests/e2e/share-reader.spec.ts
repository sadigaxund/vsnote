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

  test("reading-preferences pill: exists, its controls visibly change the document, and the choice survives a reload", async ({
    page,
    browser,
  }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

    const content = [
      "# Reading preferences",
      "",
      "Some prose whose rendered size changes with the font-size control.",
      "",
      "```txt",
      "a single very long unbroken line of code that behaves differently wrapped vs scrolled",
      "```",
      "",
    ].join("\n");
    const path = await createFileWithContent(page, "vault/notes", "prefs-doc.md", content);
    const link = await publishFileViaContextMenu(page, { treePath: path, generalAccess: "link", renderMode: "rendered" });

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(link);

    const pill = secondPage.getByTestId("share-reader-prefs");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("role", "group");

    const readerRoot = secondPage.locator(".share-reader");
    const doc = secondPage.locator(".mk-doc");
    const codeText = secondPage.locator(".mk-static-codeblock__text").first();

    // Defaults, stated in `readerPrefs.ts`: system theme (no override
    // attribute), medium font, wrap on.
    await expect(readerRoot).not.toHaveAttribute("data-reader-theme");
    await expect(readerRoot).toHaveAttribute("data-reader-fontsize", "m");
    await expect(readerRoot).toHaveAttribute("data-code-wrap", "on");
    await expect(codeText).toHaveCSS("white-space", "pre-wrap");

    // Font size: choosing "L" visibly grows the document's base font-size.
    const baseFontSize = await doc.evaluate((el) => getComputedStyle(el).fontSize);
    await pill.getByRole("radio", { name: "L", exact: true }).click({ force: true });
    await expect(readerRoot).toHaveAttribute("data-reader-fontsize", "l");
    await expect.poll(async () => doc.evaluate((el) => getComputedStyle(el).fontSize)).not.toBe(baseFontSize);

    // Theme: choosing "Dark" visibly changes the reader's background.
    const baseBg = await readerRoot.evaluate((el) => getComputedStyle(el).backgroundColor);
    await pill.getByRole("radio", { name: "Dark", exact: true }).click({ force: true });
    await expect(readerRoot).toHaveAttribute("data-reader-theme", "dark");
    await expect.poll(async () => readerRoot.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(baseBg);

    // Wrap: turning it off switches the code line from wrapping to a
    // single unbroken (scrollable) line.
    await pill.getByTestId("share-reader-prefs-wrap").click({ force: true });
    await expect(readerRoot).toHaveAttribute("data-code-wrap", "off");
    await expect(codeText).toHaveCSS("white-space", "pre");

    // All three choices survive a reload (persisted to the VISITOR's own
    // localStorage, `vsnote-share-reader-prefs`).
    await secondPage.reload();
    await expect(secondPage.locator(".share-reader")).toHaveAttribute("data-reader-theme", "dark");
    await expect(secondPage.locator(".share-reader")).toHaveAttribute("data-reader-fontsize", "l");
    await expect(secondPage.locator(".share-reader")).toHaveAttribute("data-code-wrap", "off");
    await expect(secondPage.locator(".mk-static-codeblock__text").first()).toHaveCSS("white-space", "pre");

    await secondContext.close();
  });
});

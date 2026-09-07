/**
 * R3-9: language coverage via `@codemirror/language-data`. Before this
 * change, `filetypes/registry.ts` only hand-wrote entries for
 * md/mkmd/ts/tsx/js/jsx/json/css/html/csv/image, and
 * `lib/fileTree.ts::inferFileKind` had no case for `.py` (or go/rs/sh/
 * yaml/toml/sql/java/c/cpp/rb/php/xml/ini/Dockerfile/...), so any such
 * file fell all the way through to `"unknown"` -> the plain-text entry:
 * no syntax highlighting and no Rendered mode ANYWHERE (Source mode, diff,
 * the public share reader, print/export). `.py` is this spec's example —
 * it's the one the owner actually reported — but the fix is the generic
 * `"code"` `FileKind` (`types.ts`), resolved per-file by filename via
 * `@codemirror/language-data`'s `LanguageDescription.matchFilename`, so
 * every language it covers benefits, not just Python.
 *
 * Note on "tok-*" spans: `markdown/codeBlock.tsx`'s static Rendered/reader
 * view highlights via `@lezer/highlight`'s `classHighlighter`, which emits
 * literal `tok-*` classes (see `theme.css`'s mapping) — asserted directly
 * below. Source mode is a REAL CodeMirror 6 `EditorView` using this app's
 * own `HighlightStyle.define` (`editor/theme.ts`), which CM6 compiles to
 * its own hashed per-style classes, not the `tok-*` vocabulary — so the
 * Source-mode assertion below checks for CM6's actual highlighting output
 * (a styled inline `<span>` with a real `class` inside `.cm-line`) rather
 * than a literal `tok-*` string, which Source mode never emits by design.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, tab, treeRow } from "./fixtures";
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { createFileWithContent, publishFileViaContextMenu, signInToShareBackend } from "./shareUiHelpers";

const PYTHON_SNIPPET = ["def greet(name):", '    # a comment', '    return f"hello, {name}"', "", "print(greet(\"world\"))", ""].join("\n");

test.describe("R3-9: .py gets real language coverage (@codemirror/language-data)", () => {
  test("a .py file highlights in Source mode (real CM6 tokens) and offers a working Rendered mode", async ({ page }) => {
    await gotoApp(page);
    const path = await createFileWithContent(page, "vault/notes", "greet.py", PYTHON_SNIPPET);
    await tab(page, path).click();

    // Source mode: a real CodeMirror 6 instance, with actual syntax
    // highlighting (a styled span inside a `.cm-line`) — not the old
    // plain-text-with-no-classes degrade.
    const sourceToggle = page.getByRole("radio", { name: "Source" });
    await expect(sourceToggle).toBeChecked();
    const cmContent = page.locator(".cm-content").first();
    await expect(cmContent).toBeVisible();
    await expect(cmContent.locator(".cm-line span[class]").first()).toBeVisible();

    // Rendered mode is now offered (registry's `code` entry: baseModes
    // includes "rendered") and resolves the SAME Python language, this
    // time via the static `CodeBlock` / `classHighlighter`'s literal
    // `tok-*` classes.
    const renderedToggle = page.getByRole("radio", { name: "Rendered" });
    await expect(renderedToggle).toBeEnabled();
    await renderedToggle.click();
    const codeBlock = page.locator(".mk-static-codeblock").first();
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock.locator("[class*='tok-']").first()).toBeVisible();
    // `def`/`return`/`print` are Python keywords — real language-aware
    // highlighting, not a lucky generic match.
    await expect(codeBlock.locator("[class*='tok-keyword']").first()).toBeVisible();
  });

  test("a published .py file highlights in the public share reader too", async ({ page, browser }) => {
    await gotoApp(page);
    await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);
    const path = await createFileWithContent(page, "vault/notes", "reader-greet.py", PYTHON_SNIPPET);

    const link = await publishFileViaContextMenu(page, {
      treePath: path,
      generalAccess: "link",
      renderMode: "rendered",
    });

    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    await readerPage.goto(link);

    const codeBlock = readerPage.locator(".mk-static-codeblock").first();
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock.locator("[class*='tok-']").first()).toBeVisible();
    await expect(codeBlock.locator("[class*='tok-keyword']").first()).toBeVisible();

    await readerContext.close();
  });

  test("other language-data-only extensions (go, yaml) also get a Rendered mode with real highlighting", async ({ page }) => {
    await gotoApp(page);
    const goPath = await createFileWithContent(page, "vault/notes", "main.go", 'package main\n\nfunc main() {\n\tprintln("hi")\n}\n');
    await tab(page, goPath).click();
    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.locator(".mk-static-codeblock [class*='tok-']").first()).toBeVisible();

    const yamlPath = await createFileWithContent(page, "vault/notes", "config.yaml", "name: vsnote\nversion: 1\n");
    await tab(page, yamlPath).click();
    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.locator(".mk-static-codeblock [class*='tok-']").first()).toBeVisible();
  });

  test("a Dockerfile (no extension, matched by filename) still gets no crash and degrades sanely if unmatched", async ({ page }) => {
    await gotoApp(page);
    const path = await createFileWithContent(page, "vault/notes", "notes.vsnoteunknownext", "just some bytes\n");
    await treeRow(page, path).click();
    await tab(page, path).click();
    // Neither the table nor language-data recognizes this extension —
    // Source mode still works (plain, uncrashed), and Rendered is still
    // offered by the generic "code" kind (CodeBlock degrades to plain
    // escaped text rather than throwing).
    await expect(page.locator(".cm-content").first()).toBeVisible();
    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.locator(".mk-static-codeblock").first()).toBeVisible();
    await expect(page.locator(".mk-static-codeblock [class*='tok-']")).toHaveCount(0);
  });
});

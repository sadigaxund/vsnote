/**
 * R3-12: the owner tested `.mk.md` in Rendered (live-preview) mode and got
 * none of the markii editor sugar — `markiiEditorExtensions()`
 * (`src/editor/markiiCompletion.ts`) was only ever passed to Source mode's
 * `CodeMirrorEditor`. This spec exercises the Rendered-mode wiring added
 * by that fix (`LivePreviewEditor.tsx`'s new `mkMdCompletionCompartmentRef`
 * — see that file's module doc, point 3) end to end:
 *
 * 1. Typing `:::` in Rendered mode opens the directive completion popup.
 * 2. Accepting `center` inserts its container skeleton.
 * 3. Hand-typing a nested container opener (`:::note`) inside it and
 *    pressing Enter lengthens the OUTER pair transitively
 *    (`manualContainerOpenFenceEdits`, the manual-typing counterpart to
 *    vendored `fenceExtensionEdits` — see that export's own doc comment):
 *    `:::center` / `:::` becomes `::::center` / `::::`.
 *
 * Mirrors `markii-live-preview.spec.ts`'s own fixture creation flow (no
 * seeded `.mk.md` in the demo vault, so this test creates one via the
 * Explorer's "New File" flow). `mkmd`'s `defaultMode` is `"rendered"`
 * (`filetypes/registry.ts`), so a freshly created `.mk.md` tab opens
 * straight into Rendered mode — no mode switch needed.
 */
import { test, expect, type Locator } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

/**
 * The exact document text, reconstructed from CM6's own per-line DOM
 * (`.cm-line`) rather than `Locator.innerText()`. `innerText()` goes
 * through the BROWSER's own text/layout reconstruction, which — verified
 * directly against the actual CM6 document model via a throwaway
 * `console.log` of `view.state.doc` during this test's own development —
 * inflates a bare/empty line into what reads as an EXTRA blank line in the
 * returned string, purely a `.innerText()` presentation artifact having
 * nothing to do with `markiiCompletion.ts`'s actual accepted text. Each
 * `.cm-line` is exactly one document line regardless of soft-wrap (CM6
 * wraps a long line WITHIN its own line element, never splits it across
 * more than one `.cm-line`), so joining their text contents with `\n`
 * reconstructs the document byte-for-byte.
 */
async function editorText(editor: Locator): Promise<string> {
  return (await editor.locator(".cm-line").allTextContents()).join("\n");
}

test.describe("markii editor sugar in Rendered mode (.mk.md)", () => {
  test("completion popup, accepting a container, and manual-typing fence lengthening all work in Rendered mode", async ({
    page,
  }) => {
    await gotoApp(page);

    // Create `vault/src/rendered-sugar.mk.md` via the Explorer context menu
    // — opens straight into Rendered mode (mkmd's defaultMode).
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("rendered-sugar.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/rendered-sugar.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await expect(page.getByRole("radio", { name: "Rendered" })).toBeChecked();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await rendered.click();

    // Step 1 + 2: type "::: " worth of directive-name context and accept
    // "center" from the popup — proves the completion source is wired in
    // Rendered mode at all (this ticket's core gap).
    await page.keyboard.type(":::");
    const popup = page.locator(".cm-tooltip-autocomplete");
    await expect(popup).toBeVisible();
    // CodeMirror renders each option as an <li role="option"> holding an
    // icon, the label and the detail text, so the option's accessible name
    // is the label PLUS its description. Match the label element itself.
    const centerOption = popup.locator("li:has(.cm-completionLabel:text-is('center'))").first();
    await expect(centerOption).toBeVisible();
    await centerOption.click();

    // `componentSkeleton("center", "container", [])` is
    // `:::center\n\n:::`, cursor landing right after the first `\n` —
    // i.e. on the blank body line between the two fences. That's exactly
    // where the next step needs to type.
    await expect.poll(async () => (await rendered.innerText())).toContain(":::center");

    // Step 3: hand-type a nested container opener on that blank body line,
    // then Enter. Escape first to close the (harmless, but Enter-hungry)
    // completion popup this second `:::` also opens — it has nothing
    // matching "note" to accept, but a stray Enter must not be swallowed
    // by it instead of reaching the fence-lengthening keymap.
    await page.keyboard.type(":::note");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");

    // The outer `center` pair must now read FOUR colons on both its
    // opening and closing fence line, `::::center` and `::::`, while the
    // freshly typed `:::note` line stays at three (it is the innermost
    // fence now, so it does not need to grow). Asserted in SOURCE mode:
    // Rendered mode's own innerText is a mix of revealed raw lines and
    // widget content, which is the right thing for a reader and the wrong
    // thing for reading the document back.
    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await expect.poll(async () => (await source.innerText())).toMatch(/^::::center/m);
    await expect.poll(async () => (await source.innerText())).toMatch(/^::::$/m);
    await expect.poll(async () => (await source.innerText())).toContain(":::note");
  });

  test("popup is keyboard-navigable: ArrowDown moves the highlight, Enter accepts the highlighted item", async ({
    page,
  }) => {
    // Round 5 MK item 1: with the popup open, ArrowUp/ArrowDown used to move
    // the CARET (via `decorations.ts`'s block-navigation keymap, which never
    // checked `completionStatus` and always won the same-precedence race
    // against `@codemirror/autocomplete`'s own arrow bindings — see that
    // file's `mkBlockVerticalNavigation` doc for the fix) instead of the
    // selected option, and Enter inserted a newline instead of accepting.
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("rendered-sugar-nav.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/rendered-sugar-nav.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await expect(page.getByRole("radio", { name: "Rendered" })).toBeChecked();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await rendered.click();

    await page.keyboard.type(":::");
    const popup = page.locator(".cm-tooltip-autocomplete");
    await expect(popup).toBeVisible();
    const options = popup.locator("li .cm-completionLabel");
    await expect(options).toHaveCount(await options.count()); // settle before reading
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(3);
    const thirdLabel = await options.nth(2).innerText();

    // Two ArrowDowns from the first (auto-selected) option land on the
    // third; grab the currently-highlighted item's text at each step to
    // prove the HIGHLIGHT is moving, not just the caret.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const selected = popup.locator("li[aria-selected] .cm-completionLabel");
    await expect(selected).toHaveText(thirdLabel);

    await page.keyboard.press("Enter");
    await expect(popup).toBeHidden();
    // Enter must have ACCEPTED the third item's skeleton, not inserted a
    // bare newline — the fence line now names that directive.
    await expect.poll(async () => (await rendered.innerText())).toContain(`:::${thirdLabel}`);
  });

  /**
   * Round 6 MK item 2 regression: accepting `row` after typing `:::ro` used
   * to leave the typed `ro` behind as a leftover line right after the
   * inserted skeleton's closing fence (`:::row{ }` / blank / `:::ro`) —
   * `toCmCompletion`'s `apply` closed over a `to` frozen at the moment the
   * popup first opened (right after `:::` alone), instead of reading the
   * LIVE end of the typed span CodeMirror hands `apply` on accept (see that
   * function's own doc in `markiiCompletion.ts`). Checked in BOTH modes —
   * Source mode's `CodeMirrorEditor` and Rendered mode's `LivePreviewEditor`
   * share the exact same `markiiEditorExtensions()` bundle, but the
   * completion-accept path is worth confirming didn't regress in either
   * wiring. Also confirms the round-6 `componentSkeleton` fix: no bare
   * empty `{}`/`{ }` for a component with no required attributes ("row"
   * only has an optional `cols`).
   */
  test("accepting a completion after typing past the query position replaces the whole typed prefix, in both modes", async ({
    page,
  }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("accept-range.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/accept-range.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    // Source mode first.
    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await source.click();
    await page.keyboard.type(":::ro");
    const sourcePopup = page.locator(".cm-tooltip-autocomplete");
    await expect(sourcePopup).toBeVisible();
    // "ro" is a substring of BOTH "row" (prefix) and "narrow" (mid-word),
    // so more than one option matches — CM6's own fuzzy ranking puts the
    // PREFIX match first and highlights it automatically. Accept with
    // Enter (this is what's under test — a real accept after typing PAST
    // the point the popup first queried, not the click path) rather than
    // picking a specific option by mouse.
    const rowInSource = sourcePopup.getByRole("option", { name: /^row\b/ }).first();
    await expect(rowInSource).toBeVisible();
    await expect(rowInSource).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(sourcePopup).toBeHidden();
    await expect.poll(async () => await editorText(source)).toBe(":::row\n\n:::");

    // Rendered mode: same sequence, on a fresh line.
    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await rendered.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n:::ro");
    const renderedPopup = page.locator(".cm-tooltip-autocomplete");
    await expect(renderedPopup).toBeVisible();
    const rowInRendered = renderedPopup.getByRole("option", { name: /^row\b/ }).first();
    await expect(rowInRendered).toBeVisible();
    await expect(rowInRendered).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(renderedPopup).toBeHidden();

    await page.getByRole("radio", { name: "Source" }).click();
    await expect.poll(async () => await editorText(source)).toBe(":::row\n\n:::\n\n:::row\n\n:::");
  });
});

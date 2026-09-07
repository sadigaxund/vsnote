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
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

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
    const centerOption = popup.getByRole("option", { name: "center", exact: true });
    await expect(centerOption).toBeVisible();
    await centerOption.click();

    // `componentSkeleton("center", "container", [])` is
    // `:::center{}\n\n:::`, cursor landing right after the first `\n` —
    // i.e. on the blank body line between the two fences. That's exactly
    // where the next step needs to type.
    await expect.poll(async () => (await rendered.innerText())).toContain(":::center");
    await expect.poll(async () => (await rendered.innerText())).toMatch(/^:::$/m);

    // Step 3: hand-type a nested container opener on that blank body line,
    // then Enter. Escape first to close the (harmless, but Enter-hungry)
    // completion popup this second `:::` also opens — it has nothing
    // matching "note" to accept, but a stray Enter must not be swallowed
    // by it instead of reaching the fence-lengthening keymap.
    await page.keyboard.type(":::note");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");

    // The outer `center` pair must now read FOUR colons on both its
    // opening and closing fence line — `::::center` / `::::` — while the
    // freshly typed `:::note` line stays at three (it's the innermost
    // fence now, so it doesn't need to grow).
    await expect.poll(async () => (await rendered.innerText())).toMatch(/^::::center/m);
    await expect.poll(async () => (await rendered.innerText())).toMatch(/^::::$/m);
    await expect.poll(async () => (await rendered.innerText())).toContain(":::note");
  });
});

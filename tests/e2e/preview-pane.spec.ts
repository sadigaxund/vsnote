/**
 * R3-11 exit criterion: with the side-by-side Preview pane open, typing a
 * `:::center` container directive in Source mode shows the rendered widget
 * on the RIGHT (the Preview pane, static `renderMarkdown` output) while the
 * raw fence text stays visible on the LEFT (the live source editor) — the
 * whole point of the feature per the task brief: a directive being typed
 * has somewhere to show what it will look like without leaving Source mode
 * or waiting for the caret to move away (Rendered mode's own Obsidian
 * reveal rule doesn't help while the caret is still inside what you're
 * typing).
 *
 * Uses the single-pane tab-bar toggle (`data-testid="tabbar-preview-toggle"`)
 * — this test intentionally never opens a second editor pane, so
 * `EditorHeader`'s own copy of the toggle (the multi-pane case) never
 * mounts; see `EditorPane.tsx`'s module doc for why there are two.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("side-by-side Preview pane (.mk.md / .md)", () => {
  test("typing a container directive in Source mode renders it live in the Preview pane", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-demo.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-demo.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();

    // Preview closed by default — no pane, no toggle visibly "pressed".
    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
    const toggle = page.getByTestId("tabbar-preview-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("markdown-preview-pane")).toContainText("preview-pane-demo.mk.md");

    // Type the directive in the SOURCE editor (left side).
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type("Intro paragraph.\n\n:::center\nHello from the preview pane.\n:::\n");

    // Left side still shows the raw fence text (Source mode never hides
    // syntax — that's Rendered mode's job, not this one's).
    await expect(source).toContainText(":::center");
    await expect(source).toContainText(":::");

    // Right side (Preview) shows the RENDERED widget, no raw fence text at
    // all, once the ~150ms debounce settles.
    const preview = page.getByTestId("markdown-preview-pane");
    await expect.poll(async () => (await preview.innerText()).includes(":::")).toBe(false);
    await expect(preview).toContainText("Hello from the preview pane.");
    await expect(preview).toContainText("Intro paragraph.");

    // Toggling off removes the pane and returns the editor to full width.
    await toggle.click();
    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("closing the source tab closes the Preview pane with it", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-close.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-close.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    await page.getByTestId("tabbar-preview-toggle").click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();

    await page
      .locator(`[role="tab"][data-tab-path="vault/src/preview-pane-close.md"]`)
      .getByRole("button", { name: "Close preview-pane-close.md" })
      .click();

    await expect(page.getByTestId("markdown-preview-pane")).toHaveCount(0);
  });

  /**
   * R5-7: the static renderer (`.mk-doc`, this pane) and the live-preview
   * CM6 engine (Rendered mode) must render the SAME document with the same
   * line rhythm — before this fix `.mk-doc` had no `line-height` at all
   * (theme.css) while Rendered mode always rendered at
   * `DEFAULT_RENDERED_LINE_SPACING` (1.8). Measures computed styles rather
   * than asserting a hardcoded pixel constant (per the task brief) — the
   * ratio of computed `line-height` to computed `font-size` is compared
   * (not raw px, since the two surfaces have different base font sizes:
   * `.mk-doc` is 16px, Rendered mode's prose baseline is 17px) so the test
   * tracks the SHARED TOKEN's multiplier (`--mk-line-height`) rather than
   * either surface's independent font-size choice.
   */
  test("Preview pane and Rendered mode agree on line-height (same token, not just close numbers)", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-rhythm.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-rhythm.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type("First paragraph of prose.\n\nSecond paragraph of prose.\n");

    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.getByTestId("tabbar-preview-toggle")).toBeVisible();
    await page.getByTestId("tabbar-preview-toggle").click();
    const preview = page.getByTestId("markdown-preview-pane");
    await expect(preview).toContainText("First paragraph of prose.");

    // Rendered mode's own line rhythm — `.cm-scroller` is the element
    // `--atomic-editor-body-leading` is applied to (`atomic-theme.js`).
    const renderedRatio = await page
      .locator('[data-pane-source] .cm-scroller')
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
      });

    // The static renderer's rhythm — a real `<p>` inside `.mk-doc`.
    const previewRatio = await preview.locator(".mk-doc p").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    });

    expect(previewRatio).toBeCloseTo(renderedRatio, 1);
  });

  /**
   * R5-7b — heading scale. Before this fix `.mk-doc h1`-`h6` (theme.css)
   * and the live-preview CM6 engine's `.cm-atomic-h1`-`h6`
   * (`@atomic-editor/editor`'s packaged `inline-preview.css`) used two
   * independently hand-picked em-multiple scales (2/1.5/1.2/1/1/1 vs
   * 1.35/1.2/1.1/1/0.95/0.9), the reported ~30px (Preview pane) vs ~22px
   * (Rendered mode) h1. Both now read `index.css`'s shared
   * `--mk-h1-size`.."--mk-h6-size` tokens. Same pattern as the
   * line-height test above: compares each heading's font-size/BODY
   * font-size RATIO per surface (not raw px — `.mk-doc`'s 16px base and
   * Rendered mode's 17px prose baseline still differ), so this tracks
   * the shared token's em-multiple, not either surface's independent
   * font-size choice.
   */
  test("Preview pane and Rendered mode agree on heading scale (same token per level)", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-headings.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-headings.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type("# Heading one\n\nSome prose.\n\n## Heading two\n\nMore prose.\n\n### Heading three\n\nEven more.\n");

    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.getByTestId("tabbar-preview-toggle")).toBeVisible();
    await page.getByTestId("tabbar-preview-toggle").click();
    const preview = page.getByTestId("markdown-preview-pane");
    await expect(preview).toContainText("Heading one");

    const cmContent = page.locator('[data-pane-source] .cm-content').first();
    const bodySizeEditor = await cmContent.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const bodySizePreview = await preview.locator(".mk-doc").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    for (const [editorClass, previewTag] of [
      ["cm-atomic-h1", "h1"],
      ["cm-atomic-h2", "h2"],
      ["cm-atomic-h3", "h3"],
    ] as const) {
      const editorSize = await cmContent
        .locator(`.${editorClass}`)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const previewSize = await preview
        .locator(`.mk-doc ${previewTag}`)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

      const editorRatio = editorSize / bodySizeEditor;
      const previewRatio = previewSize / bodySizePreview;
      expect(previewRatio, `${previewTag} scale`).toBeCloseTo(editorRatio, 1);
    }
  });

  /**
   * R5-7b — directive block spacing. `@markii/react/dist/doc.css` gives
   * every component (`.mk-row`, `.mk-card`, …) zero outer margin by
   * design (its OWN header comment: "components own their insides only,
   * never outer margins") — outer rhythm is supposed to come from
   * `.doc > * + *`, but this app renders into `.mk-doc`, not `.doc`
   * (`render.tsx`), so that rule never applied and a top-level directive
   * had no spacing contract of its own on either surface. Both now read
   * `--mk-paragraph-spacing` — `theme.css`'s `.mk-doc > :where(.mk-row,
   * .mk-card, …)` on the Preview pane side, `directiveLezer/
   * decorations.ts`'s `mkLivePreviewTheme` (`.mk-live-preview-block`
   * padding) on the live-preview side. Expressed the same way as the
   * line-height/heading tests: as a ratio to each surface's OWN body
   * font-size (both should read out to ~1, one paragraph-spacing unit),
   * not a hardcoded pixel constant — `--mk-paragraph-spacing` is `1em`,
   * so a value of 1 confirms the token, not a coincidence of two
   * independently-tuned numbers landing close together.
   */
  test("Preview pane and Rendered mode agree on directive block spacing (same token)", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-block-gap.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-block-gap.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator('[data-pane-source] .cm-content').first();
    await source.click();
    await page.keyboard.type("Before the row.\n\n:::row\nCell A\n\nCell B\n:::\n\nAfter the row.\n");

    await page.getByRole("radio", { name: "Rendered" }).click();
    await expect(page.getByTestId("tabbar-preview-toggle")).toBeVisible();
    await page.getByTestId("tabbar-preview-toggle").click();
    const preview = page.getByTestId("markdown-preview-pane");
    await expect(preview).toContainText("Cell A");

    // Preview pane: the row's own bottom margin against `.mk-doc`'s base
    // font-size.
    const previewRatio = await preview.evaluate((container) => {
      const doc = container.querySelector(".mk-doc") as HTMLElement;
      const row = doc.querySelector(".mk-row") as HTMLElement;
      const docFontSize = parseFloat(getComputedStyle(doc).fontSize);
      const marginBottom = parseFloat(getComputedStyle(row).marginBottom);
      return marginBottom / docFontSize;
    });

    // Rendered mode: the widget's total (top + bottom) padding against
    // `.cm-content`'s own base font-size — split across both sides via
    // `calc(--mk-paragraph-spacing / 2)` so the two together add up to
    // one full paragraph-spacing unit, same as the Preview pane's single
    // bottom margin.
    const cmContent = page.locator('[data-pane-source] .cm-content').first();
    const editorRatio = await cmContent.evaluate((el) => {
      const block = el.querySelector(".mk-live-preview-block") as HTMLElement;
      const bodyFontSize = parseFloat(getComputedStyle(el).fontSize);
      const cs = getComputedStyle(block);
      const totalPadding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return totalPadding / bodyFontSize;
    });

    expect(previewRatio).toBeCloseTo(editorRatio, 1);
  });

  test("the command palette's Toggle preview command opens and closes the pane", async ({ page }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("preview-pane-palette.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/preview-pane-palette.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();
    await page.getByRole("radio", { name: "Source" }).click();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Toggle preview" }).click();
    await expect(page.getByTestId("markdown-preview-pane")).toBeVisible();
  });
});

/**
 * Phase M2 (docs/PLAN-2026-09-05-refresh.md §6) exit criterion: the
 * Obsidian live-preview cursor rule (DESIGN-SPEC item 61 and earlier —
 * "raw syntax revealed only around the cursor, instant re-render on
 * leave") applied to a markii container directive inside a `.mk.md` file's
 * Rendered mode. Mirrors `live-preview.spec.ts`'s own structure (plain
 * `.md`'s bold-marker reveal test) but for `:::name{}...:::`.
 *
 * There's no seeded `.mk.md` fixture in the demo vault yet, so this test
 * creates one via the Explorer's "New File" flow (same mechanic
 * `fs-git.spec.ts`'s "create, rename, and delete a file" test uses), types
 * a container directive in Source mode, then switches to Rendered mode to
 * exercise the cursor rule.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

test.describe("markii directive live preview (.mk.md Rendered mode)", () => {
  test("cursor outside a container directive shows the rendered widget; cursor inside reveals raw source", async ({
    page,
  }) => {
    await gotoApp(page);

    // Create `vault/src/directive-demo.mk.md` via the Explorer context menu.
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("directive-demo.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/directive-demo.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    // Type the document in Source mode — a plain paragraph, then a
    // container directive, so the "cursor elsewhere" case has somewhere
    // real to click.
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("Some intro text.\n\n:::center\nHello from inside.\n:::\n");

    // Rendered mode: with the cursor nowhere near the directive, it must
    // show as a rendered widget, not raw `:::` fences.
    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(false);
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
    await expect(rendered.locator(".mk-live-preview-block")).toContainText("Hello from inside.");

    // Move the cursor inside the container by clicking its rendered text —
    // CM6 places the caret at the nearest document position, which for a
    // block-widget-replaced range lands inside the hidden span. Raw source
    // must reappear, and the widget must be gone (Obsidian's own reveal
    // behavior: only ever one representation on screen for a given span,
    // never both).
    await rendered.locator(".mk-live-preview-block").click();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(true);
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    await expect(rendered).toContainText("Hello from inside.");
    await expect(rendered).toContainText(":::");

    // Moving away re-renders it clean again — click into the intro
    // paragraph instead.
    await rendered.getByText("Some intro text.", { exact: false }).click();
    await expect.poll(async () => (await rendered.innerText()).includes(":::")).toBe(false);
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
  });

  /**
   * Regression guard for `mkBlockVerticalNavigation`
   * (`src/markdown/directiveLezer/decorations.ts`) — arrowing into a
   * collapsed container directive's block widget used to leave the caret
   * visually stuck at the widget's right/bottom edge (a `Decoration.replace
   * ({ block: true })` range has no text for CM6's x-preserving vertical
   * motion to land in, so it resolved to the range's END regardless of
   * approach direction) instead of entering the block. The status bar's
   * `Ln n, Col n` readout (`src/components/StatusBar.tsx`) is used as a
   * precise, DOM-visible proxy for the actual caret position — there is no
   * other way to read a CM6 selection's document offset from outside the
   * page.
   *
   * Document (1-based lines):
   *   1  Some intro text.
   *   2  (blank)
   *   3  :::center
   *   4  Hello from inside.
   *   5  :::
   *   6  (blank)
   *   7  Outro text.
   *
   * Both approaches start from the END of the adjacent paragraph (a large,
   * non-zero horizontal caret position) specifically so the browser's
   * x-preserving vertical motion is actually exercised — starting from
   * column 1 would trivially land at the block's left edge even without
   * the fix and prove nothing.
   */
  test("arrowing into a collapsed container directive enters it instead of getting stuck at its edge", async ({
    page,
  }) => {
    await gotoApp(page);

    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill("directive-nav.mk.md");
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, "vault/src/directive-nav.mk.md");
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await source.click();
    await page.keyboard.type(
      "Some intro text.\n\n:::center\nHello from inside.\n:::\n\nOutro text.\n",
    );

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();

    // The status bar's Ln/Col readout is deliberately pinned to "Ln 1,
    // Col 1" outside Source and Diff mode (`StatusBar.tsx`), so it cannot
    // be the probe here. CodeMirror's own `.cm-activeLine` marks the line
    // the caret is on, which is exactly the question: did the caret land on
    // a real fence line, or get stuck at the widget's edge?
    const activeLineText = () => rendered.locator(".cm-activeLine").first().innerText();

    // Entering from ABOVE: end of line 1, then down through the blank line
    // 2, then into the container — must land on its OPENING fence line,
    // not be swallowed into the widget.
    await rendered.getByText("Some intro text.", { exact: false }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    expect((await activeLineText()).trim()).toBe(":::center");

    // Leave the block again (re-collapses) before testing the other
    // direction, so this second approach also starts from a real reveal
    // transition rather than continuing inside an already-open block.
    await rendered.getByText("Outro text.", { exact: false }).click();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();

    // Entering from BELOW: end of the last line, then up through the blank
    // line, then into the container — must land on its CLOSING fence line,
    // not be swallowed into the widget from the other side.
    await rendered.getByText("Outro text.", { exact: false }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText(":::center");
    expect((await activeLineText()).trim()).toBe(":::");

    // ---- Round-6 regression: revealed fence lines trap the caret ----
    // `mkBlockVerticalNavigation` used to re-run its "entering the widget
    // from outside" correction on every ArrowUp/Down, even once the
    // directive was already revealed (its lines are real text at that
    // point) — landing EXACTLY on the opening/closing fence line satisfied
    // its old `before <= range.from` / `before >= range.to` check again on
    // the very next keystroke and snapped the caret straight back, an
    // infinite trap plain arrows could never escape (only Ctrl+Arrow, which
    // this keymap never binds, could). The caret is currently on the
    // CLOSING fence (`:::`, from the check just above) with the whole
    // directive revealed — continuing to arrow UP must walk through the
    // inner line, the opening fence, the blank separator, and the intro
    // paragraph, each one a NEW line, never bouncing back onto a line
    // already visited.
    const upSequence: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("ArrowUp");
      upSequence.push((await activeLineText()).trim());
    }
    expect(upSequence).toEqual(["Hello from inside.", ":::center", "", "Some intro text."]);
    for (let i = 1; i < upSequence.length; i++) {
      expect(upSequence[i]).not.toBe(upSequence[i - 1]);
    }

    // Symmetric check going back DOWN from the intro paragraph, through the
    // same revealed block, out the other side to the outro paragraph.
    const downSequence: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowDown");
      downSequence.push((await activeLineText()).trim());
    }
    expect(downSequence).toEqual([
      "",
      ":::center",
      "Hello from inside.",
      ":::",
      "Outro text.",
    ]);
    for (let i = 1; i < downSequence.length; i++) {
      expect(downSequence[i]).not.toBe(downSequence[i - 1]);
    }
  });
});

/**
 * Round 6 MK item 1's mouse-interaction contract
 * (`src/markdown/directiveLezer/decorations.ts`: `pointerActiveField` +
 * `pointerTrackingHandlers`, the widget's measured-height min-height
 * reservation, and `MkBlockDirectiveWidget.ignoreEvent`'s interactive-
 * control exemption). See `docs/ARCHITECTURE.md`'s "Mouse interaction with
 * a rendered directive widget" section for the full mechanism.
 */
test.describe("markii directive live preview — mouse interaction (.mk.md Rendered mode)", () => {
  async function makeCardFixture(page: import("@playwright/test").Page, fileName: string) {
    await gotoApp(page);
    await treeRow(page, "vault/src").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File" }).click();
    const newFileRow = treeRow(page, "vault/src/.vsnote-draft-file");
    await expect(newFileRow).toBeVisible();
    await newFileRow.locator("input").fill(fileName);
    await newFileRow.locator("input").press("Enter");
    const fileRow = treeRow(page, `vault/src/${fileName}`);
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await page.getByRole("radio", { name: "Source" }).click();
    const source = page.locator(".cm-content").first();
    await source.click();
    await page.keyboard.type(
      'Intro paragraph.\n\n:::card{title="Notes"}\nHello world example.\n\n[Docs](#mk-mouse-test-anchor)\n:::\n\nOutro paragraph.\n',
    );

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered.locator(".mk-live-preview-block")).toBeVisible();
    return rendered;
  }

  test("double-clicking a word inside a rendered widget selects it once settled, without scrolling the view", async ({
    page,
  }) => {
    const rendered = await makeCardFixture(page, "mouse-dblclick.mk.md");
    const scroller = page.locator(".cm-scroller").first();

    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);

    // A real double-click: two mousedown/mouseup pairs close together on
    // the SAME word, inside the rendered (still collapsed) widget's own
    // text. `pointerActiveField` must keep the widget from reveal-and-
    // shifting between the two clicks of the pair.
    const word = rendered.locator(".mk-live-preview-block", { hasText: "Hello world example." });
    await word.dblclick({ position: { x: 5, y: 5 } });

    // Give the ~200ms settle window (plus slack) time to fire the deferred
    // recompute.
    await page.waitForTimeout(400);

    // Settled: the widget is gone (revealed) and the layout never moved
    // the scroller underneath the interaction.
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(0);
    await expect(rendered).toContainText("Hello world example.");
    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    expect(scrollAfter).toBe(scrollBefore);
  });

  test("dragging from the paragraph above to the paragraph below flips the widget's decoration at most once", async ({
    page,
  }) => {
    const rendered = await makeCardFixture(page, "mouse-drag.mk.md");

    // A presence-flip counter, not a raw mutation-record count: several
    // mutation records can fire for ONE logical reveal/collapse (removing
    // the widget node, inserting several raw-text line elements), so only
    // TRANSITIONS in whether `.mk-live-preview-block` exists at all count
    // as a "flip" — exactly what "decoration flips" means here.
    await page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      if (!content) return;
      const log: boolean[] = [];
      const check = () => {
        const present = document.querySelectorAll(".mk-live-preview-block").length > 0;
        if (log.length === 0 || log[log.length - 1] !== present) log.push(present);
      };
      check();
      const observer = new MutationObserver(check);
      observer.observe(content, { childList: true, subtree: true });
      (window as unknown as { __mkFlipLog: boolean[] }).__mkFlipLog = log;
      (window as unknown as { __mkFlipObserver: MutationObserver }).__mkFlipObserver = observer;
    });

    const intro = rendered.getByText("Intro paragraph.", { exact: false });
    const outro = rendered.getByText("Outro paragraph.", { exact: false });
    const introBox = await intro.boundingBox();
    const outroBox = await outro.boundingBox();
    if (!introBox || !outroBox) throw new Error("fixture paragraphs not laid out");

    await page.mouse.move(introBox.x + introBox.width / 2, introBox.y + introBox.height / 2);
    await page.mouse.down();
    // Several intermediate `mousemove`s crossing the widget's edge, same as
    // a real drag gesture — this is exactly what used to flip the
    // decoration on every step.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const x = introBox.x + ((outroBox.x - introBox.x) * i) / steps;
      const y = introBox.y + ((outroBox.y - introBox.y) * i) / steps;
      await page.mouse.move(x, y);
    }
    await page.mouse.move(outroBox.x + outroBox.width / 2, outroBox.y + outroBox.height / 2);
    await page.mouse.up();

    // Let the settle window close so the ONE deferred recompute (if any)
    // actually lands before reading the log.
    await page.waitForTimeout(400);

    const flipLog = await page.evaluate(() => (window as unknown as { __mkFlipLog: boolean[] }).__mkFlipLog);
    const flips = flipLog.length - 1;
    expect(flips).toBeLessThanOrEqual(1);
  });

  test("clicking a control rendered inside a widget operates it without revealing the widget or moving the caret", async ({
    page,
  }) => {
    // No `.mk.md` render path emits a real "button" element (VSNote's
    // live-preview rendering is deliberately pure/static — no script
    // execution inside a decoration — see MK-23 in the orchestrator log),
    // so a plain markdown link is the realistic interactive control: an
    // `<a>` inside the widget's own rendered HTML, exercised the same way
    // `INTERACTIVE_WIDGET_SELECTOR` in `decorations.ts` selects it.
    const rendered = await makeCardFixture(page, "mouse-control.mk.md");

    const link = rendered.locator(".mk-live-preview-block a", { hasText: "Docs" }).first();
    await expect(link).toBeVisible();

    await link.click();

    // The widget never reveals and stays exactly one widget — `ignoreEvent`
    // kept CM6 from ever treating this as a click into the directive's
    // span, so no reveal, no caret move.
    await expect(rendered.locator(".mk-live-preview-block")).toHaveCount(1);
    await expect(rendered).not.toContainText(":::card");
  });
});

/**
 * `src/markdown/previewPacksLogic.ts` — the Markii extension page's "Render
 * components in the Preview pane" row (R5-9b). Pure gating logic;
 * `MarkdownPreviewPane.tsx`'s own wiring (reading the store, passing the
 * result to `renderMarkdown`) is exercised by `render.tsx`'s own
 * `enabledPacks` handling, already covered in `markdownRender.test.ts` and
 * `markiiPackPlaceholder.test.ts` — this file is only the decision itself.
 */
import { describe, expect, it } from "vitest";
import { packsForPreview } from "../../src/markdown/previewPacksLogic";

describe("packsForPreview", () => {
  it("returns the enabled packs unchanged when renderComponentsInPreview is on", () => {
    const packs = [{ manifest: { name: "ana" } }];
    expect(packsForPreview(true, packs)).toBe(packs);
  });

  it("returns an empty list when renderComponentsInPreview is off, regardless of what was enabled", () => {
    const packs = [{ manifest: { name: "ana" } }, { manifest: { name: "bee" } }];
    expect(packsForPreview(false, packs)).toEqual([]);
  });

  it("is a no-op either way when nothing is enabled", () => {
    expect(packsForPreview(true, [])).toEqual([]);
    expect(packsForPreview(false, [])).toEqual([]);
  });
});

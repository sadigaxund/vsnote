/**
 * R3-12: unit coverage for `src/editor/markiiCompletion.ts`'s two gaps in
 * Rendered-mode editor sugar for `.mk.md`:
 *
 * - `manualContainerOpenFenceEdits` — the manual-typing counterpart to
 *   vendored `fenceExtensionEdits` (see that export's own doc comment for
 *   why a separate function was needed: `fenceExtensionEdits` only
 *   recognizes a COMPLETE skeleton insertion, opening fence through
 *   closing fence, which a hand-typed opening line doesn't have yet).
 * - the completion-trigger threshold (item (c) of the ticket): confirming
 *   `completionAt` already offers items at the LATEST on the second colon,
 *   not only after a full third colon.
 *
 * Pure-function tests only — no CM6 `EditorView` involved, matching
 * `markiiHostVendor.test.ts`'s own style.
 */
import { describe, expect, it } from "vitest";
import { manualContainerOpenFenceEdits } from "../../src/editor/markiiCompletion";
import { buildComponentCatalog, completionAt } from "../../src/markdown/vendor/markiiHost";

describe("manualContainerOpenFenceEdits", () => {
  it("lengthens a 2-deep nesting: :::note hand-typed inside :::center/::: becomes ::::center/::::", () => {
    const doc = [":::center", "", ":::"].join("\n");
    // The author has just typed line 1 ("") -> ":::note" and is about to
    // press Enter; line 1 is the line the cursor is leaving.
    const withOpen = [":::center", ":::note", "", ":::"].join("\n");
    const edits = manualContainerOpenFenceEdits(withOpen, 1);
    expect(edits).toEqual([
      { line: 0, column: 0, oldText: ":::", newText: "::::" },
      { line: 3, column: 0, oldText: ":::", newText: "::::" },
    ]);
    void doc;
  });

  it("lengthens transitively through a 3-deep nesting", () => {
    // Pre-existing valid 2-level nesting: ::::outer(4) > :::middle(3).
    // Hand-typing a 3rd level (":::inner", 3 colons) inside middle first
    // forces middle to 4 (max(3, 3+1)) — which now COLLIDES with outer's
    // existing 4, so outer must grow too, to 5, propagating the change
    // one level further out than the line that was actually typed.
    const doc = ["::::outer", ":::middle", ":::inner", "", ":::", "::::"].join("\n");
    const edits = manualContainerOpenFenceEdits(doc, 2);
    expect(edits).toEqual([
      { line: 0, column: 0, oldText: "::::", newText: ":::::" },
      { line: 1, column: 0, oldText: ":::", newText: "::::" },
      { line: 4, column: 0, oldText: ":::", newText: "::::" },
      { line: 5, column: 0, oldText: "::::", newText: ":::::" },
    ]);
  });

  it("is a no-op when typing inside an already-longer outer pair", () => {
    const doc = ["::::center", ":::note", "", "::::"].join("\n");
    expect(manualContainerOpenFenceEdits(doc, 1)).toEqual([]);
  });

  it("is a no-op for a bare closing fence line (no directive name)", () => {
    const doc = [":::center", "hello", ":::"].join("\n");
    expect(manualContainerOpenFenceEdits(doc, 2)).toEqual([]);
  });

  it("is a no-op for an ordinary (non-fence) line", () => {
    const doc = [":::center", "just some prose", ":::"].join("\n");
    expect(manualContainerOpenFenceEdits(doc, 1)).toEqual([]);
  });

  it("never touches a fenced code block, even when its contents look like a container opener", () => {
    const doc = [":::center", "```", ":::note", "```", ":::"].join("\n");
    expect(manualContainerOpenFenceEdits(doc, 2)).toEqual([]);
  });

  it("is a no-op at top level (no enclosing container at all)", () => {
    const doc = [":::note", "", ":::"].join("\n");
    expect(manualContainerOpenFenceEdits(doc, 0)).toEqual([]);
  });
});

describe("completion trigger threshold (ticket item c)", () => {
  const catalog = buildComponentCatalog();

  it("offers nothing at a single ':' with no name typed yet", () => {
    const ctx = completionAt(":", 1, catalog);
    expect(ctx.kind).toBe("none");
  });

  it("offers leaf-kind components at '::' (second colon), before any name is typed", () => {
    const ctx = completionAt("::", 2, catalog);
    expect(ctx.kind).toBe("directive-name");
    expect(ctx.items.length).toBeGreaterThan(0);
    // "rating" is a leaf-kind standard component (@markii/stdlib) — "::"
    // is the "leaf" form, so only leaf-kind components should be offered.
    expect(ctx.items.some((item) => item.label === "rating")).toBe(true);
  });
});

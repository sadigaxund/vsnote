/**
 * Smoke test for the vendored `@markii/host` pure functions
 * (`src/markdown/vendor/markiiHost/`, MIT-licensed from markii-org/markii
 * v0.13.0 — that package is `private: true` upstream and never published to
 * npm, so this repo copies the pure logic rather than importing it; see
 * that directory's file headers). Not a re-test of upstream's own
 * exhaustive test suite (out of scope, and would duplicate work already
 * done there) — just proof the trimmed vendor wires together correctly
 * against a REAL `@markii/stdlib` install: catalog build, completion,
 * hover, and fence-extension all produce sane output.
 */
import { describe, expect, it } from "vitest";
import {
  buildComponentCatalog,
  completionAt,
  componentSkeleton,
  enclosingContainerFences,
  fenceExtensionEdits,
  hoverAt,
} from "../../src/markdown/vendor/markiiHost";

describe("buildComponentCatalog", () => {
  it("builds a non-empty, standard-only catalog from @markii/stdlib", () => {
    const catalog = buildComponentCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((c) => c.source === "standard")).toBe(true);
    expect(catalog.some((c) => c.directiveName === "callout")).toBe(true);
  });
});

describe("completionAt / hoverAt", () => {
  const catalog = buildComponentCatalog();

  it("completes a directive name being typed as a container directive (callout is container-kind)", () => {
    const ctx = completionAt(":::call", 7, catalog);
    expect(ctx.kind).toBe("directive-name");
    expect(ctx.items.some((item) => item.label === "callout")).toBe(true);
  });

  it("returns a 'none' context on an ordinary line of prose", () => {
    const ctx = completionAt("just some text", 5, catalog);
    expect(ctx.kind).toBe("none");
    expect(ctx.items).toEqual([]);
  });

  it("hovers a known directive name and returns its documentation", () => {
    const info = hoverAt("::callout{type=warning}", 4, catalog);
    expect(info?.directiveName).toBe("callout");
    expect(info?.documentation.summary.length).toBeGreaterThan(0);
  });

  it("returns undefined hovering plain text", () => {
    expect(hoverAt("nothing directive-shaped here", 3, catalog)).toBeUndefined();
  });
});

describe("componentSkeleton", () => {
  it("builds a container skeleton with no attribute clause at all when nothing is required", () => {
    // Round-6 fix: upstream's `{}` here was pointless noise (the same
    // reasoning its own module doc already gives for why the `inline` form
    // omits it) — see `componentSkeleton.ts`'s header for the logged
    // upstream finding.
    const skeleton = componentSkeleton("center", "container", []);
    expect(skeleton.text).toBe(":::center\n\n:::");
    expect(skeleton.cursorOffset).toBe(":::center\n".length);
  });

  it("builds a leaf skeleton with no attribute clause at all when nothing is required", () => {
    const skeleton = componentSkeleton("divider", "leaf", []);
    expect(skeleton.text).toBe("::divider");
    expect(skeleton.cursorOffset).toBe(skeleton.text.length);
  });
});

describe("fence lengthening", () => {
  it("finds no enclosing fences in a flat document", () => {
    expect(enclosingContainerFences("hello\nworld", 0)).toEqual([]);
  });

  it("lengthens an enclosing pair when inserting a same-or-longer container inside it", () => {
    const doc = [":::outer{}", "", ":::"].join("\n");
    // Insertion line 1 (the blank line) inside the single `:::outer` pair —
    // inserting another 3-colon container here needs the outer fence
    // lengthened to 4 colons to nest legally.
    const edits = fenceExtensionEdits(doc, 1, ":::inner{}\n\n:::");
    expect(edits.length).toBe(2);
    expect(edits[0]).toMatchObject({ oldText: ":::", newText: "::::" });
  });
});

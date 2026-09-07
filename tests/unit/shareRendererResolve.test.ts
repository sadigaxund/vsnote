/**
 * feat(share) R6 — `share/shareRendererResolve.ts`'s kind -> renderer
 * resolution (the fix for the reader's old hardcoded isMarkdown/isHtml/
 * isCode dispatch) and the Rendered/Source toggle eligibility rule.
 */
import { describe, expect, it } from "vitest";
import { resolveShareRenderer, shareSupportsSourceToggle } from "../../src/share/shareRendererResolve";

describe("resolveShareRenderer", () => {
  it("resolves each hand-written kind to its registry renderer", () => {
    expect(resolveShareRenderer("md")).toBe("livepreview");
    expect(resolveShareRenderer("mkmd")).toBe("livepreview");
    expect(resolveShareRenderer("html")).toBe("html");
    expect(resolveShareRenderer("csv")).toBe("csv");
    expect(resolveShareRenderer("json")).toBe("json");
    expect(resolveShareRenderer("image")).toBe("image");
  });

  it("resolves every code kind (ts/tsx/js/jsx/css/code) to the code renderer", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css", "code"] as const) {
      expect(resolveShareRenderer(kind)).toBe("code");
    }
  });

  it("falls back to the code renderer for an unrecognized/unmodeled kind or undefined", () => {
    expect(resolveShareRenderer("unknown")).toBe("code");
    expect(resolveShareRenderer(undefined)).toBe("code");
  });
});

describe("shareSupportsSourceToggle", () => {
  it("is true only for html/csv/json", () => {
    expect(shareSupportsSourceToggle("html")).toBe(true);
    expect(shareSupportsSourceToggle("csv")).toBe(true);
    expect(shareSupportsSourceToggle("json")).toBe(true);
  });

  it("is false for markdown (livepreview) and code — each has only ONE meaningful view", () => {
    expect(shareSupportsSourceToggle("livepreview")).toBe(false);
    expect(shareSupportsSourceToggle("code")).toBe(false);
    expect(shareSupportsSourceToggle("image")).toBe(false);
  });
});

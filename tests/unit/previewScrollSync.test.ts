/**
 * Pins the pure proportional scroll-position math behind the Preview
 * pane's scroll sync (R3-11) — `src/markdown/previewScrollSync.ts`. See
 * that file's module doc for why this is a fraction mapping, not a
 * pixel/line mapping: the two panes (raw source text vs. rendered
 * `.mk-doc`) never share a coordinate system.
 */
import { describe, expect, it } from "vitest";
import { scrollFraction, scrollTopForFraction } from "../../src/markdown/previewScrollSync";

describe("scrollFraction", () => {
  it("is 0 at the top", () => {
    expect(scrollFraction({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 })).toBe(0);
  });

  it("is 1 at the bottom", () => {
    expect(scrollFraction({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(1);
  });

  it("is 0.5 halfway down the scrollable range", () => {
    expect(scrollFraction({ scrollTop: 400, scrollHeight: 1000, clientHeight: 200 })).toBeCloseTo(0.5);
  });

  it("is 0 when the content fits entirely (no scroll range)", () => {
    expect(scrollFraction({ scrollTop: 0, scrollHeight: 150, clientHeight: 200 })).toBe(0);
  });

  it("is 0 when scrollHeight equals clientHeight exactly (zero range, not negative)", () => {
    expect(scrollFraction({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toBe(0);
  });

  it("clamps a scrollTop past the max range (can happen transiently during a resize) to 1", () => {
    expect(scrollFraction({ scrollTop: 5000, scrollHeight: 1000, clientHeight: 200 })).toBe(1);
  });
});

describe("scrollTopForFraction", () => {
  it("is 0 for fraction 0", () => {
    expect(scrollTopForFraction(0, { scrollHeight: 1000, clientHeight: 200 })).toBe(0);
  });

  it("is the max scrollTop for fraction 1", () => {
    expect(scrollTopForFraction(1, { scrollHeight: 1000, clientHeight: 200 })).toBe(800);
  });

  it("is 0 when the target has no scroll range at all", () => {
    expect(scrollTopForFraction(0.7, { scrollHeight: 150, clientHeight: 200 })).toBe(0);
  });

  it("clamps an out-of-range fraction into [0, 1]", () => {
    expect(scrollTopForFraction(-0.5, { scrollHeight: 1000, clientHeight: 200 })).toBe(0);
    expect(scrollTopForFraction(1.5, { scrollHeight: 1000, clientHeight: 200 })).toBe(800);
  });

  it("round-trips through scrollFraction for an arbitrary box", () => {
    const box = { scrollHeight: 2400, clientHeight: 600 };
    const fraction = 0.37;
    const top = scrollTopForFraction(fraction, box);
    expect(scrollFraction({ scrollTop: top, ...box })).toBeCloseTo(fraction, 5);
  });

  it("maps a fraction from one box's range onto a DIFFERENT box's own range (the actual cross-pane use case)", () => {
    // Source scrolled 50% down a 2000px document viewed through a 500px
    // viewport; the preview's rendered document is a totally different
    // height (directives take more/less room than their raw source).
    const sourceFraction = scrollFraction({ scrollTop: 750, scrollHeight: 2000, clientHeight: 500 });
    const previewTop = scrollTopForFraction(sourceFraction, { scrollHeight: 900, clientHeight: 300 });
    expect(previewTop).toBeCloseTo(300); // 50% of (900 - 300)
  });
});

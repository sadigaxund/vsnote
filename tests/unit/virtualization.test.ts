/**
 * Pins `lib/virtualization.ts`'s `computeVirtualWindow` — the pure
 * fixed-row-height windowing math `components/local/VirtualList.tsx` uses
 * (Phase 17 Milestone D, docs/COMPONENT-BACKLOG.md row 25).
 */
import { describe, expect, it } from "vitest";
import { computeVirtualWindow, DEFAULT_OVERSCAN } from "../../src/lib/virtualization";

describe("computeVirtualWindow", () => {
  it("at scrollTop 0, windows the first viewport's worth of rows plus trailing overscan", () => {
    // 24px rows, a 240px viewport (10 visible rows), 300 total rows.
    const { startIndex, endIndex } = computeVirtualWindow(0, 240, 24, 300, 4);
    expect(startIndex).toBe(0); // clamped — can't overscan above the top
    expect(endIndex).toBe(14); // 10 visible + 4 trailing overscan
  });

  it("scrolled into the middle, windows both leading and trailing overscan", () => {
    // scrollTop 240 = 10 rows scrolled past; same 10-visible viewport.
    const { startIndex, endIndex } = computeVirtualWindow(240, 240, 24, 300, 4);
    expect(startIndex).toBe(6); // 10 - 4 leading overscan
    expect(endIndex).toBe(24); // 20 + 4 trailing overscan
  });

  it("scrolled to the very bottom, clamps endIndex to totalRows", () => {
    const { startIndex, endIndex } = computeVirtualWindow(60 * 24, 240, 24, 70, 4);
    expect(endIndex).toBe(70); // never past the last real row
    expect(startIndex).toBeLessThan(endIndex);
  });

  it("the windowed row count stays small and bounded regardless of totalRows", () => {
    const small = computeVirtualWindow(0, 240, 24, 300, 4);
    const huge = computeVirtualWindow(0, 240, 24, 50_000, 4);
    expect(small.endIndex - small.startIndex).toBe(huge.endIndex - huge.startIndex);
    expect(huge.endIndex - huge.startIndex).toBeLessThan(20);
  });

  it("defaults overscan to DEFAULT_OVERSCAN when omitted", () => {
    const explicit = computeVirtualWindow(0, 240, 24, 300, DEFAULT_OVERSCAN);
    const implicit = computeVirtualWindow(0, 240, 24, 300);
    expect(implicit).toEqual(explicit);
  });

  it("returns an empty window for zero rows or a zero/negative row height", () => {
    expect(computeVirtualWindow(0, 240, 24, 0)).toEqual({ startIndex: 0, endIndex: 0 });
    expect(computeVirtualWindow(0, 240, 0, 300)).toEqual({ startIndex: 0, endIndex: 0 });
  });
});

/**
 * `lib/accentContrast.ts` — round 6 item 17's contrast-safe accent math.
 */
import { describe, expect, it } from "vitest";
import {
  ACCENT_MIN_CONTRAST,
  contrastRatio,
  ensureReadableOn,
  parseCssColor,
  readableForeground,
  relativeLuminance,
} from "../../src/lib/accentContrast";

const VSNOTE_BG = "#0e1015";

describe("parseCssColor()", () => {
  it("parses #rrggbb, #rgb, and rgb() forms", () => {
    expect(parseCssColor("#27d2c5")).toEqual([0x27, 0xd2, 0xc5]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255]);
    expect(parseCssColor("rgb(14, 16, 21)")).toEqual([14, 16, 21]);
  });

  it("returns null for notations it does not cover", () => {
    expect(parseCssColor("oklch(0.7 0.1 180)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("contrast math", () => {
  it("white on black is the 21:1 maximum", () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 1);
  });

  it("relative luminance orders dark < light", () => {
    expect(relativeLuminance([0, 0, 0])).toBeLessThan(relativeLuminance([128, 128, 128]));
    expect(relativeLuminance([128, 128, 128])).toBeLessThan(relativeLuminance([255, 255, 255]));
  });
});

describe("ensureReadableOn()", () => {
  it("passes an already-readable accent through byte-identical (default teal)", () => {
    expect(ensureReadableOn("#27d2c5", VSNOTE_BG)).toBe("#27d2c5");
  });

  it("lightens a near-black accent until it reads on the dark theme", () => {
    const adjusted = ensureReadableOn("#151515", VSNOTE_BG);
    expect(adjusted).not.toBe("#151515");
    expect(contrastRatio(parseCssColor(adjusted)!, parseCssColor(VSNOTE_BG)!)).toBeGreaterThanOrEqual(
      ACCENT_MIN_CONTRAST,
    );
  });

  it("keeps the hue: a dark red adjusts to a lighter RED, not gray", () => {
    const adjusted = parseCssColor(ensureReadableOn("#5c0a0a", VSNOTE_BG))!;
    const [r, g, b] = adjusted;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("darkens instead when the background is light", () => {
    const adjusted = ensureReadableOn("#f2f2c0", "#ffffff");
    expect(contrastRatio(parseCssColor(adjusted)!, [255, 255, 255])).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
    expect(relativeLuminance(parseCssColor(adjusted)!)).toBeLessThan(relativeLuminance(parseCssColor("#f2f2c0")!));
  });

  it("leaves unparseable inputs untouched rather than guessing", () => {
    expect(ensureReadableOn("#27d2c5", "oklch(0.2 0 0)")).toBe("#27d2c5");
    expect(ensureReadableOn("not-a-color", VSNOTE_BG)).toBe("not-a-color");
  });
});

describe("readableForeground()", () => {
  it("dark text on the light default teal, white text on a dark accent", () => {
    expect(readableForeground("#27d2c5")).toBe("#0a0c10");
    expect(readableForeground("#123055")).toBe("#ffffff");
  });
});

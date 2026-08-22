/**
 * Contrast-safe accent derivation — round 6 item 17; TODO §8.x migrated the
 * lightness walk from HSL to **OKLCH** (user decision 2026-08-22). The
 * accent picker accepts ANY color (the range is deliberately never
 * limited); what the UI actually paints is a derived pair:
 *
 *  - `primary`: the user's accent, LIGHTNESS-adjusted in OKLCH only as far
 *    as needed to reach WCAG AA (4.5:1) against the current theme's
 *    `--color-bg`, so a near-black accent on the near-black VSNote theme
 *    still reads as a color rather than vanishing. An accent that is
 *    already readable passes through byte-identical. OKLCH perceptual
 *    uniformity means equal L steps move every hue by roughly the same
 *    perceived amount, where HSL overshoots blues and undershoots yellows.
 *  - `primaryFg`: black or white, whichever contrasts more with the
 *    (derived) primary — text/icons ON accent-filled surfaces.
 *
 * Pure math, unit-tested in `tests/unit/accentContrast.test.ts`;
 * `useSettingsStore.ts`'s `applyDomSettings` is the one DOM consumer.
 * Out-of-gamut results from extreme chroma are handled by simple channel
 * clamping after conversion — a lightness-only walk stays inside gamut for
 * all but pathological inputs.
 */

export type Rgb = [number, number, number];

/** Parses `#rgb`, `#rrggbb`, and `rgb(a)(r, g, b)` strings; null for
 * anything else (a library theme may define `--color-bg` in a notation we
 * don't cover — callers fall back to the VSNote default then). */
export function parseCssColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (hex3) return [parseInt(hex3[1] + hex3[1], 16), parseInt(hex3[2] + hex3[2], 16), parseInt(hex3[3] + hex3[3], 16)];
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(v);
  if (hex6) return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- sRGB <-> OKLCH (Björn Ottosson's OKLab, D65) ---------------------

const srgbToLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (x: number): number =>
  (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255;

export interface Oklch {
  /** Perceived lightness, 0..1. */
  l: number;
  /** Chroma, >= 0. */
  c: number;
  /** Hue in radians. */
  h: number;
}

function linearRgbToOklch([lr, lg, lb]: [number, number, number]): Oklch {
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const A = Math.cos(h) * c;
  const B = Math.sin(h) * c;
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function rgbToOklch(rgb: Rgb): Oklch {
  return linearRgbToOklch([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]);
}

function oklchToRgb(oklch: Oklch): Rgb {
  const [lr, lg, lb] = oklchToLinearRgb(oklch);
  // Channel clamp: lightness-only walks stay in gamut except at extremes.
  return [
    Math.min(255, Math.max(0, linearToSrgb(lr))),
    Math.min(255, Math.max(0, linearToSrgb(lg))),
    Math.min(255, Math.max(0, linearToSrgb(lb))),
  ];
}

export const ACCENT_MIN_CONTRAST = 4.5;

/** Round 7 item 47 — accent-tinted TEXT (markdown headings, links) gets a
 * stricter floor than accent-filled chrome: 4.5:1 keeps a control visible,
 * but body-adjacent text at that ratio on the near-black theme reads muddy.
 * 7:1 (WCAG AAA) is the text tier. */
export const ACCENT_TEXT_MIN_CONTRAST = 7;

/** Returns `accent` unchanged when it already reaches `min` contrast on
 * `bg`; otherwise walks its OKLCH lightness AWAY from the background's side
 * (dark bg -> lighter accent, light bg -> darker) in small perceptual steps
 * until it does. Chroma and hue are never touched, so the adjusted color
 * still reads as "the color the user picked" — and because OKLCH is
 * perceptually uniform, every hue travels the same visual distance per
 * step (HSL overshot blues and undershot yellows). */
export function ensureReadableOn(accentHex: string, bgHex: string, min = ACCENT_MIN_CONTRAST): string {
  const accent = parseCssColor(accentHex);
  const bg = parseCssColor(bgHex);
  if (!accent || !bg) return accentHex;
  if (contrastRatio(accent, bg) >= min) return accentHex;
  const darkBg = relativeLuminance(bg) < 0.5;
  const ok = rgbToOklch(accent);
  let candidate = accent;
  for (let step = 1; step <= 40; step++) {
    const nextL = darkBg ? Math.min(1, ok.l + step * 0.02) : Math.max(0, ok.l - step * 0.02);
    candidate = oklchToRgb({ ...ok, l: nextL });
    if (contrastRatio(candidate, bg) >= min) break;
  }
  return toHex(candidate);
}

/** Black-or-white foreground for text/icons ON an accent-filled surface —
 * whichever side actually contrasts more. */
export function readableForeground(accentHex: string): string {
  const accent = parseCssColor(accentHex);
  if (!accent) return "#ffffff";
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [10, 12, 16];
  return contrastRatio(accent, white) >= contrastRatio(accent, black) ? "#ffffff" : "#0a0c10";
}

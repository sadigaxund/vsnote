/**
 * Contrast-safe accent derivation — round 6 item 17. The accent picker
 * accepts ANY color (the range is deliberately never limited); what the UI
 * actually paints is a derived pair:
 *
 *  - `primary`: the user's accent, lightness-adjusted (in HSL, hue and
 *    saturation untouched) only as far as needed to reach WCAG AA (4.5:1)
 *    contrast against the current theme's `--color-bg`, so a near-black
 *    accent on the near-black VSNote theme still reads as a color rather
 *    than vanishing. An accent that is already readable passes through
 *    byte-identical.
 *  - `primaryFg`: black or white, whichever contrasts more with the
 *    (derived) primary — text/icons ON accent-filled surfaces.
 *
 * Pure math, unit-tested in `tests/unit/accentContrast.test.ts`;
 * `useSettingsStore.ts`'s `applyDomSettings` is the one DOM consumer.
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

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

export const ACCENT_MIN_CONTRAST = 4.5;

/** Returns `accent` unchanged when it already reaches `min` contrast on
 * `bg`; otherwise walks its HSL lightness AWAY from the background's side
 * (dark bg -> lighter accent, light bg -> darker) in small steps until it
 * does. Hue/saturation are never touched, so the adjusted color still
 * reads as "the color the user picked". */
export function ensureReadableOn(accentHex: string, bgHex: string, min = ACCENT_MIN_CONTRAST): string {
  const accent = parseCssColor(accentHex);
  const bg = parseCssColor(bgHex);
  if (!accent || !bg) return accentHex;
  if (contrastRatio(accent, bg) >= min) return accentHex;
  const darkBg = relativeLuminance(bg) < 0.5;
  const [h, s, l] = rgbToHsl(accent);
  let candidate = accent;
  for (let step = 1; step <= 40; step++) {
    const nextL = darkBg ? Math.min(1, l + step * 0.02) : Math.max(0, l - step * 0.02);
    candidate = hslToRgb([h, s, nextL]);
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

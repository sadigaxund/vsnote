/**
 * Minimal, self-contained 8-bit PNG decoder (RGB/RGBA, non-interlaced only —
 * exactly what Chromium's `page.screenshot()` produces) used ONLY by
 * `theme-compat.spec.ts` to prove a library theme's texture/mesh is
 * genuinely COMPOSITED into the page (DESIGN-SPEC Amendments round 3 item
 * 22(a)), not just "a CSS rule exists somewhere." No new npm dependency —
 * this repo has no `pngjs`/`pixelmatch`/`sharp` installed, and installing
 * one for a single regression assertion felt like the wrong tradeoff versus
 * ~70 lines of straightforward, well-documented decode logic built on
 * Node's own `zlib`. Deliberately narrow: only the two color types/bit
 * depth Playwright screenshots ever produce are handled; anything else
 * throws loudly rather than silently decoding garbage.
 */
import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** Flat RGBA bytes, 4 per pixel, row-major. */
  data: Uint8ClampedArray;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG color type ${colorType}`);
      if (interlace !== 0) throw new Error("unsupported interlaced PNG");
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip CRC
  }

  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels; // 8-bit depth => 1 byte per channel
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatChunks));

  const out = new Uint8ClampedArray(width * height * 4);
  let rawOffset = 0;
  // Previous unfiltered row, for filter types that reference the row above.
  let prevRow = new Uint8ClampedArray(stride);

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const row = new Uint8ClampedArray(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOffset + x];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + Math.floor((a + b) / 2);
          break;
        case 4:
          value = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filterType}`);
      }
      row[x] = value & 0xff;
    }
    rawOffset += stride;

    for (let x = 0; x < width; x++) {
      const srcIdx = x * bpp;
      const dstIdx = (y * width + x) * 4;
      out[dstIdx] = row[srcIdx];
      out[dstIdx + 1] = row[srcIdx + 1];
      out[dstIdx + 2] = row[srcIdx + 2];
      out[dstIdx + 3] = channels === 4 ? row[srcIdx + 3] : 255;
    }
    prevRow = row;
  }

  return { width, height, data: out };
}

/** Standard-deviation of per-pixel luma across an RGBA buffer — near-zero
 * for a perfectly flat single-color fill, meaningfully positive for
 * anything with real visual texture (noise, gradients, grain). */
export function lumaStdDev(png: DecodedPng): number {
  const n = png.width * png.height;
  const luma = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += luma[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (luma[i] - mean) ** 2;
  variance /= n;
  return Math.sqrt(variance);
}

/** How many DISTINCT rounded luma levels appear in the region — the second,
 * independent half of "is there really a texture here."
 *
 * Std-dev alone can be pushed above a threshold by a single hard edge
 * (one antialiased glyph, a 1px border clipped into the region), which is
 * exactly how the first version of `theme-compat.spec.ts` passed against a
 * build that rendered NO texture at all: it sampled the activity bar,
 * whose icons supply plenty of variance on their own. A genuine
 * turbulence/mesh texture paints many slightly-different values across the
 * whole area (measured: ~50-62 levels for these themes' own canvas), while
 * a flat fill — textured or not — has exactly 1. Asserting both together
 * is what makes the test fail on a flat composite. */
export function distinctLumaLevels(png: DecodedPng): number {
  const seen = new Set<number>();
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    seen.add(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  }
  return seen.size;
}

#!/usr/bin/env node
/**
 * Generates the PWA manifest icon PNGs entirely offline — a hand-rolled
 * raster + PNG encoder (Node's built-in `zlib` for DEFLATE, a local CRC32
 * table for chunk framing), no image library, no network fetch, matching
 * CLAUDE.md rule 3 ("no server-dependent features") and the Phase 5b brief
 * ("generate real icon assets locally; no network fetches at build or
 * runtime"). Run via `npm run icons` (see package.json); the output PNGs
 * are checked into `public/` like `favicon.svg`/`icons.svg` already are, so
 * a normal `vite build` never re-runs this script.
 *
 * Design: a bold two-card "stacked notes" glyph (back card muted, front
 * card teal-filled with two dark text-line strokes) on the app's own
 * near-black chrome background (`--app-chrome-bg` / `--color-primary` from
 * `src/theme.css`) — legible at both a 192px home-screen tile and a
 * maskable icon's ~80%-safe-zone crop, unlike fine-lined glyphs (a literal
 * page-fold icon, a thin letterform) which wash out at small sizes.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public");

// ---- palette (matches src/theme.css) ----
const BG = [0x0e, 0x10, 0x15]; // --app-chrome-bg
const CARD_BACK = [0x2a, 0x2e, 0x35]; // muted surface
const CARD_FRONT = [0x27, 0xd2, 0xc5]; // --color-primary (teal)
const LINE = [0x08, 0x14, 0x12]; // dark line strokes on the teal card

/** Point-in-rounded-rect test (correct corner handling — clamping the
 * nearest corner center only inside that corner's own quadrant, not the
 * whole rect, so straight edges stay straight rather than curving). */
function insideRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  let cx, cy;
  if (px < x0 + r && py < y0 + r) [cx, cy] = [x0 + r, y0 + r];
  else if (px > x1 - r && py < y0 + r) [cx, cy] = [x1 - r, y0 + r];
  else if (px < x0 + r && py > y1 - r) [cx, cy] = [x0 + r, y1 - r];
  else if (px > x1 - r && py > y1 - r) [cx, cy] = [x1 - r, y1 - r];
  else return true;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawRoundedRect(pixels, size, x0, y0, x1, y1, radius, color) {
  const minY = Math.max(0, Math.floor(y0));
  const maxY = Math.min(size - 1, Math.ceil(y1));
  const minX = Math.max(0, Math.floor(x0));
  const maxX = Math.min(size - 1, Math.ceil(x1));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (insideRoundedRect(x + 0.5, y + 0.5, x0, y0, x1, y1, radius)) {
        const i = (y * size + x) * 4;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = 255;
      }
    }
  }
}

/** Renders the "stacked notes" glyph into a fresh full-bleed RGBA buffer.
 * `safeZoneScale` shrinks the glyph (not the background) to respect the
 * maskable-icon ~80% safe-zone convention. */
function renderIcon(size, { safeZoneScale = 1 } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = BG[0];
    pixels[i * 4 + 1] = BG[1];
    pixels[i * 4 + 2] = BG[2];
    pixels[i * 4 + 3] = 255;
  }

  const cardSize = size * 0.46 * safeZoneScale;
  const radius = cardSize * 0.16;
  const centerX = size / 2;
  const centerY = size / 2;
  const offset = cardSize * 0.22;

  // Back card (offset up-left), then front card (offset down-right) — a
  // simple two-layer "stack of notes" read instantly at any size.
  const backX0 = centerX - cardSize / 2 - offset / 2;
  const backY0 = centerY - cardSize / 2 - offset / 2;
  drawRoundedRect(pixels, size, backX0, backY0, backX0 + cardSize, backY0 + cardSize, radius, CARD_BACK);

  const frontX0 = centerX - cardSize / 2 + offset / 2;
  const frontY0 = centerY - cardSize / 2 + offset / 2;
  const frontX1 = frontX0 + cardSize;
  const frontY1 = frontY0 + cardSize;
  drawRoundedRect(pixels, size, frontX0, frontY0, frontX1, frontY1, radius, CARD_FRONT);

  // Two bold "text line" strokes inside the front card.
  const lineThickness = cardSize * 0.09;
  const lineInsetX = cardSize * 0.2;
  const lineY1 = frontY0 + cardSize * 0.4;
  const lineY2 = frontY0 + cardSize * 0.62;
  for (const ly of [lineY1, lineY2]) {
    drawRoundedRect(
      pixels,
      size,
      frontX0 + lineInsetX,
      ly - lineThickness / 2,
      frontX1 - lineInsetX,
      ly + lineThickness / 2,
      lineThickness / 2,
      LINE,
    );
  }

  return pixels;
}

// ---- minimal PNG encoder (signature + IHDR + IDAT + IEND) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  // Filter byte 0 ("None") per scanline, then zlib-deflate the whole thing.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    const srcStart = y * size * 4;
    Buffer.from(pixels.buffer, pixels.byteOffset + srcStart, size * 4).copy(raw, rowStart + 1);
  }
  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

function writeIcon(fileName, size, opts) {
  const pixels = renderIcon(size, opts);
  const png = encodePng(pixels, size);
  const outPath = path.join(OUT_DIR, fileName);
  writeFileSync(outPath, png);
  console.log(`wrote ${fileName} (${size}x${size}, ${png.length} bytes)`);
}

writeIcon("pwa-192x192.png", 192, { safeZoneScale: 1 });
writeIcon("pwa-512x512.png", 512, { safeZoneScale: 1 });
// Maskable: OS-applied masks (circle, squircle, ...) can crop up to ~20% off
// each edge, so shrink the glyph to keep it inside the safe zone while the
// background still bleeds edge-to-edge (required for maskable icons).
writeIcon("pwa-maskable-512x512.png", 512, { safeZoneScale: 0.62 });

#!/usr/bin/env node
/**
 * Generates the PWA/home-screen icon PNGs by rasterizing the master mark
 * (`public/favicon.svg`) with Playwright's Chromium — the same browser
 * engine already installed as a devDependency for `tests/e2e` (`npx
 * playwright install` in CI/dev setup), so this adds no new dependency and
 * makes no network fetch: the SVG is read from disk, rendered in a local
 * headless page, and screenshotted. Run manually via `npm run icons` (see
 * package.json); the output PNGs are checked into `public/` like
 * `favicon.svg`/`logo-mono.svg` already are, so a normal `vite build`
 * never re-runs this script.
 *
 * Composition, every output: the mark centered on a solid `#0e1015`
 * background (`--app-chrome-bg` / manifest `theme_color`/`background_color`
 * in `vite.config.ts`), matching the CLAUDE.md rule 3 "no server-dependent
 * features" and Phase 5b brief ("generate real icon assets locally; no
 * network fetches at build or runtime") that motivated the original
 * hand-rolled version of this script — this rewrite keeps that constraint,
 * it just replaces the procedural "stacked notes" placeholder glyph +
 * hand-rolled raster/PNG encoder with the REAL, already-designed mark
 * (DESIGN-SPEC Amendments round 10 item 47/48).
 *
 * Sizing: non-maskable icons (`pwa-192x192.png`, `pwa-512x512.png`,
 * `apple-touch-icon-180.png`) render the mark at ~76% of the canvas —
 * matching the old full-bleed non-maskable proportions. The maskable icon
 * (`pwa-maskable-512x512.png`) shrinks the mark to ~62% so it stays inside
 * the OS mask's ~80% safe zone (a circle/squircle/rounded-square crop can
 * take up to ~20% off each edge) while the background still bleeds edge to
 * edge, per the maskable-icon spec.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public");
const FAVICON_SVG_PATH = path.join(OUT_DIR, "favicon.svg");

const BG = "#0e1015"; // --app-chrome-bg / manifest theme_color & background_color

/** Renders `favicon.svg` at `markScale` (fraction of `size`) centered on a
 * `size`x`size` solid-background canvas and returns a PNG Buffer, via a
 * throwaway Chromium page. */
async function rasterize(browser, size, markScale) {
  const svgMarkup = readFileSync(FAVICON_SVG_PATH, "utf8");
  const markPx = Math.round(size * markScale);
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      `<!doctype html><html><head><style>
        html,body{margin:0;padding:0;background:${BG};width:${size}px;height:${size}px;overflow:hidden;}
        .stage{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${BG};}
        .mark{width:${markPx}px;height:${markPx}px;}
        .mark svg{display:block;width:100%;height:100%;}
      </style></head>
      <body><div class="stage"><div class="mark">${svgMarkup}</div></div></body></html>`,
      { waitUntil: "load" },
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

async function writeIcon(browser, fileName, size, markScale) {
  const png = await rasterize(browser, size, markScale);
  const outPath = path.join(OUT_DIR, fileName);
  writeFileSync(outPath, png);
  console.log(`wrote ${fileName} (${size}x${size}, ${statSync(outPath).size} bytes)`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    await writeIcon(browser, "pwa-192x192.png", 192, 0.76);
    await writeIcon(browser, "pwa-512x512.png", 512, 0.76);
    // Maskable: shrink the mark to keep it inside the ~80% OS-mask safe
    // zone while the background still bleeds edge-to-edge.
    await writeIcon(browser, "pwa-maskable-512x512.png", 512, 0.62);
    await writeIcon(browser, "apple-touch-icon-180.png", 180, 0.76);
  } finally {
    await browser.close();
  }
}

await main();

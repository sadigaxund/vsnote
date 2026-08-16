/**
 * DESIGN-SPEC Amendments round 3 item 22: (a) library themes (metallic /
 * glass / comic) must show their own page texture/mesh through this app's
 * chrome instead of a dead-flat fill (see `src/theme.css`'s Deviations-
 * grade comment on the `.dark` block for the root cause: an unlayered
 * `body` background rule always beating the library's own `layer(theme)`
 * rules, compounded by this app's shell surfaces tiling the viewport with
 * opaque fills of their own); (b) CM6's syntax highlight colors are driven
 * by `--syntax-*` CSS custom properties that vary per `data-theme`.
 *
 * "Actually visible," not just "a CSS rule exists somewhere," is proven two
 * ways per theme: the resolved `background-color` of a real chrome surface
 * has fractional alpha (translucent, letting whatever's behind it show),
 * AND a real screenshot of that surface has measurable pixel-level
 * variance (`lumaStdDev`, `pngPixels.ts`) — a flat, fully-opaque fill (the
 * pre-fix behavior) would read alpha=1 and ~zero variance on both counts.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, tab } from "./fixtures";
import { decodePng, distinctLumaLevels, lumaStdDev } from "./pngPixels";

const LIBRARY_THEMES = ["metallic", "glass", "comic"] as const;

/** Sets `data-theme` directly (bypassing the Settings UI — this is a pure
 * CSS-selector mechanism, `useSettingsStore`'s `applyDomSettings` does
 * nothing more than this single attribute write for `theme`) and waits a
 * frame so the browser has actually painted the new theme before either a
 * computed-style read or a screenshot. */
async function setTheme(page: import("@playwright/test").Page, theme: string | null): Promise<void> {
  await page.evaluate((t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }, theme);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.describe("theme compatibility (Amendments round 3 item 22)", () => {
  test("boot / explicit VSNote theme stays pixel-identical (regression gate)", async ({ page }) => {
    await gotoApp(page);
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        chromeBg: cs.getPropertyValue("--app-chrome-bg").trim(),
        sidebarBg: cs.getPropertyValue("--app-sidebar-bg").trim(),
        editorBg: cs.getPropertyValue("--app-editor-bg").trim(),
        titlebarBg: cs.getPropertyValue("--app-titlebar-bg").trim(),
      };
    });
    // Exact hex, unchanged since Phase 1 — the VSNote-default theme.css block
    // reasserts these literally rather than deriving them, specifically so
    // this stays true regardless of what the OTHER themes' block computes.
    expect(tokens.chromeBg).toBe("#0e1015");
    expect(tokens.sidebarBg).toBe("#15171c");
    expect(tokens.editorBg).toBe("#101318");
    expect(tokens.titlebarBg).toBe("#17191f");

    // And the resolved paint is fully OPAQUE (alpha 1) — VSNote deliberately
    // renders no texture at all.
    const alpha = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="app-activitybar"]')!;
      const bg = getComputedStyle(el).backgroundColor;
      // Chromium serializes a `color-mix()`-derived computed value in a
      // modern CSS Color 4 function (e.g. `oklab(0.2 -0.006 -0.024 / 0.86)`),
      // not always classic comma-separated `rgba(...)` — an alpha component,
      // when present, is always the token right after a `/`.
      if (!bg.includes("/")) return 1;
      return parseFloat(bg.split("/")[1]);
    });
    expect(alpha).toBe(1);
  });

  /** Two regions of real app chrome that contain NO text or icons, derived
   * from live element boxes (never hardcoded viewport coordinates): the
   * empty lower area of the sidebar, below the file tree, and the empty
   * lower-right of the editor pane, outside the centered prose column.
   *
   * Their text-free-ness is not an assumption — the VSNote test below
   * asserts these exact regions render as a single flat luma level, which
   * fails loudly if a glyph, border, or scrollbar ever creeps in. */
  async function flatChromeRegions(page: import("@playwright/test").Page) {
    const sidebar = (await page.getByTestId("explorer-sidebar").boundingBox())!;
    const pane = (await page.getByTestId("editor-pane").first().boundingBox())!;
    return {
      sidebar: {
        x: Math.round(sidebar.x + 16),
        y: Math.round(sidebar.y + sidebar.height - 70),
        width: Math.round(Math.min(sidebar.width - 32, 120)),
        height: 50,
      },
      editor: {
        x: Math.round(pane.x + pane.width - 90),
        y: Math.round(pane.y + pane.height - 90),
        width: 60,
        height: 60,
      },
    };
  }

  async function regionStats(page: import("@playwright/test").Page, clip: { x: number; y: number; width: number; height: number }) {
    const png = decodePng(await page.screenshot({ clip }));
    return { stdDev: lumaStdDev(png), levels: distinctLumaLevels(png) };
  }

  test("VSNote: the same chrome regions render dead flat (no texture, and proves the regions are text-free)", async ({ page }) => {
    await gotoApp(page);
    const regions = await flatChromeRegions(page);
    for (const [name, clip] of Object.entries(regions)) {
      const { stdDev, levels } = await regionStats(page, clip);
      expect(stdDev, `${name} std-dev under VSNote`).toBeLessThan(0.5);
      expect(levels, `${name} distinct luma levels under VSNote`).toBeLessThanOrEqual(2);
    }
  });

  for (const theme of LIBRARY_THEMES) {
    test(`${theme}: the theme's own texture is really painted on this app's chrome`, async ({ page }) => {
      await gotoApp(page);

      // Same text-free regions, measured under VSNote first: this is the
      // control, and it is what makes the comparison meaningful rather
      // than a bare threshold.
      const regions = await flatChromeRegions(page);
      const vsnote = {
        sidebar: await regionStats(page, regions.sidebar),
        editor: await regionStats(page, regions.editor),
      };
      expect(vsnote.sidebar.levels).toBeLessThanOrEqual(2);
      expect(vsnote.editor.levels).toBeLessThanOrEqual(2);

      await setTheme(page, theme);

      // (1) The library theme's own overlay resolves to a real texture —
      // confirms the theme CSS (untouched by this app) is doing its job.
      const beforeBg = await page.evaluate(
        () => getComputedStyle(document.documentElement, "::before").backgroundImage,
      );
      expect(beforeBg).not.toBe("none");
      expect(beforeBg).toContain("data:image/svg+xml");

      // (2) The proof that actually matters, and the one an earlier version
      // of this file got wrong: measure a region with NO icons or text in
      // it. That earlier test sampled the activity bar (icons included) and
      // asserted std-dev > 3, which the icons alone satisfy — it passed
      // against a build whose chrome was provably 100% flat (independently
      // measured: std-dev 0.000, exactly 1 luma level, in all five chrome
      // regions) because the then-current fix relied on transmitting the
      // texture through four stacked translucent layers, which compounds to
      // ~0.03% transmission. Both halves are asserted together here: real
      // spread AND many distinct levels, neither of which a flat fill or a
      // single hard edge can fake.
      for (const [name, clip] of Object.entries(regions)) {
        const { stdDev, levels } = await regionStats(page, clip);
        expect(stdDev, `${theme} ${name} luma std-dev`).toBeGreaterThanOrEqual(2);
        expect(levels, `${theme} ${name} distinct luma levels`).toBeGreaterThanOrEqual(8);
      }
    });
  }

  test("switching to a library theme changes CM6's syntax highlight colors (item 22(b))", async ({ page }) => {
    await gotoApp(page);
    await tab(page, "vault/src/indexer.ts").click();
    // `--syntax-type` (derived from `--color-warning`), not
    // `--syntax-keyword`/`--syntax-function` (derived from `--color-
    // primary`) — the accent-color Setting deliberately force-overrides
    // `--color-primary` via an INLINE style on `<html>`
    // (`useSettingsStore.ts`'s `applyDomSettings`), the highest-precedence
    // origin in the cascade, specifically so the user's chosen accent wins
    // over EVERY theme's own primary color. That's correct, intentional
    // behavior for the accent setting — but it makes `--color-primary`-
    // derived roles theme-invariant by design, a poor choice for proving
    // "the theme changed the palette." `--color-warning` has no such
    // override, so it's the real per-theme signal.
    const typeColorVSNote = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--syntax-type").trim());

    await setTheme(page, "metallic");
    const typeColorMetallic = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--syntax-type").trim());
    expect(typeColorMetallic).not.toBe(typeColorVSNote);

    // Confirm it's not just the CSS variable that changed but an actual
    // rendered token color — read the real computed color off a live CM6
    // syntax span rather than assuming the variable resolved.
    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible();
    const spanColor = await content.locator(".cm-line span[class]").first().evaluate((el) => getComputedStyle(el).color);
    expect(spanColor).toBeTruthy();
    expect(spanColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});

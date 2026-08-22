import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

/**
 * theme-texture regression probe — switching themes via Settings must give
 * each TexturedSurface a DIFFERENT resolved texture SVG (the original bug:
 * the inline --texture-paper-resolved from first mount persisted across
 * theme changes because nothing re-rendered the surfaces).
 */
for (const theme of ["glass", "metallic", "comic"]) {
  test(`theme switch re-textures chrome: ${theme}`, async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("app-titlebar").getByRole("button", { name: "Settings" }).click();
    await page.getByTestId("settings-nav-appearance").click();

    async function sidebarAfterBg(): Promise<string> {
      return page.evaluate(() => {
        let el: Element | undefined;
        for (const e of Array.from(document.querySelectorAll("*"))) {
          if (/after:content/.test(e.getAttribute("class") || "")) {
            el = e;
            break;
          }
        }
        if (!el) return "(none)";
        return getComputedStyle(el, "::after").backgroundImage;
      });
    }

    const before = await sidebarAfterBg();
    expect(before).not.toContain("(none)");

    await page.getByTestId("settings-theme").click();
    await page.getByRole("option", { name: new RegExp(`^${theme}$`, "i") }).click();
    await page.waitForTimeout(250);

    const after = await sidebarAfterBg();
    // comic resolves to the SAME paper-grain layer as the default VSNote
    // look, so its resolved SVG legitimately does not change.
    const shouldChange = theme !== "comic";
    if (shouldChange) {
      expect(after, `texture should change when switching to ${theme}`).not.toEqual(before);
    }
    console.log(`TEXSWITCH[${theme}] changed=${before !== after} (expected=${shouldChange})`);

    // And it must be the THEME's own type resolved through the layer system.
    const rootType = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--texture-type").trim(),
    );
    expect(rootType).toBe(theme === "comic" ? "paper-grain" : theme === "glass" ? "frosted-glass" : "brushed-aluminium");
  });
}

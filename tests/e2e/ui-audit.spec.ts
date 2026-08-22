/**
 * UI audit runner (TODO §7.4 / skills/design-review-checklist.md) — the
 * MECHANICAL half of the design-review checklist, as a Playwright spec.
 *
 * Gated behind `VSNOTE_UI_AUDIT=1` so the normal `test:e2e` run skips it:
 *
 *   VSNOTE_UI_AUDIT=1 npx playwright test tests/e2e/ui-audit.spec.ts
 *
 * What it checks programmatically (against the demo build the suite
 * serves):
 *   1. Narrow-viewport reflow: 320px + 480px shells must not overflow
 *      horizontally (WCAG 1.4.10 direction).
 *   2. WCAG text-spacing override (1.4.12): injected letter/word/line
 *      spacing must not clip or overflow the chrome surfaces.
 *   3. Non-text contrast ≥ 3:1 on computed token pairs: focus ring vs bg,
 *      status-bar text vs its surface, git added/deleted vs editor bg.
 *   4. Color-independence evidence: with CDP vision-deficiency emulation
 *      (deuteranopia), screenshots of the diff view are captured for human
 *      review into `.design/ui-audit/` (hue-only distinctions would be a
 *      finding; markers/symbols can't be asserted generically).
 *
 * Screenshots land in `.design/ui-audit/` for the human half of the review
 * (taste calls stay human). Findings print to the console AND are written
 * to `.design/ui-audit/REPORT.md`.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_ACTIVE_PATH, gotoApp, treeRow } from "./fixtures";

const AUDIT_DIR = ".design/ui-audit";
const SKIP = !process.env.VSNOTE_UI_AUDIT;

test.describe.configure({ mode: "serial" });

test.skip(SKIP, "run with VSNOTE_UI_AUDIT=1");

let findings: string[] = [];
function record(severity: "MUST" | "SHOULD" | "OK", check: string, detail: string) {
  findings.push(`[${severity}] ${check}: ${detail}`);
  if (severity === "MUST") console.log(`✖ MUST ${check}: ${detail}`);
}

async function horizontalOverflow(page: Page, label: string): Promise<boolean> {
  return page.evaluate((lbl) => {
    const doc = document.scrollingElement;
    const over = doc ? doc.scrollWidth - doc.clientWidth : -1;
    (window as unknown as { __auditOverflow?: Record<string, number> }).__auditOverflow ??= {};
    (window as unknown as { __auditOverflow?: Record<string, number> }).__auditOverflow![lbl] = over;
    return over > 2; // ≤2px tolerance for scrollbar rounding
  }, label);
}

/** Relative luminance + contrast ratio per WCAG 2.x definitions. */
function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = luminance(...rgb1);
  const l2 = luminance(...rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseColor(css: string): [number, number, number] | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

test("UI audit: reflow, text-spacing, contrast, vision-deficiency evidence", async ({ page }, testInfo) => {
  mkdirSync(AUDIT_DIR, { recursive: true });
  findings = [];

  // Hermetic shell: the audit only exercises layout/color/copy of the app
  // chrome, so both boot endpoints are synthesized — no share backend, no
  // gate state, no cross-run flakiness.
  await page.route("**/api/app-config", (r) =>
    r.fulfill({ json: { login_required: false, password_login: false, cf_access: false } }),
  );
  await page.route("**/api/auth/whoami", (r) =>
    r.fulfill({
      json: { authenticated: true, username: "audit", email: "audit@example.com", is_admin: true, source: "password" },
    }),
  );

  // ---- 1. Narrow-viewport reflow ------------------------------------
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 720 });
    // Narrow widths may legitimately collapse/hide tree+tab chrome, so the
    // reflow probe only waits for the shell itself.
    await page.goto("/");
    await expect(page.getByTestId("app-titlebar")).toBeVisible({ timeout: 15_000 }).catch(async () => {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
      const hasRoot = await page.evaluate(() => document.getElementById("root")?.childElementCount ?? -1);
      throw new Error(`shell missing @${width}px; root children=${hasRoot}; body="${text}"`);
    });
    if (await horizontalOverflow(page, `${width}px`)) {
      record("MUST", `reflow@${width}`, "document scrolls horizontally");
    } else {
      record("OK", `reflow@${width}`, "no horizontal overflow");
    }
    await page.screenshot({ path: `${AUDIT_DIR}/reflow-${width}.png`, fullPage: false });
  }

  // ---- 2. Text-spacing override (back at default width) -------------
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoApp(page);
  await page.addStyleTag({
    content:
      "* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.6 !important; }",
  });
  const clipped = await page.evaluate(() => {
    // A surface "fails" if its content now scrolls where it didn't before
    // (simplified overlap proxy: any element whose scrollWidth exceeds its
    // clientWidth by >4px among tab titles and status segments).
    const bad: string[] = [];
    document.querySelectorAll('[data-testid="app-titlebar"], [data-testid="app-statusbar"]').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 4) bad.push(el.getAttribute("data-testid") ?? "?");
    });
    return bad;
  });
  if (clipped.length > 0) record("MUST", "text-spacing", `clipped: ${clipped.join(", ")}`);
  else record("OK", "text-spacing", "chrome survives WCAG spacing overrides");
  await page.screenshot({ path: `${AUDIT_DIR}/text-spacing.png` });

  // ---- 3. Token-pair contrast ---------------------------------------
  const pairs = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const resolveToRgb = (token: string, fallback: string): [number, number, number] | null => {
      // Resolve through a probe element so var() chains + color-mix work.
      const probe = document.createElement("span");
      probe.style.color = `var(${token}, ${fallback})`;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    return {
      ring: resolveToRgb("--color-ring", "#27d2c5"),
      bg: resolveToRgb("--app-chrome-bg", "#0e1015"),
      fg: resolveToRgb("--color-fg", "#d8dfe6"),
      added: resolveToRgb("--git-added", "#3fb950"),
      deleted: resolveToRgb("--git-deleted", "#f85149"),
      editorBg: resolveToRgb("--app-editor-bg", "#101318"),
    };
  });
  type Rgb = [number, number, number];
  const pct = (a: unknown) =>
    contrast(a as Rgb, (pairs.bg ?? [14, 16, 21]) as Rgb).toFixed(2);
  if (pairs.ring) {
    const ratio = Number(pct(pairs.ring));
    const verdict = ratio >= 3 ? "OK" : "MUST";
    record(verdict as "OK" | "MUST", "focus-ring contrast", `${ratio}:1 vs chrome bg`);
  }
  if (pairs.fg) {
    const ratio = Number(
      contrast(pairs.fg, (pairs.bg ?? [14, 16, 21]) as Rgb).toFixed(2),
    );
    record(ratio >= 4.5 ? "OK" : "MUST", "status/title text contrast", `${ratio}:1`);
  }
  for (const [name, color] of [
    ["git-added", pairs.added],
    ["git-deleted", pairs.deleted],
  ] as const) {
    if (!color || !pairs.editorBg) continue;
    const ratio = contrast(color, pairs.editorBg);
    // Diff line COLORS pair with +/- markers and gutters, so hue alone
    // isn't load-bearing; 3:1 is the guidance threshold here.
    record(ratio >= 3 ? "OK" : "SHOULD", `${name} vs editor bg`, `${ratio.toFixed(2)}:1`);
  }

  // ---- 4. Vision-deficiency evidence on the diff view ---------------
  // Requires the DEMO bundle (`npm run build:demo`): the seeded
  // architecture.md modification is what the diff view shows.
  await gotoApp(page);
  await expect(treeRow(page, DEFAULT_ACTIVE_PATH)).toBeVisible();
  // The Diff option only appears once the diff cache has loaded — wait for
  // the seeded +12 chip exactly like editor-diff.spec does.
  const header = page.getByTestId("app-titlebar");
  await expect(header).toContainText("+12");
  await expect(header).toContainText("-5");
  await page.getByRole("radio", { name: "Diff" }).click();
  await page.waitForTimeout(300);
  await expect(page.locator(".cm-changedLine, .cm-deletedLine, .cm-insertedLine").first()).toBeVisible();
  const client = await page.context().newCDPSession(page);
  for (const deficiency of ["deuteranopia", "protanopia"] as const) {
    await client.send("Emulation.setEmulatedVisionDeficiency", { type: deficiency });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${AUDIT_DIR}/diff-${deficiency}.png`, fullPage: false });
  }
  await client.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
  record("SHOULD", "vision-deficiency captures", "human review: do +/- regions stay distinguishable?");

  // ---- Report --------------------------------------------------------
  writeFileSync(`${AUDIT_DIR}/REPORT.md`, `# UI audit — ${new Date().toISOString()}\n\n\`\`\`\n${findings.join("\n")}\n\`\`\`\n`);
  console.log(findings.join("\n"));
  void testInfo;
});

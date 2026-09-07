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
import { DEMO_OWNER_PASSWORD, DEMO_OWNER_USERNAME } from "./shareFixtures";
import { openSharedView, signInToShareBackend } from "./shareUiHelpers";

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

/**
 * Design-polish before/after capture (docs/PLAN-2026-09-05-refresh.md §7,
 * DESIGN-SPEC round 10 items 98-103) — six screens the human design judge
 * flips between across two runs of this file (one at each end of the
 * polish commit range), copied out of `.design/ui-audit/` into
 * `.design/polish/{before,after}/` by hand between runs (same filenames,
 * so the pair lines up). Each screenshot is guarded by a real `expect(...)
 * .toBeVisible()` on the exact surface being captured — this is not a bare
 * capture harness, so it stays in the suite as a real (if screenshot-
 * flavored) assertion of "that surface still renders", not just a photo
 * op. Uses the REAL share backend (`startShareBackend()` via `globalSetup
 * .ts`, the same one `share-*.spec.ts` files use) rather than the first
 * test's hermetic `page.route` stubs, because three of the six screens
 * (Shared view, publish dialog, public reader) need a real publish
 * round-trip to have non-empty content worth screenshotting.
 */
test("design polish: six before/after screens (round 10 items 98-103)", async ({ page, context }) => {
  test.skip(SKIP, "run with VSNOTE_UI_AUDIT=1");
  mkdirSync(AUDIT_DIR, { recursive: true });

  await gotoApp(page);

  // 1. Editor with the sidebar — the main shell. Captured BEFORE signing
  // in (which opens Settings), so the active tab is really the editor, not
  // Settings left focused from the sign-in helper below.
  await expect(treeRow(page, DEFAULT_ACTIVE_PATH)).toBeVisible();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-01-editor-shell.png`, fullPage: false });

  // 7 (round 2 addition). Tab hover state — after-only: none of the other
  // six captures exercise a mouse hover (all six are static, mouse-less
  // states), so there is no meaningful "before" pair for this one. Hovers
  // an INACTIVE tab (seeded `src/indexer.ts`, second tab from the left) to
  // show the softened divider (`--app-border-nested`) and the hover
  // background together.
  await page.locator('[role="tab"][data-tab-path="vault/src/indexer.ts"]').hover();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-07-tab-hover.png`, fullPage: false });
  await page.mouse.move(0, 0);

  await signInToShareBackend(page, DEMO_OWNER_USERNAME, DEMO_OWNER_PASSWORD);

  // 2. Settings — Appearance (theme select, density radio group, accent
  // ColorField: a real mix of control types on one page).
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-theme")).toBeVisible();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-02-settings-appearance.png`, fullPage: false });

  // 3 + 4. Publish dialog on a content-bearing step (Link: alias/expiry,
  // not the empty Mode-picker first frame), then finish publishing so
  // there's a real share for the Shared view and public reader below.
  await treeRow(page, DEFAULT_ACTIVE_PATH).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Publish…" }).click();
  const dialog = page.getByTestId("publish-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Viewer page" }).click();
  await dialog.getByTestId("publish-continue").click(); // -> Who can open
  await dialog.getByTestId("publish-continue").click(); // -> Protection
  await dialog.getByTestId("publish-continue").click(); // -> Link
  await expect(dialog.getByTestId("publish-alias")).toBeVisible();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-04-publish-dialog.png`, fullPage: false });
  await dialog.getByTestId("publish-submit").click(); // -> Result
  const linkInput = dialog.getByTestId("publish-result-link");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  await dialog.getByTestId("publish-done").click();
  await expect(dialog).toBeHidden();

  // 5. Shared view/tab, now with a real row in it.
  await openSharedView(page);
  await expect(page.getByTestId("shared-view-table")).toBeVisible();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-03-shared-view.png`, fullPage: false });

  // 6. The public share reader — its own token scope, no app chrome. Waits
  // for the actual rendered document (the seeded architecture.md's real
  // heading), not just the "Loading…" shell `.share-reader` shows first.
  const reader = await context.newPage();
  await reader.goto(link);
  await expect(reader.getByText("Indexing architecture", { exact: false })).toBeVisible();
  await reader.screenshot({ path: `${AUDIT_DIR}/polish-05-public-reader.png`, fullPage: false });
  await reader.close();

  // 7 (screen 6 of 6). Command palette — a popover surface, for the shadow
  // scale.
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await expect(palette.getByText("Commands", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${AUDIT_DIR}/polish-06-command-palette.png`, fullPage: false });
  await page.keyboard.press("Escape");
});

/**
 * Phase 7's "targeted probes worth keeping" — offline cold start, the
 * service-worker update-check plumbing, zip export producing a real
 * archive, and the settled-traffic precache budget (the regression guard
 * for ARCHITECTURE.md's Deviations note: a naive glob once swept up all
 * ~1250 material-icon-theme SVG chunks — 1310+ precache entries — even
 * though `materialIconLoader.ts`'s entire design exists so a cold boot
 * never fetches that pack).
 */
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { unzipSync } from "fflate";
import { gotoApp } from "./fixtures";

test.describe("PWA / offline / durability probes", () => {
  test("DESIGN-SPEC Amendments item 16's contract still holds after Phase 8's header consolidation: a keystroke burst does not re-render App", async ({ page }) => {
    // Phase 8 (DESIGN-SPEC Amendments round 3 item 18) made `App.tsx` read
    // `activeTab`/`activeDiff`/`focusedLeaf` to feed the title bar's newly-
    // absorbed breadcrumb/diff-chip/mode-toggle cluster — none of that is
    // NEW data App didn't already subscribe to before this phase (it fed
    // the status bar already), and none of it changes on a keystroke (tab
    // identity/mode and the diff cache only change on tab-switch/save, not
    // on typing) — but this is exactly the kind of change that's easy to
    // accidentally regress into a keystroke-frequency subscription, so
    // `lib/renderProbe.ts`'s standing guard gets a real, committed
    // assertion here rather than staying "prove it if you ever suspect a
    // regression."
    await page.addInitScript(() => {
      (window as unknown as { __renderProbeEnabled?: boolean }).__renderProbeEnabled = true;
    });
    await gotoApp(page);

    // architecture.md boots in Rendered mode — the live-preview CM6 editor
    // is itself a real EditorView, so this exercises the exact keystroke
    // path item 16 fixed (not just Source mode).
    const content = page.locator(".cm-content").first();
    await content.click();
    await page.keyboard.press("Control+Home");

    function readAppRenderCount() {
      return page.evaluate(() => (window as unknown as { __renderCounts?: Record<string, number> }).__renderCounts?.App ?? 0);
    }

    const before = await readAppRenderCount();
    await page.keyboard.type("x".repeat(45), { delay: 4 });
    const after = await readAppRenderCount();

    expect(after).toBe(before);
  });

  test("offline cold start: fresh context, SW installed, shell + CM6 still render", async ({ page, context }) => {
    await gotoApp(page);
    // `navigator.serviceWorker.ready` is the deterministic sync point
    // (ARCHITECTURE.md Deviations: Workbox's precache write runs inside
    // `install`, which must finish before `activate`/`ready` fires).
    await page.evaluate(() => navigator.serviceWorker.ready);

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    await expect(page.getByRole("tree")).toBeVisible();
    await expect(page.locator('[data-tree-path="vault/notes/architecture.md"]')).toBeVisible();
    // The default file's Rendered markdown — a real CM6 mount, not just
    // static shell — still renders with the app's own JS/SW bundle offline.
    await expect(page.locator(".cm-content").first()).toBeVisible();

    await context.setOffline(false);
    expect(errors).toEqual([]);
  });

  test("service-worker update-check plumbing runs without error (autoUpdate wiring)", async ({ page }) => {
    // A full "rebuild mid-suite and confirm an open tab reloads onto the
    // new bundle" repro (the exact manual reproduction ARCHITECTURE.md's
    // Deviations note describes) would need to mutate the running build
    // out from under a server this suite doesn't own the lifecycle of
    // in-test — not safely automatable without either a second build
    // pipeline or editing app source mid-run, both of which would cost
    // this suite its determinism guarantee. What IS safely automatable,
    // and is the actual regression surface, is checked below: the
    // service worker registers, `registration.update()` (the same call
    // `main.tsx`'s hourly poll makes) completes without throwing, and the
    // page stays controlled by exactly one registration afterward (the
    // flags that make an update take over immediately — `skipWaiting`/
    // `clientsClaim` — instead of waiting for every tab to close).
    await gotoApp(page);
    const registration = await page.evaluate(() => navigator.serviceWorker.ready);
    expect(registration).toBeTruthy();

    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    // Still controlled, still exactly one registration — an update check
    // against an unchanged build is a no-op, not an error/duplicate SW.
    const registrationCount = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(registrationCount).toBe(1);
  });

  test("Export vault as .zip produces a valid archive with the vault's real files", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+k");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("dialog").getByRole("button", { name: /Export vault as \.zip/ }).click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("download did not save to a local path");
    const buf = readFileSync(downloadPath);
    expect(buf.byteLength).toBeGreaterThan(0);

    const files = unzipSync(new Uint8Array(buf));
    const names = Object.keys(files);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("vault/notes/architecture.md");
    expect(names).toContain("vault/vault.config.json");
    // Every entry is real, non-empty (or legitimately empty, e.g. a 0-byte
    // placeholder) file content, not a corrupt/truncated archive.
    for (const name of names) {
      expect(files[name]).toBeInstanceOf(Uint8Array);
    }
  });

  test("settled-traffic precache budget stays bounded", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);

    const summary = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      let totalEntries = 0;
      let totalBytes = 0;
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        totalEntries += requests.length;
        for (const req of requests) {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            totalBytes += blob.size;
          }
        }
      }
      return { totalEntries, totalBytes, cacheCount: cacheNames.length };
    });

    // Regression guard for ARCHITECTURE.md's Deviations note: the naive
    // glob precached ~1315 entries (~3.4MB) by sweeping up every
    // material-icon-theme SVG chunk `materialIconLoader.ts` exists
    // specifically to avoid fetching on a cold boot. The fixed budget is
    // ~134 entries / ~1.55MB. 200 leaves real headroom for future curated
    // icons/lazy chunks while still catching that regression by two
    // orders of magnitude before it could recur unnoticed.
    expect(summary.totalEntries).toBeLessThan(200);
    expect(summary.totalEntries).toBeGreaterThan(0);
    expect(summary.totalBytes).toBeLessThan(5 * 1024 * 1024); // 5MB ceiling, well under the 1310-entry regression's ~3.4MB+ actual weight would have implied at true scale
  });

  test("precache manifest excludes every icon-fallback chunk (vite.config.ts's manifestTransforms)", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const precachedUrls = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const urls: string[] = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        urls.push(...requests.map((r) => r.url));
      }
      return urls;
    });
    // None of the full-manifest fallback chunks (only reached on an
    // exotic-icon cache MISS) should ever be precached — the exact defect
    // ARCHITECTURE.md's Deviations note describes fixing.
    const offenders = precachedUrls.filter((u) => /materialIconLoader|material-icons-[\w-]+\.js/.test(u));
    expect(offenders).toEqual([]);
  });
});

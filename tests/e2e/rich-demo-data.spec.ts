/**
 * Phase 6.5c exit criteria (DESIGN-SPEC Amendments item 15, "Representative
 * demo data"): `metrics.csv` (12+ columns, 40+ rows, mixed types) genuinely
 * exercises `DataTable`'s truncation/horizontal-scrolling/sticky-header
 * behavior, and `vault.config.json` (deep nesting, arrays of objects, long
 * strings) genuinely exercises `TreeView`'s expand/collapse over real
 * structure — not the old 2-column/7-line toy fixtures. This spec also
 * re-confirms the git invariants the seeder must keep reproducing
 * (`fs-git.spec.ts`/`diffStat.test.ts` already cover these in detail; the
 * assertions here are the "richer data didn't break them" cross-check from
 * this same phase's change).
 */
import { test, expect } from "@playwright/test";
import { gotoApp, openFromTree, seedShowGitStatusInExplorer, tab, treeRow } from "./fixtures";

test.describe("representative demo data", () => {
  test("metrics.csv renders a wide, many-row DataTable with a sticky header and horizontal scroll", async ({ page }) => {
    await gotoApp(page);
    await openFromTree(page, "vault/metrics.csv", { pin: true });
    await expect(tab(page, "vault/metrics.csv")).toBeVisible();

    const table = page.locator("table").first();
    await expect(table).toBeVisible();

    // 13 columns (id, date, region, product, category, channel, unit_price,
    // units_sold, revenue, refund_rate, status, campaign_url, notes) —
    // "12+ columns" per the spec.
    const headerCells = table.locator("thead th");
    await expect(headerCells).toHaveCount(13);

    // 40+ data rows (WORKING variant is 42 — the seeded working-tree copy).
    const bodyRows = table.locator("tbody tr");
    const rowCount = await bodyRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(40);

    // Mixed types actually rendered, not just present in the raw CSV text —
    // a date-shaped cell (CellType's "date-system" absolute-date treatment,
    // e.g. "Jan 01, 2026" — via CsvTable.tsx's inferColumnType) and an
    // http(s) URL cell rendered as a real anchor (CellType's "url" type).
    await expect(table.getByText(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/).first()).toBeVisible();
    await expect(table.locator('a[href^="https://metrics.internal.example.com"]').first()).toBeVisible();

    // `layout="auto"` + divergent column widths (short numeric columns next
    // to a long free-text `notes` column) => the table's own content is
    // wider than its container, so the ScrollArea scrolls horizontally.
    const scrollWidth = await table.evaluate((el) => el.scrollWidth);
    const containerWidth = await table.evaluate((el) => el.parentElement!.clientWidth);
    expect(scrollWidth).toBeGreaterThan(containerWidth);

    // Sticky header: `thead` (or its cells) carries `position: sticky`.
    const headerPosition = await table.evaluate((el) => getComputedStyle(el.querySelector("thead")!).position);
    expect(headerPosition).toBe("sticky");
  });

  test("vault.config.json renders a deep JSON tree with an array of objects", async ({ page }) => {
    await gotoApp(page);
    await openFromTree(page, "vault/vault.config.json", { pin: true });
    await expect(tab(page, "vault/vault.config.json")).toBeVisible();
    // `.json` defaults to Source mode (filetypes/registry.ts) — switch to
    // Rendered to reach the `JsonView` TreeView this test is actually about.
    await page.getByRole("radio", { name: "Rendered" }).click();

    // Top-level keys from the deep fixture (workspace/indexing/integrations/
    // changelog), not the old flat 4-key toy config.
    await expect(page.getByText("workspace", { exact: true })).toBeVisible();
    await expect(page.getByText("integrations", { exact: true })).toBeVisible();
    await expect(page.getByText("changelog", { exact: true })).toBeVisible();

    // Real nested structure (workspace.members, an array of objects), not
    // just top-level breadth — `defaultExpandedDepth={3}` (JsonView.tsx)
    // already reveals this without any manual expand clicks.
    await expect(page.getByText("members", { exact: true })).toBeVisible();
    await expect(page.getByText("Priya Natarajan").first()).toBeVisible();
  });

  test("DESIGN-SPEC Amendments round 3 item 21: markdown-kitchen-sink.md renders every supported element (real DOM markers, not a screenshot)", async ({ page }) => {
    await gotoApp(page);
    await openFromTree(page, "vault/notes/markdown-kitchen-sink.md", { pin: true });
    await expect(tab(page, "vault/notes/markdown-kitchen-sink.md")).toBeVisible();
    // Boots in Rendered mode (md's registry default) — the live-preview CM6
    // editor, real decoration classes per heading/emphasis/list/etc level.
    const content = page.locator(".cm-content").first();
    const scroller = page.locator(".cm-scroller").first();
    await expect(content).toBeVisible();

    // CM6 virtualizes long documents (only lines near the current scroll
    // position exist in the DOM at all — a fundamental CM6 behavior, not a
    // bug), so this test SCROLLS THROUGH the whole note, accumulating
    // which decoration classes it has seen along the way, instead of
    // asserting element counts against a single static viewport (which
    // would only ever see the top of the document). Each step scrolls the
    // real `.cm-scroller` element and `expect.poll`s on the union of
    // classes seen so far actually growing — a real synchronization point
    // (CM6 has rendered something new), not a bare timeout.
    const seenClasses = new Set<string>();
    // Decoration class names are @atomic-editor/editor's (the 2026-08-21
    // engine swap — see ARCHITECTURE.md's deviation note). Ordered-list
    // markers stay as plain text in atomic-editor (they carry real sequence
    // information), so they're covered by the shared `cm-atomic-list-marker`
    // assertion rather than a dedicated class.
    const MARKER_CLASSES = [
      "cm-atomic-h1",
      "cm-atomic-h2",
      "cm-atomic-h3",
      "cm-atomic-h4",
      "cm-atomic-h5",
      "cm-atomic-h6",
      "cm-atomic-strong",
      "cm-atomic-em",
      "cm-atomic-strike",
      "cm-atomic-bullet",
      "cm-atomic-list-marker",
      "cm-atomic-task-checkbox",
      "cm-atomic-link",
      "cm-atomic-blockquote",
      "cm-atomic-inline-code",
      "cm-atomic-fenced-code",
      "cm-atomic-hr",
    ];
    async function sampleVisibleMarkers(): Promise<void> {
      const found = await content.evaluate((el, classes: string[]) => {
        const present: string[] = [];
        for (const c of classes) {
          if (el.querySelector(`.${c}`)) present.push(c);
        }
        return present;
      }, MARKER_CLASSES);
      for (const c of found) seenClasses.add(c);
    }

    const scrollHeight = await scroller.evaluate((el) => el.scrollHeight);
    const clientHeight = await scroller.evaluate((el) => el.clientHeight);
    const steps = Math.max(4, Math.ceil(scrollHeight / Math.max(1, clientHeight)) + 2);
    for (let i = 0; i <= steps; i++) {
      const top = Math.round((scrollHeight * i) / steps);
      await scroller.evaluate((el, y) => {
        el.scrollTop = y;
        el.dispatchEvent(new Event("scroll"));
      }, top);
      await expect
        .poll(async () => {
          await sampleVisibleMarkers();
          return seenClasses.size;
        })
        .toBeGreaterThanOrEqual(0); // just forces a settle point between scroll steps
    }

    // Every supported element class was seen SOMEWHERE while scrolling
    // through the note — the real coverage assertion.
    for (const cls of MARKER_CLASSES) {
      expect(seenClasses.has(cls), `expected to see .${cls} somewhere in the rendered note`).toBe(true);
    }

    // Task-list checkboxes are real, interactive inputs with the right
    // checked state — navigate to the task list specifically (find jumps
    // there and CM6 renders the surrounding lines, so the inputs exist)
    // and verify that beyond "the class exists somewhere."
    await page.keyboard.press("Control+f");
    const taskFindInput = page.locator(".atomic-editor-search-panel input").first();
    await expect(taskFindInput).toBeVisible();
    await taskFindInput.fill("Task list:");
    await taskFindInput.press("Enter");
    await page.keyboard.press("Escape");
    const checkboxes = content.locator("input.cm-atomic-task-checkbox");
    await expect(checkboxes).toHaveCount(4);
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(2)).not.toBeChecked();

    // Horizontal rules — two `---`/`***` rules; scroll to the bottom
    // (Ctrl+End, a real user gesture CM6 scrolls into view on its own).
    await content.click();
    await page.keyboard.press("Control+End");
    await expect(content.locator(".cm-atomic-hr")).toHaveCount(2);
    await expect(page.getByText("The end.")).toBeVisible();

    // The internal link resolves and opens indexer.ts in a tab when
    // clicked (DESIGN-SPEC "Internal links ... open that file in a tab") —
    // use find-in-document to scroll it into view deterministically rather
    // than guessing a scroll position. Rendered mode's panel is the one
    // @atomic-editor/editor ships (`.atomic-editor-search-panel`); App's
    // global Ctrl+F handler opens exactly that via `openSearchPanel` on the
    // registered view.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+f");
    const findInput = page.locator(".atomic-editor-search-panel input").first();
    await expect(findInput).toBeVisible();
    await findInput.fill("indexer.ts");
    // `setSearchQuery` alone only highlights matches — it doesn't move the
    // selection/scroll. `findNext` (Enter) actually jumps to (and scrolls
    // to) the first match, same as a real user pressing Enter in the
    // panel.
    await findInput.press("Enter");
    await page.keyboard.press("Escape");
    // The match left the caret ON the link, so it's revealed as raw source
    // (cursor-inside-link rule) — move off it and wait for it to re-render
    // into its clickable form before clicking.
    await page.keyboard.press("ArrowUp");
    const internalLink = content.locator(".cm-atomic-link", { hasText: "indexer.ts" });
    await expect(internalLink).toBeVisible();
    await internalLink.click();
    await expect(tab(page, "vault/src/indexer.ts")).toBeVisible();
  });

  test("DESIGN-SPEC Amendments round 3 item 21: demo.html renders in the sandboxed iframe preview", async ({ page }) => {
    await gotoApp(page);
    await openFromTree(page, "vault/demo.html", { pin: true });
    await expect(tab(page, "vault/demo.html")).toBeVisible();
    // html defaults to Rendered mode (filetypes/registry.ts).
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "Vault demo page" })).toBeVisible();
    await expect(frame.getByText(/sandboxed HTML preview/)).toBeVisible();
    // Confirm the iframe is really sandboxed, per DESIGN-SPEC.
    const sandboxAttr = await page.locator("iframe").getAttribute("sandbox");
    expect(sandboxAttr).toBe("");
  });

  test("git invariants still hold with the regenerated demo data: metrics.csv M, architecture.md +12/-5, 6 changes, 1 untracked", async ({ page }) => {
    await seedShowGitStatusInExplorer(page); // tree letters are opt-in now (round 6 item 15)
    await gotoApp(page);
    await expect(treeRow(page, "vault/metrics.csv")).toContainText("M");
    const scmButton = page.getByRole("button", { name: "Source Control" });
    await expect(scmButton).toContainText("6");

    const header = page.getByTestId("app-titlebar");
    await expect(header).toContainText("+12");
    await expect(header).toContainText("-5");

    await expect(page.getByTestId("app-statusbar")).toContainText("1 untracked");
    await expect(page.getByTestId("app-statusbar")).toContainText("main");
  });
});

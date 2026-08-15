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
import { gotoApp, openFromTree, tab, treeRow } from "./fixtures";

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

  test("git invariants still hold with the regenerated demo data: metrics.csv M, architecture.md +12/-5, 6 changes, 1 untracked", async ({ page }) => {
    await gotoApp(page);
    await expect(treeRow(page, "vault/metrics.csv")).toContainText("M");
    const scmButton = page.getByRole("button", { name: "Source Control" });
    await expect(scmButton).toContainText("6");

    const header = page.getByTestId("editor-header");
    await expect(header).toContainText("+12");
    await expect(header).toContainText("-5");

    await expect(page.getByTestId("app-statusbar")).toContainText("1 untracked");
    await expect(page.getByTestId("app-statusbar")).toContainText("feat/incremental-index");
  });
});

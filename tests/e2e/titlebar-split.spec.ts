/**
 * R3-10 fix(shell): the title bar "Split editor" button.
 *
 * `TitleBar.tsx` always accepted an `onToggleSplit` prop, but `App.tsx`
 * never passed one, so the button rendered and did nothing. This wires it
 * to the SAME primitive the per-tab "Split right" context menu item
 * already uses (`useTabsStore`'s `dockTab`, `sourcePaneId === targetPaneId`,
 * `edge: "right"`) — see `split-grid.spec.ts`'s own note on `dockTab`: a
 * non-center edge MOVES the active tab into a brand-new pane, it does not
 * duplicate it, so "same file in two panes" still requires the same
 * reopen-from-tree gesture that spec uses.
 *
 * It is a one-shot split action, not a toggle (mirrors the context menu
 * item, which has no "unsplit" counterpart), and is disabled whenever the
 * underlying action would be a no-op: no real file focused, or the focused
 * pane has only the one tab (`dockTab` itself no-ops there — "nothing
 * would remain in the source pane to split against").
 */
import { test, expect } from "@playwright/test";
import { gotoApp, pane, panes, tab, treeRow, DEFAULT_ACTIVE_PATH } from "./fixtures";

const ARCH = DEFAULT_ACTIVE_PATH; // "vault/notes/architecture.md" — active on boot, alongside other pinned tabs.

function splitButton(page: import("@playwright/test").Page) {
  return page.getByTestId("app-titlebar").getByTestId("titlebar-split");
}

async function currentPaneIds(page: import("@playwright/test").Page): Promise<string[]> {
  return panes(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-pane-id")!));
}

test.describe("title bar split editor button", () => {
  test("splits the focused pane's active tab to the right, same file reachable in both panes", async ({ page }) => {
    await gotoApp(page);
    // Demo boot seeds several pinned tabs (architecture.md active,
    // indexer.ts, vault.config.json, metrics.csv) into the one root pane —
    // more than one tab, so the button starts enabled.
    await expect(splitButton(page)).toBeEnabled();
    await expect(panes(page)).toHaveCount(1);

    await splitButton(page).click();

    await expect(panes(page)).toHaveCount(2);
    const [leftPaneId, rightPaneId] = await currentPaneIds(page);

    // The split moved architecture.md into the new, now-focused right pane
    // — exactly what the equivalent "Split right" context menu item does.
    await expect(tab(page, ARCH, rightPaneId)).toBeVisible();

    // Same file, in both panes at once: focus the left pane and reopen
    // architecture.md from the tree (same gesture `split-grid.spec.ts`
    // uses for its "shares one buffer" assertion).
    await pane(page, leftPaneId).click();
    await treeRow(page, ARCH).click();
    await expect(tab(page, ARCH, leftPaneId)).toBeVisible();
    await expect(tab(page, ARCH, rightPaneId)).toBeVisible();
  });

  test("is disabled when the focused pane has nothing left to split against", async ({ page }) => {
    await gotoApp(page);
    await splitButton(page).click();
    await expect(panes(page)).toHaveCount(2);
    const [, rightPaneId] = await currentPaneIds(page);

    // The new right pane holds only the one tab (architecture.md) the
    // split moved into it — the button should reflect that there's nothing
    // left to split against, same as `dockTab`'s own no-op guard.
    await pane(page, rightPaneId).click();
    await expect(splitButton(page)).toBeDisabled();
  });
});

/**
 * Shared e2e helpers — scoped locators + a boot wait, built around the
 * `data-testid`/`data-tree-path`/`data-tab-path`/`data-pane-id` attributes
 * added in this phase specifically so a spec can target exactly one region
 * instead of a plain-text selector that matches more than one place.
 *
 * The concrete lesson this file encodes: a bare text/role selector for
 * "architecture.md" matches BOTH the sidebar tree row AND the editor tab —
 * a real Phase 6 verification failure (a scripted right-click landed on the
 * tree instead of the tab, and the mismatch wasn't obvious from the
 * failure message). `treeRow()`/`tab()` below make that ambiguity
 * unrepresentable: each returns a locator scoped to exactly one attribute
 * that only one of those two elements carries.
 */
import { expect, type Page } from "@playwright/test";

/** Minimal attribute-selector escaping — this file runs in the Node/test
 * process, not a browser page, so the DOM's `CSS.escape` isn't available
 * here. Every path/id this suite ever selects by is a vault display path
 * (letters, digits, `/`, `.`, `-`, `_`) or a generated pane id from the
 * same alphabet, so escaping just the two characters that would otherwise
 * break out of a `"..."` attribute-selector string is enough. */
function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const ROOT_PANE_ID = "root";

/** Default boot tab (App.tsx's `ACTIVE_ON_BOOT`) — every spec that doesn't
 * care which file is open can wait on this as "the app has finished
 * seeding + restoring its default session." */
export const DEFAULT_ACTIVE_PATH = "vault/notes/architecture.md";

/**
 * Navigates to the app and waits for the boot sequence (idempotent demo
 * vault seed -> fs/git store refresh -> default tabs restored) to finish —
 * auto-waiting on real DOM state (the default tab + its tree row), never a
 * bare timeout. Every spec should start here so it never races the boot
 * effect in `App.tsx`.
 *
 * THE DEMO VAULT IS NOT THE DEFAULT ANY MORE. DESIGN-SPEC Amendments round
 * 5 item 36 made it opt-in: a plain build seeds a single `welcome.md`, and
 * only `VSNOTE_DEMO_VAULT=1` seeds the showcase content this suite asserts
 * against. `package.json`'s `test:e2e` script sets that variable on the
 * `vite build` it runs, which is the ONLY reason `DEFAULT_ACTIVE_PATH` and
 * every tree/git expectation below still hold. If you ever run these specs
 * against a bundle built some other way, set it there too or roughly 18 of
 * the 20 spec files will fail on missing files — and, worse, any spec that
 * merely checks "something rendered" would pass while asserting nothing.
 */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.locator(`[role="tab"][data-tab-path="${DEFAULT_ACTIVE_PATH}"]`).first()).toBeVisible();
  await expect(page.locator(`[data-tree-path="${DEFAULT_ACTIVE_PATH}"]`)).toBeVisible();
}

/** The Explorer tree row for `displayPath` — unambiguous vs. any editor tab
 * showing the same filename. */
export function treeRow(page: Page, displayPath: string) {
  return page.locator(`[data-tree-path="${escapeAttr(displayPath)}"]`);
}

/** The editor tab for `displayPath`. Pass `paneId` when more than one pane
 * might have the file open (split-grid specs) — omitting it matches
 * whichever pane has it (there's usually exactly one). */
export function tab(page: Page, displayPath: string, paneId?: string) {
  const sel = paneId
    ? `[role="tab"][data-tab-path="${escapeAttr(displayPath)}"][data-pane-id="${escapeAttr(paneId)}"]`
    : `[role="tab"][data-tab-path="${escapeAttr(displayPath)}"]`;
  return page.locator(sel);
}

/** Every open pane's own root element — `data-testid="editor-pane"`
 * (EditorPane.tsx), deliberately NOT a bare `[data-pane-id]` selector: each
 * tab's own DOM element (EditorTabBar.tsx) also carries `data-pane-id` (the
 * id of the pane it belongs to, for the drag-to-dock payload), so a bare
 * `[data-pane-id]` query matches every open tab too, not just pane
 * wrappers — a real miscount caught while writing `split-grid.spec.ts`
 * ("expected 2 panes, found 7": 2 wrapper divs + 5 still-open tabs). */
export function panes(page: Page) {
  return page.locator('[data-testid="editor-pane"]');
}

/** A pane's own root element (tab strip + header + content), scoped by
 * pane id — `data-pane-id` (EditorPane.tsx), narrowed to just the pane
 * wrapper (see `panes()` above) so it never also matches a tab. */
export function pane(page: Page, paneId: string) {
  return page.locator(`[data-testid="editor-pane"][data-pane-id="${escapeAttr(paneId)}"]`);
}

/** A pane's content-only region (below its tab bar/header) — useful for
 * scoping a CM6/`renderers/*` query to one pane without also matching its
 * chrome. */
export function paneContent(page: Page, paneId: string) {
  return page.locator(`[data-pane-content="${escapeAttr(paneId)}"]`);
}

/** Opens (single-click preview) a file from the Explorer tree, expanding
 * ancestor folders first if `ancestors` is given (outermost first). */
export async function openFromTree(page: Page, displayPath: string, opts?: { pin?: boolean }): Promise<void> {
  const row = treeRow(page, displayPath);
  if (opts?.pin) {
    await row.dblclick();
  } else {
    await row.click();
  }
}

/** Opens the Settings tab (Phase 6.5c, DESIGN-SPEC Amendments item 11) via
 * the title bar's gear icon — scoped to `app-titlebar` since the activity
 * bar's footer button carries the exact same `aria-label="Settings"`. */
export async function openSettingsTab(page: Page): Promise<void> {
  await page.getByTestId("app-titlebar").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

/** Round 6 item 15 ("clean tree") — git decorations in the Explorer are OFF
 * by default now. Seeds the persisted setting ON before the app boots, for
 * specs whose assertions are about the decorations themselves (letters,
 * strikethrough, deleted-file ghost rows). Call BEFORE `gotoApp`. One spec
 * (`fs-git.spec.ts`'s first test) flips the real Settings switch through
 * the UI instead, covering the toggle end to end; the rest use this seed so
 * they don't all repeat that navigation. */
export async function seedShowGitStatusInExplorer(page: Page): Promise<void> {
  await seedSettings(page, { showGitStatusInExplorer: true });
}

/** Round 7 — seeds arbitrary persisted settings BEFORE first navigation
 * (the store's current persist version, so no migration reinterprets the
 * seeded values). Used e.g. to mark sync setup complete so Git & Sync
 * specs land on the full category instead of the item 52 setup gate. */
export async function seedSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((seeded) => {
    localStorage.setItem("vsnote-settings", JSON.stringify({ state: seeded, version: 4 }));
  }, state);
}

/** Resets in-page state that must not leak across a single spec file's
 * tests when they intentionally share a context (most specs don't — each
 * `test()` gets Playwright's default fresh context/page — but a couple of
 * split-grid tests build on each other within one test body instead). No
 * bare `waitForTimeout`: every wait below is on real, observable state. */
export async function waitForNoDialog(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

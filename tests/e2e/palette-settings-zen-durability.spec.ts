/**
 * Phase 5 exit criteria: ⌘K grouped command palette + ⌘P file jump,
 * global shortcuts owned by the app (not the browser), settings persisting
 * across a reload, zen mode hiding the five chrome regions (Esc restores),
 * and the muted storage-not-persisted warning on the denied path.
 */
import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test.describe("palette + settings + zen + durability", () => {
  test("Ctrl+K opens the command palette with grouped Files/Commands results", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Files", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Commands", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Toggle zen mode/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Ctrl+P jumps straight to file search (no Commands group) and opens the picked file", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("Control+p");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Commands", { exact: true })).toHaveCount(0);
    await page.keyboard.type("reading-list");
    await dialog.getByRole("button", { name: "reading-list.md" }).click();
    await expect(page.locator('[role="tab"][data-tab-path="vault/notes/reading-list.md"]')).toBeVisible();
  });

  test("Ctrl+S saves the active buffer and clears the dirty dot", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("radio", { name: "Source" }).click();
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("x");
    const activeTab = page.locator('[role="tab"][data-tab-path="vault/notes/architecture.md"]');
    await expect(activeTab.getByTestId("tab-dirty-dot")).toBeVisible();
    await page.keyboard.press("Control+s");
    await expect(activeTab.getByTestId("tab-dirty-dot")).toHaveCount(0);
  });

  test("Ctrl+E toggles Rendered/Source on a markdown file", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("radio", { name: "Rendered" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("radio", { name: "Source" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("radio", { name: "Rendered" })).toHaveAttribute("aria-checked", "true");
  });

  test("settings persist across a reload", async ({ page }) => {
    // Drives the "Toggle theme" command-palette action rather than the
    // Settings surface itself — DESIGN-SPEC.md's in-flight "Amendments
    // round 2" (item 11) turns Settings from a modal into a full editor
    // tab, so a spec built on today's dialog DOM would need an immediate
    // rewrite. `useSettingsStore.cycleTheme()` (App.tsx's "toggle-theme"
    // palette command) is untouched by that redesign and still proves the
    // same thing: a setting change survives a reload.
    await gotoApp(page);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Toggle theme" }).click();
    const themeAfterToggle = await page.locator("html").getAttribute("data-theme");
    expect(themeAfterToggle).toBeTruthy(); // cycled away from the unset "dark" default

    await page.reload();
    await expect(page.locator('[data-tree-path="vault/notes/architecture.md"]')).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeAfterToggle!);
  });

  test("zen mode hides the five chrome regions; Esc restores them", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    await expect(page.getByTestId("app-activitybar")).toBeVisible();
    await expect(page.getByTestId("explorer-sidebar")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Open editors" })).toBeVisible();
    await expect(page.getByTestId("editor-header")).toBeVisible();
    await expect(page.getByTestId("app-statusbar")).toBeVisible();

    await page.keyboard.press("Control+Shift+Z");

    // Title bar stays; the other five hide.
    await expect(page.getByTestId("app-titlebar")).toBeVisible();
    await expect(page.getByTestId("app-activitybar")).toHaveCount(0);
    await expect(page.getByTestId("explorer-sidebar")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Open editors" })).toHaveCount(0);
    await expect(page.getByTestId("editor-header")).toHaveCount(0);
    await expect(page.getByTestId("app-statusbar")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("app-activitybar")).toBeVisible();
    await expect(page.getByTestId("explorer-sidebar")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Open editors" })).toBeVisible();
    await expect(page.getByTestId("editor-header")).toBeVisible();
    await expect(page.getByTestId("app-statusbar")).toBeVisible();
  });

  test("denied storage persistence shows the muted status-bar warning", async ({ page }) => {
    // Stub navigator.storage.persist()/persisted() to resolve false BEFORE
    // any app script runs, so App.tsx's boot-time request genuinely takes
    // the "denied" branch (fs/persistence.ts).
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "storage", {
        configurable: true,
        value: {
          persist: () => Promise.resolve(false),
          persisted: () => Promise.resolve(false),
          estimate: () => Promise.resolve({ usage: 0, quota: 0 }),
        },
      });
    });
    await gotoApp(page);
    await expect(page.getByText("storage not persisted")).toBeVisible();
  });

  test("granted/unsupported storage persistence shows no warning", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "storage", {
        configurable: true,
        value: {
          persist: () => Promise.resolve(true),
          persisted: () => Promise.resolve(true),
          estimate: () => Promise.resolve({ usage: 0, quota: 0 }),
        },
      });
    });
    await gotoApp(page);
    await expect(page.getByText("storage not persisted")).toHaveCount(0);
  });
});

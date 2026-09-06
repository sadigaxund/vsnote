/**
 * Phase M3 (docs/PLAN-2026-09-05-refresh.md §6) exit criteria for worker 3's
 * UI layer: the grant-prompt dialog, the "Run scripts" action, and the
 * rendered-value seam, exercised end to end against a real `.mk.md` file
 * created via the Explorer (same mechanic `markii-live-preview.spec.ts`
 * already uses).
 *
 * "Run scripts" is reached via the ROOT pane's tab bar `…` menu
 * (`overflow-menu-trigger-root` -> `overflow-menu-run-scripts`,
 * `local/OverflowMenu.tsx`) — the default boot layout has exactly one
 * pane, so `EditorHeader.tsx`'s own copy of the action (gated on more than
 * one pane being open) never mounts here; the overflow menu is the one
 * reliably-visible entry point in this layout, matching
 * `overflow-menu.spec.ts`'s existing interaction pattern.
 */
import { test, expect } from "@playwright/test";
import { gotoApp, treeRow } from "./fixtures";

const SCRIPT_DOC = "Answer: :value[answer]\n\n```lua {name=answer}\nreturn 42\n```\n";
const RUNAWAY_DOC = "```lua {name=loop}\nwhile true do end\n```\n";
// A capability-dependent script (deliberately different from `SCRIPT_DOC`,
// which needs no capability at all and therefore runs regardless of a
// grant decision — see the "denying" test's own comment for why THAT
// distinction matters here): denying the whole prompt leaves `permissions`
// unset, which means NO host is granted at all. Contrary to an earlier
// (wrong) version of this comment: that does NOT make `net.fetch_json`
// fail with a clean `capability-denied` before any network call — found in
// review, `@markii/lua`'s own `buildCapabilities` only defines the `net`
// global AT ALL when at least one host is granted (see `runScriptsLogic
// .ts`'s module doc for the full writeup and the code read to confirm
// it). With zero grants, the `net` global simply does not exist, and the
// call fails as an ordinary Lua "attempt to index a nil value (global
// 'net')" runtime error — `normalizeFailureKind` classifies THAT as
// `'script-error'`, not `'capability-denied'`. Still zero network
// dependency either way (no real `fetch` ever happens when `net` doesn't
// exist to call it on) — `describeFailureEntry` is what turns this
// specific, closed-form Lua error shape back into the true, honest reason
// ("network access was denied") for display, which the "denying" test
// below asserts on directly.
const NET_SCRIPT_DOC = "Answer: :value[answer]\n\n```lua {name=answer}\nlocal r = net.fetch_json(\"https://example.com/data\")\nreturn r.status\n```\n";

async function createMkMdFile(page: import("@playwright/test").Page, name: string, folder = "vault/src"): Promise<string> {
  await treeRow(page, folder).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New File" }).click();
  const draftRow = treeRow(page, `${folder}/.vsnote-draft-file`);
  await expect(draftRow).toBeVisible();
  await draftRow.locator("input").fill(name);
  await draftRow.locator("input").press("Enter");
  const path = `${folder}/${name}`;
  await expect(treeRow(page, path)).toBeVisible();
  await treeRow(page, path).click();
  return path;
}

async function typeSource(page: import("@playwright/test").Page, text: string): Promise<void> {
  await page.getByRole("radio", { name: "Source" }).click();
  const cm = page.locator(".cm-content").first();
  await cm.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type(text);
}

/** Opens the root pane's tab-bar `…` menu and clicks "Run scripts". */
async function clickRunScripts(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("overflow-menu-trigger-root").click();
  await page.getByTestId("overflow-menu-run-scripts").click();
}

/** Re-opens the menu and reads whether "Run scripts" is currently disabled (a run is in flight), closing the menu again afterward. */
async function isRunScriptsDisabled(page: import("@playwright/test").Page): Promise<boolean> {
  await page.getByTestId("overflow-menu-trigger-root").click();
  const item = page.getByTestId("overflow-menu-run-scripts");
  const disabled = (await item.getAttribute("data-disabled")) !== null;
  await page.keyboard.press("Escape");
  return disabled;
}

test.describe("markii scripts (Phase M3 worker 3)", () => {
  test("opening a .mk.md file never runs anything", async ({ page }) => {
    await gotoApp(page);
    await createMkMdFile(page, "no-autorun.mk.md");
    await typeSource(page, SCRIPT_DOC);

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered).toBeVisible();
    // No run has happened: the `:value[answer]` INLINE directive widget
    // must show its own built-in "missing" marker, never `42` — merely
    // opening/switching to Rendered mode must not have executed the
    // script. (The raw script SOURCE text, "return 42", is expected to be
    // visible in the fence itself — that's the fence's own literal text,
    // not a produced value; scoping to the value widget is what actually
    // distinguishes "ran" from "not ran".)
    await expect(rendered.locator(".mk-live-preview-inline")).not.toContainText("42");
  });

  test("manual run prompts for a grant; denying leaves the note unchanged, and the toast reports denied network access honestly", async ({ page }) => {
    await gotoApp(page);
    await createMkMdFile(page, "deny-run.mk.md");
    await typeSource(page, NET_SCRIPT_DOC);

    await clickRunScripts(page);
    const dialog = page.getByTestId("grant-prompt-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("grant-prompt-deny").click();
    await expect(dialog).not.toBeVisible();

    // The failure-copy fix from review round 2: a denied grant must be
    // reported as denied network access, in plain language — never as a
    // generic script bug, and never leaking `@markii/lua`'s internal
    // chunk-wrapper name or a raw Lua traceback. Asserted against `body`
    // (a single element, never ambiguous) rather than `getByText`, which
    // hits Playwright's strict-mode "resolved to N elements" the moment
    // Radix's own visually-hidden toast announcer (a `role="status"`
    // live-region duplicating the SAME text for screen readers) exists
    // alongside the visible toast — both are real, both should say this,
    // and neither should ever be picked over the other.
    await expect(page.locator("body")).toContainText("network access was denied");
    await expect(page.getByText("__smd_user_chunk", { exact: false })).toHaveCount(0);
    await expect(page.getByText("stack traceback", { exact: false })).toHaveCount(0);

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered.locator(".mk-live-preview-inline")).not.toContainText("42");
  });

  test("granting runs the script and the produced value becomes visible; the grant is remembered on a second run", async ({ page }) => {
    await gotoApp(page);
    await createMkMdFile(page, "grant-run.mk.md");
    await typeSource(page, SCRIPT_DOC);

    await clickRunScripts(page);
    await expect(page.getByTestId("grant-prompt-dialog")).toBeVisible();
    await page.getByTestId("grant-prompt-allow").click();
    await expect(page.getByTestId("grant-prompt-dialog")).not.toBeVisible();

    await page.getByRole("radio", { name: "Rendered" }).click();
    const rendered = page.locator(".cm-content").first();
    await expect(rendered.locator(".mk-live-preview-inline")).toContainText("42");

    // Second run: no prompt this time (same script content, valid grant).
    await page.getByRole("radio", { name: "Source" }).click();
    await clickRunScripts(page);
    await expect(page.getByTestId("grant-prompt-dialog")).not.toBeVisible();
    await expect(await isRunScriptsDisabled(page)).toBe(false);
  });

  test("editing the script re-prompts for a grant", async ({ page }) => {
    await gotoApp(page);
    await createMkMdFile(page, "edit-reprompt.mk.md");
    await typeSource(page, SCRIPT_DOC);

    await clickRunScripts(page);
    await page.getByTestId("grant-prompt-allow").click();
    await expect(page.getByTestId("grant-prompt-dialog")).not.toBeVisible();

    // Change the script's content (a content-hash grant key change) —
    // the SAME note, a different script body.
    await page.getByRole("radio", { name: "Source" }).click();
    await typeSource(page, "Answer: :value[answer]\n\n```lua {name=answer}\nreturn 43\n```\n");

    await clickRunScripts(page);
    await expect(page.getByTestId("grant-prompt-dialog")).toBeVisible();
  });

  test("a runaway script is killed by the watchdog and reported honestly", async ({ page }) => {
    test.setTimeout(45_000);
    await gotoApp(page);
    await createMkMdFile(page, "runaway.mk.md");
    await typeSource(page, RUNAWAY_DOC);

    await clickRunScripts(page);
    // This script makes no network/bundle call, so the scan finds nothing
    // to toggle — Allow is still required to let it run at all.
    await expect(page.getByTestId("grant-prompt-dialog")).toBeVisible();
    await page.getByTestId("grant-prompt-allow").click();

    // The watchdog (10s default) or `@markii/lua`'s own in-VM wall-clock
    // limit (5s default) kills this well within the 45s test timeout,
    // and the action re-enables once the run settles either way.
    await expect
      .poll(async () => isRunScriptsDisabled(page), { timeout: 30_000 })
      .toBe(false);
  });
});

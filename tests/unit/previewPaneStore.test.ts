/**
 * R3-11 — the per-tab Preview-pane view state's reducer
 * (`togglePreviewInTabs`, the pure half of `useTabsStore`'s
 * `togglePreview`): the flag starts closed, the toggle flips exactly one
 * tab, and it lives ON the `OpenTab`, which is what makes "the preview
 * closes when its tab closes" fall out of `closeTab` discarding the entry
 * rather than needing its own cleanup.
 *
 * Deliberately tests the reducer and not the store: `useTabsStore`
 * transitively imports `fs/client.ts`, which instantiates lightning-fs at
 * import time and is barred from the unit suite by
 * `tests/unit/fsIsolation.test.ts`. The store-to-reducer wiring and the
 * toggle's UI are covered end to end by `tests/e2e/preview-pane.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { togglePreviewInTabs, type PreviewTogglableTab } from "../../src/stores/previewViewState";

const A: PreviewTogglableTab = { path: "vault/notes/architecture.md" };
const B: PreviewTogglableTab = { path: "vault/notes/other.md" };

describe("togglePreviewInTabs (R3-11)", () => {
  it("a tab that was never toggled has preview closed", () => {
    expect(A.previewOpen).toBeFalsy();
  });

  it("flips only the targeted tab", () => {
    const once = togglePreviewInTabs([A, B], A.path);
    expect(once.find((t) => t.path === A.path)?.previewOpen).toBe(true);
    expect(once.find((t) => t.path === B.path)?.previewOpen).toBeFalsy();
  });

  it("flips back off, and leaves the tab order alone", () => {
    const twice = togglePreviewInTabs(togglePreviewInTabs([A, B], A.path), A.path);
    expect(twice.map((t) => t.path)).toEqual([A.path, B.path]);
    expect(twice.find((t) => t.path === A.path)?.previewOpen).toBe(false);
  });

  it("returns the same array when no tab matches, so a caller can skip the update", () => {
    const tabs = [A, B];
    expect(togglePreviewInTabs(tabs, "vault/notes/missing.md")).toBe(tabs);
  });
});

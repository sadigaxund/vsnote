/**
 * R3-11 — pins `useTabsStore`'s per-tab Preview-pane view state
 * (`OpenTab.previewOpen` + `togglePreview`): a fresh tab starts with
 * preview closed, the toggle flips it (and only for the targeted tab, not
 * every open tab), and closing the tab discards the flag along with the
 * rest of the tab entry — "closes when the source tab closes" falls out of
 * the flag living ON the `OpenTab`, so this test asserts that by reopening
 * the same path and checking the flag reset to falsy, exactly the
 * behavior a fresh open (never explicitly toggled) already has.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { findLeaf, useTabsStore } from "../../src/stores/useTabsStore";

const FILE_A = { path: "vault/notes/architecture.md", name: "architecture.md", kind: "md" as const };
const FILE_B = { path: "vault/notes/other.md", name: "other.md", kind: "md" as const };

function resetStore(): void {
  useTabsStore.setState({
    tree: { type: "leaf", id: "root", tabs: [], activeTabId: undefined },
    activePaneId: "root",
  });
}

beforeEach(() => {
  resetStore();
});

describe("useTabsStore preview pane view state (R3-11)", () => {
  it("a newly opened tab has preview closed by default", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    const leaf = findLeaf(useTabsStore.getState().tree, "root");
    expect(leaf?.tabs[0]?.previewOpen).toBeFalsy();
  });

  it("togglePreview flips only the targeted tab's flag", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().openFile(FILE_B, { pin: true });

    useTabsStore.getState().togglePreview(FILE_A.path, "root");
    let leaf = findLeaf(useTabsStore.getState().tree, "root");
    expect(leaf?.tabs.find((t) => t.path === FILE_A.path)?.previewOpen).toBe(true);
    expect(leaf?.tabs.find((t) => t.path === FILE_B.path)?.previewOpen).toBeFalsy();

    useTabsStore.getState().togglePreview(FILE_A.path, "root");
    leaf = findLeaf(useTabsStore.getState().tree, "root");
    expect(leaf?.tabs.find((t) => t.path === FILE_A.path)?.previewOpen).toBe(false);
  });

  it("togglePreview defaults to the focused pane when no paneId is given", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().togglePreview(FILE_A.path);
    const leaf = findLeaf(useTabsStore.getState().tree, useTabsStore.getState().activePaneId);
    expect(leaf?.tabs[0]?.previewOpen).toBe(true);
  });

  it("closing a tab and reopening the same path starts with preview closed again", () => {
    useTabsStore.getState().openFile(FILE_A, { pin: true });
    useTabsStore.getState().togglePreview(FILE_A.path, "root");
    expect(findLeaf(useTabsStore.getState().tree, "root")?.tabs[0]?.previewOpen).toBe(true);

    useTabsStore.getState().closeTab(FILE_A.path, "root");
    expect(findLeaf(useTabsStore.getState().tree, "root")?.tabs).toHaveLength(0);

    useTabsStore.getState().openFile(FILE_A, { pin: true });
    expect(findLeaf(useTabsStore.getState().tree, "root")?.tabs[0]?.previewOpen).toBeFalsy();
  });
});

/**
 * Pins `lib/treeFlatten.ts` — the pure flatten/expand-state math
 * `components/local/ExplorerTree.tsx` uses both to decide whether to
 * virtualize (Phase 17 Milestone D, docs/COMPONENT-BACKLOG.md row 25) and,
 * once it does, as the literal windowed row data.
 */
import { describe, expect, it } from "vitest";
import { computeExpanded, defaultExpandedFor, flattenTree, VIRTUALIZE_ROW_THRESHOLD } from "../../src/lib/treeFlatten";
import type { FileNode } from "../../src/types";

function file(id: string, status?: FileNode["status"]): FileNode {
  return { id, name: id.slice(id.lastIndexOf("/") + 1), kind: "md", path: id, type: "file", status };
}

function folder(id: string, children: FileNode[], opts?: { collapsed?: boolean; defaultExpanded?: boolean }): FileNode {
  return {
    id,
    name: id.slice(id.lastIndexOf("/") + 1),
    kind: "folder",
    path: id,
    type: "folder",
    children,
    collapsed: opts?.collapsed,
    defaultExpanded: opts?.defaultExpanded,
  };
}

describe("defaultExpandedFor", () => {
  it("is always false for a file", () => {
    expect(defaultExpandedFor(file("a.md"))).toBe(false);
  });

  it("is true for a plain folder with no collapsed/defaultExpanded flags", () => {
    expect(defaultExpandedFor(folder("src", []))).toBe(true);
  });

  it("is false when collapsed is set", () => {
    expect(defaultExpandedFor(folder("assets", [], { collapsed: true }))).toBe(false);
  });

  it("is false when defaultExpanded is explicitly false", () => {
    expect(defaultExpandedFor(folder("assets", [], { defaultExpanded: false }))).toBe(false);
  });
});

describe("computeExpanded", () => {
  const collapsedFolder = folder("assets", [], { collapsed: true });
  const openFolder = folder("src", []);

  it("falls back to defaultExpandedFor with no options", () => {
    expect(computeExpanded(collapsedFolder)).toBe(false);
    expect(computeExpanded(openFolder)).toBe(true);
  });

  it("an override takes priority over the default", () => {
    expect(computeExpanded(collapsedFolder, { expandOverrides: new Map([["assets", true]]) })).toBe(true);
    expect(computeExpanded(openFolder, { expandOverrides: new Map([["src", false]]) })).toBe(false);
  });

  it("expandAll forces every folder open regardless of override", () => {
    expect(computeExpanded(collapsedFolder, { expandAll: true, expandOverrides: new Map([["assets", false]]) })).toBe(true);
  });

  it("forceExpandId opens exactly that one folder", () => {
    expect(computeExpanded(collapsedFolder, { forceExpandId: "assets" })).toBe(true);
    expect(computeExpanded(openFolder, { forceExpandId: "assets" })).toBe(true); // unaffected, already true by default
  });

  it("autoExpandPath opens exactly that one folder", () => {
    expect(computeExpanded(collapsedFolder, { autoExpandPath: "assets" })).toBe(true);
  });

  it("a file with no forces set computes as not expanded (its default is always false)", () => {
    expect(computeExpanded(file("a.md"))).toBe(false);
  });
});

describe("flattenTree", () => {
  it("flattens a flat list of files with depth 0 and correct posinset/setsize", () => {
    const data = [file("a.md"), file("b.md"), file("c.md")];
    const rows = flattenTree(data);
    expect(rows.map((r) => r.node.id)).toEqual(["a.md", "b.md", "c.md"]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows.map((r) => r.posinset)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.setsize === 3)).toBe(true);
  });

  it("excludes a collapsed folder's children entirely, not just hides them", () => {
    const data = [folder("notes", [file("notes/a.md"), file("notes/b.md")]), folder("assets", [file("assets/x.png")], { collapsed: true })];
    const rows = flattenTree(data);
    // notes/ is open by default (2 files) + assets/ itself, but not
    // assets/x.png.
    expect(rows.map((r) => r.node.id)).toEqual(["notes", "notes/a.md", "notes/b.md", "assets"]);
  });

  it("recurses depth-first, incrementing depth per nesting level", () => {
    const data = [folder("src", [folder("src/lib", [file("src/lib/util.ts")])])];
    const rows = flattenTree(data);
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ["src", 0],
      ["src/lib", 1],
      ["src/lib/util.ts", 2],
    ]);
  });

  it("expandAll reveals a normally-collapsed folder's children", () => {
    const data = [folder("assets", [file("assets/x.png")], { collapsed: true })];
    expect(flattenTree(data).map((r) => r.node.id)).toEqual(["assets"]);
    expect(flattenTree(data, { expandAll: true }).map((r) => r.node.id)).toEqual(["assets", "assets/x.png"]);
  });

  it("expandOverrides toggling a folder closed removes its children from the flattened list", () => {
    const data = [folder("src", [file("src/a.ts")])];
    const opened = flattenTree(data);
    expect(opened.map((r) => r.node.id)).toEqual(["src", "src/a.ts"]);
    const closed = flattenTree(data, { expandOverrides: new Map([["src", false]]) });
    expect(closed.map((r) => r.node.id)).toEqual(["src"]);
  });

  it("computes parentPath as the node's own id for a folder and its parent's for a file", () => {
    const data = [folder("src", [file("src/a.ts")])];
    const rows = flattenTree(data);
    expect(rows.find((r) => r.node.id === "src")?.parentPath).toBe("src");
    expect(rows.find((r) => r.node.id === "src/a.ts")?.parentPath).toBe("src");
  });

  it("a real vault-scale tree (hundreds of files in one open folder) crosses VIRTUALIZE_ROW_THRESHOLD", () => {
    const many = Array.from({ length: 300 }, (_, i) => file(`big/file-${i}.md`));
    const data = [folder("big", many)];
    const rows = flattenTree(data);
    expect(rows.length).toBe(301); // the folder row itself + 300 files
    expect(rows.length).toBeGreaterThan(VIRTUALIZE_ROW_THRESHOLD);
  });

  it("a small demo-vault-sized tree stays under VIRTUALIZE_ROW_THRESHOLD", () => {
    const data = [folder("notes", [file("notes/a.md"), file("notes/b.md")]), folder("src", [file("src/index.ts")]), file("readme.md")];
    expect(flattenTree(data).length).toBeLessThan(VIRTUALIZE_ROW_THRESHOLD);
  });
});

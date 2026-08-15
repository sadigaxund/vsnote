/**
 * `share/folderManifest.ts` — flattening a subtree into manifest entries
 * and exclusion filtering for folder shares (roadmap §5.1).
 */
import { describe, expect, it } from "vitest";
import {
  buildManifestPayload,
  defaultIncludedSet,
  flattenFolderTree,
  includedSetFromManifest,
  relpathsUnderFolder,
  type FolderSourceNode,
} from "../../src/share/folderManifest";

const TREE: FolderSourceNode[] = [
  { name: "a.md", type: "file" },
  {
    name: "sub",
    type: "folder",
    children: [
      { name: "b.md", type: "file" },
      { name: "nested", type: "folder", children: [{ name: "c.md", type: "file" }] },
    ],
  },
  { name: "empty-dir", type: "folder", children: [] },
];

describe("flattenFolderTree()", () => {
  it("collects every file's relpath, skipping folders themselves", () => {
    expect(flattenFolderTree(TREE)).toEqual([{ relpath: "a.md" }, { relpath: "sub/b.md" }, { relpath: "sub/nested/c.md" }]);
  });

  it("returns nothing for an empty tree", () => {
    expect(flattenFolderTree([])).toEqual([]);
  });

  it("handles a folder with no children key at all", () => {
    expect(flattenFolderTree([{ name: "x", type: "folder" }])).toEqual([]);
  });
});

describe("defaultIncludedSet()", () => {
  it("includes every entry by default", () => {
    const entries = flattenFolderTree(TREE);
    const set = defaultIncludedSet(entries);
    expect(set.size).toBe(3);
    expect(set.has("sub/nested/c.md")).toBe(true);
  });
});

describe("relpathsUnderFolder()", () => {
  it("finds every file relpath nested under a folder prefix", () => {
    const entries = flattenFolderTree(TREE);
    expect(relpathsUnderFolder(entries, "sub")).toEqual(["sub/b.md", "sub/nested/c.md"]);
  });

  it("does not false-positive on a sibling with a shared string prefix", () => {
    const entries = [{ relpath: "sub.md" }, { relpath: "sub/b.md" }];
    expect(relpathsUnderFolder(entries, "sub")).toEqual(["sub/b.md"]);
  });

  it("returns an empty array for a folder with no files", () => {
    const entries = flattenFolderTree(TREE);
    expect(relpathsUnderFolder(entries, "empty-dir")).toEqual([]);
  });
});

describe("buildManifestPayload()", () => {
  const entries = flattenFolderTree(TREE);

  it("includes only checked entries, paired with their uploaded blob id", () => {
    const included = new Set(["a.md", "sub/b.md", "sub/nested/c.md"]);
    const blobs = new Map([
      ["a.md", "blob-a"],
      ["sub/b.md", "blob-b"],
      ["sub/nested/c.md", "blob-c"],
    ]);
    expect(buildManifestPayload(entries, included, blobs)).toEqual([
      { relpath: "a.md", blob_id: "blob-a" },
      { relpath: "sub/b.md", blob_id: "blob-b" },
      { relpath: "sub/nested/c.md", blob_id: "blob-c" },
    ]);
  });

  it("EXCLUDES an unchecked entry entirely — absent, not merely flagged", () => {
    const included = new Set(["a.md", "sub/nested/c.md"]); // "sub/b.md" unchecked
    const blobs = new Map([
      ["a.md", "blob-a"],
      ["sub/nested/c.md", "blob-c"],
    ]);
    const payload = buildManifestPayload(entries, included, blobs);
    expect(payload.map((e) => e.relpath)).not.toContain("sub/b.md");
    expect(payload).toHaveLength(2);
  });

  it("throws if an included relpath has no uploaded blob (caller bug, not a silent drop)", () => {
    const included = new Set(["a.md"]);
    expect(() => buildManifestPayload(entries, included, new Map())).toThrow(/Missing uploaded blob/);
  });
});

describe("includedSetFromManifest()", () => {
  it("treats every manifest relpath as included", () => {
    const set = includedSetFromManifest(["a.md", "sub/b.md"]);
    expect(set.has("a.md")).toBe(true);
    expect(set.has("sub/nested/c.md")).toBe(false);
  });
});

/**
 * DESIGN-SPEC Amendments round 5 item 39 — pure-logic coverage for
 * `fs/importEntries.ts` (OS drag-drop + Ctrl+V paste import). Deliberately
 * exercises only the pure/byte-free helpers (naming scheme, conflict
 * planning, directory-entry flattening, clipboard extraction) with plain
 * fakes — no real lightning-fs/IndexedDB involved, matching this suite's
 * `environment: "node"` (see `vitest.config.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  extractClipboardFiles,
  flattenDataTransferItems,
  flattenEntry,
  nextAvailableName,
  planImportPaths,
  timestampedImageName,
  type DataTransferItemLike,
  type FileSystemDirectoryEntryLike,
  type FileSystemEntryLike,
  type FileSystemFileEntryLike,
  type FlattenedEntry,
  type ImportableFile,
} from "../../src/fs/importEntries";

function fakeFile(name: string, type = "text/plain", contents = "hello"): ImportableFile {
  const bytes = new TextEncoder().encode(contents);
  return {
    name,
    type,
    async arrayBuffer() {
      return bytes.buffer as ArrayBuffer;
    },
  };
}

function fileEntry(name: string, file: ImportableFile): FileSystemFileEntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file(success) {
      success(file);
    },
  };
}

function dirEntry(name: string, children: FileSystemEntryLike[]): FileSystemDirectoryEntryLike {
  let delivered = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      return {
        readEntries(success) {
          // Simulates the real DirectoryReader contract: keep returning
          // entries until a batch comes back empty.
          if (delivered) {
            success([]);
            return;
          }
          delivered = true;
          success(children);
        },
      };
    },
  };
}

describe("nextAvailableName (conflict rename scheme)", () => {
  it("returns the name unchanged when there is no collision", () => {
    expect(nextAvailableName(new Set(["other.md"]), "notes.md")).toBe("notes.md");
  });

  it("appends -1 on a single collision, preserving the extension", () => {
    expect(nextAvailableName(new Set(["notes.md"]), "notes.md")).toBe("notes-1.md");
  });

  it("walks past multiple existing suffixes to the next free one", () => {
    const existing = new Set(["notes.md", "notes-1.md", "notes-2.md"]);
    expect(nextAvailableName(existing, "notes.md")).toBe("notes-3.md");
  });

  it("handles extensionless names", () => {
    expect(nextAvailableName(new Set(["README"]), "README")).toBe("README-1");
  });
});

describe("planImportPaths (rename/replace conflict resolution)", () => {
  const entries: FlattenedEntry[] = [
    { relativePath: "notes.md", file: fakeFile("notes.md") },
    { relativePath: "photo.png", file: fakeFile("photo.png", "image/png") },
  ];

  it("replace mode writes every entry to its original intended path", () => {
    const existing = new Set(["/vault/notes.md"]);
    const plan = planImportPaths("/vault", entries, existing, "replace");
    expect(plan.map((p) => p.targetFsPath)).toEqual(["/vault/notes.md", "/vault/photo.png"]);
    expect(plan[0].conflicted).toBe(true);
    expect(plan[1].conflicted).toBe(false);
  });

  it("rename mode renames only the conflicting entry, to a non-colliding name", () => {
    const existing = new Set(["/vault/notes.md"]);
    const plan = planImportPaths("/vault", entries, existing, "rename");
    expect(plan[0].targetFsPath).toBe("/vault/notes-1.md");
    expect(plan[0].conflicted).toBe(true);
    // The sibling with no conflict must be completely untouched.
    expect(plan[1].targetFsPath).toBe("/vault/photo.png");
    expect(plan[1].conflicted).toBe(false);
  });

  it("does not corrupt an unrelated sibling path in a different directory", () => {
    // A same-named file already exists under a DIFFERENT folder — must not
    // influence the rename decision for the one actually being imported.
    const existing = new Set(["/vault/other-folder/notes.md", "/vault/notes.md"]);
    const plan = planImportPaths("/vault", entries, existing, "rename");
    expect(plan[0].targetFsPath).toBe("/vault/notes-1.md");
    // The unrelated sibling path itself must still be exactly as given,
    // never mutated/renamed as a side effect.
    expect(existing.has("/vault/other-folder/notes.md")).toBe(true);
  });

  it("resolves two same-named entries within one batch without colliding", () => {
    const dup: FlattenedEntry[] = [
      { relativePath: "dup.txt", file: fakeFile("dup.txt") },
      { relativePath: "dup.txt", file: fakeFile("dup.txt") },
    ];
    const plan = planImportPaths("/vault", dup, new Set(), "rename");
    expect(plan.map((p) => p.targetFsPath)).toEqual(["/vault/dup.txt", "/vault/dup-1.txt"]);
  });
});

describe("timestampedImageName (bare pasted image)", () => {
  it("produces a stable, timestamped, extension-correct name", () => {
    const name = timestampedImageName("image/png", new Date(2026, 7, 17, 14, 32, 9));
    expect(name).toBe("Pasted image 20260817-143209.png");
  });

  it("maps unknown mime types to a .png fallback rather than throwing", () => {
    const name = timestampedImageName("application/octet-stream", new Date(2026, 0, 1, 0, 0, 0));
    expect(name.endsWith(".png")).toBe(true);
  });
});

describe("flattenEntry (directory-entry traversal)", () => {
  it("flattens a single file entry to its own name", async () => {
    const result = await flattenEntry(fileEntry("solo.md", fakeFile("solo.md")));
    expect(result).toEqual([{ relativePath: "solo.md", file: expect.objectContaining({ name: "solo.md" }) }]);
  });

  it("flattens nested folders into correct relative vault paths", async () => {
    const inner = dirEntry("inner", [fileEntry("deep.txt", fakeFile("deep.txt"))]);
    const outer = dirEntry("outer", [fileEntry("top.txt", fakeFile("top.txt")), inner]);
    const result = await flattenEntry(outer);
    const paths = result.map((r) => r.relativePath).sort();
    expect(paths).toEqual(["outer/inner/deep.txt", "outer/top.txt"]);
  });
});

describe("flattenDataTransferItems (OS drag-drop, graceful degradation)", () => {
  it("uses webkitGetAsEntry when available, preserving folder structure", async () => {
    const dir = dirEntry("assets", [fileEntry("a.png", fakeFile("a.png", "image/png"))]);
    const items: DataTransferItemLike[] = [
      {
        kind: "file",
        getAsFile: () => fakeFile("a.png", "image/png"),
        webkitGetAsEntry: () => dir,
      },
    ];
    const result = await flattenDataTransferItems(items);
    expect(result).toEqual([{ relativePath: "assets/a.png", file: expect.objectContaining({ name: "a.png" }) }]);
  });

  it("falls back to a flat file when webkitGetAsEntry is unavailable", async () => {
    const items: DataTransferItemLike[] = [
      {
        kind: "file",
        getAsFile: () => fakeFile("loose.txt"),
        // No webkitGetAsEntry at all, simulating a browser without support.
      },
    ];
    const result = await flattenDataTransferItems(items);
    expect(result).toEqual([{ relativePath: "loose.txt", file: expect.objectContaining({ name: "loose.txt" }) }]);
  });

  it("skips non-file items instead of throwing", async () => {
    const items: DataTransferItemLike[] = [{ kind: "string", getAsFile: () => null }];
    await expect(flattenDataTransferItems(items)).resolves.toEqual([]);
  });
});

describe("extractClipboardFiles (Ctrl+V paste, graceful clipboard handling)", () => {
  it("returns an empty array for a null clipboardData, never throwing", () => {
    expect(() => extractClipboardFiles(null)).not.toThrow();
    expect(extractClipboardFiles(null)).toEqual([]);
  });

  it("returns an empty array when items is missing, never throwing", () => {
    expect(extractClipboardFiles({})).toEqual([]);
  });

  it("returns an empty array for an empty items list", () => {
    expect(extractClipboardFiles({ items: [] })).toEqual([]);
  });

  it("keeps a real filename for a Chromium-style pasted file", () => {
    const result = extractClipboardFiles({
      items: [{ kind: "file", getAsFile: () => fakeFile("report.pdf", "application/pdf") }],
    });
    expect(result).toEqual([{ relativePath: "report.pdf", file: expect.objectContaining({ name: "report.pdf" }) }]);
  });

  it("gives a bare (nameless) pasted image a timestamped filename", () => {
    const now = new Date(2026, 7, 17, 9, 5, 1);
    const result = extractClipboardFiles(
      { items: [{ kind: "file", getAsFile: () => fakeFile("", "image/png") }] },
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("Pasted image 20260817-090501.png");
  });

  it("treats Chromium's generic 'image.png' screenshot name as a bare image", () => {
    // Regression, caught by pasting into a real Chromium: browsers hand a
    // pasted SCREENSHOT to the page as a File named exactly "image.png", not
    // as a nameless one. Gating the timestamp on an empty name alone meant
    // the timestamp never applied to the case item 39 wrote it for, and every
    // screenshot pasted into one folder collided on the same filename.
    const now = new Date(2026, 7, 17, 9, 5, 1);
    const result = extractClipboardFiles(
      { items: [{ kind: "file", getAsFile: () => fakeFile("image.png", "image/png") }] },
      now,
    );
    expect(result[0].relativePath).toBe("Pasted image 20260817-090501.png");
  });

  it("keeps a real filename that merely looks image-ish, and any non-image name", () => {
    const now = new Date(2026, 7, 17, 9, 5, 1);
    const kept = extractClipboardFiles(
      {
        items: [
          { kind: "file", getAsFile: () => fakeFile("image.png.md", "text/markdown") },
          { kind: "file", getAsFile: () => fakeFile("diagram.png", "image/png") },
          { kind: "file", getAsFile: () => fakeFile("image.png", "text/plain") },
        ],
      },
      now,
    );
    expect(kept.map((e) => e.relativePath)).toEqual(["image.png.md", "diagram.png", "image.png"]);
  });

  it("does not throw when getAsFile itself throws (permission-denied-like read)", () => {
    const items: DataTransferItemLike[] = [
      {
        kind: "file",
        getAsFile: () => {
          throw new Error("NotAllowedError");
        },
      },
    ];
    expect(() => extractClipboardFiles({ items })).not.toThrow();
    expect(extractClipboardFiles({ items })).toEqual([]);
  });
});

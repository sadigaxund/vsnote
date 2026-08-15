/**
 * Pins `components/local/FileIcon.tsx`'s curated-table resolution order
 * (its own header doc): `fileNames[basename]` -> longest matching
 * `fileExtensions` suffix ("a.b.c" tries "b.c" before "c") -> the kind's
 * representative-extension fallback -> the curated pack's generic default.
 * Tests the pure resolver functions directly — no React render needed.
 */
import { describe, expect, it } from "vitest";
import { resolveFileIconCurated, resolveFolderIconCurated } from "../../src/components/local/resolveIcon";
import { curatedManifest } from "../../src/components/local/materialIcons.curated";

describe("resolveFileIconCurated", () => {
  it("matches a curated fileName exactly (case-insensitive), highest priority", () => {
    const result = resolveFileIconCurated("Package.json", "json");
    expect(result).toEqual({ key: "nodejs", matched: true });
  });

  it("falls back to the longest matching extension when no fileName hit", () => {
    // "architecture.md" IS a curated fileName (-> "architecture"), so use a
    // name that only hits on extension to isolate that tier.
    expect(resolveFileIconCurated("notes.md", "md")).toEqual({ key: "markdown", matched: true });
  });

  it("tries the longest dotted extension suffix first, falling through to shorter ones", () => {
    // "foo.spec.ts": the curated table has no compound "spec.ts" entry, so
    // resolution must try that longer suffix, fail, and fall through to the
    // shorter "ts" suffix rather than stopping (or matching the wrong tier)
    // after the first miss — pinning the *order* the header doc promises
    // ("longest matching extension first: 'a.b.c' tries 'b.c' before 'c'").
    expect(resolveFileIconCurated("foo.spec.ts", "unknown")).toEqual({ key: "typescript", matched: true });
  });

  it("falls back to the file kind's representative extension when name/extension both miss", () => {
    // A name with an extension the curated table doesn't recognize at all,
    // but a kind ("md") whose KIND_FALLBACK_EXT maps to a curated extension.
    expect(resolveFileIconCurated("mystery.xyz123", "md")).toEqual({ key: "markdown", matched: true });
  });

  it("falls all the way through to the generic default when nothing matches", () => {
    const result = resolveFileIconCurated("mystery.xyz123", "unknown");
    expect(result).toEqual({ key: curatedManifest.file, matched: false });
  });

  it("handles no name at all (falls back to kind, then default)", () => {
    expect(resolveFileIconCurated(undefined, "json")).toEqual({ key: "json", matched: true });
    expect(resolveFileIconCurated(undefined, "unknown")).toEqual({ key: curatedManifest.file, matched: false });
  });
});

describe("resolveFolderIconCurated", () => {
  it("matches a curated folder name, closed vs. open", () => {
    expect(resolveFolderIconCurated("src", false)).toEqual({ key: "folder-src", matched: true });
    expect(resolveFolderIconCurated("src", true)).toEqual({ key: "folder-src-open", matched: true });
  });

  it("is case-insensitive", () => {
    expect(resolveFolderIconCurated("SRC", false)).toEqual({ key: "folder-src", matched: true });
  });

  it("falls back to the generic folder/folder-open default for an unmatched name", () => {
    expect(resolveFolderIconCurated("some-random-folder", false)).toEqual({
      key: curatedManifest.folder,
      matched: false,
    });
    expect(resolveFolderIconCurated("some-random-folder", true)).toEqual({
      key: curatedManifest.folderExpanded,
      matched: false,
    });
  });
});

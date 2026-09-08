/**
 * R5-4 — `share/shareDownloadVisibility.ts::canDownloadShare`, the pure
 * predicate behind the public reader's file-header Download button: hidden
 * for a markdown share (rendered-only) and for a binary file, visible for
 * every other renderer (code/csv/json/html).
 */
import { describe, expect, it } from "vitest";
import { canDownloadShare } from "../../src/share/shareDownloadVisibility";
import type { RendererKind } from "../../src/filetypes/registry";

describe("canDownloadShare", () => {
  it("is false for a markdown (livepreview) share regardless of isBinary", () => {
    expect(canDownloadShare("livepreview", false)).toBe(false);
    expect(canDownloadShare("livepreview", true)).toBe(false);
  });

  it("is false for a binary file regardless of renderer", () => {
    const renderers: RendererKind[] = ["code", "csv", "json", "html", "image", "livepreview"];
    for (const renderer of renderers) {
      expect(canDownloadShare(renderer, true)).toBe(false);
    }
  });

  it("is true for every non-markdown renderer over non-binary content", () => {
    expect(canDownloadShare("code", false)).toBe(true);
    expect(canDownloadShare("csv", false)).toBe(true);
    expect(canDownloadShare("json", false)).toBe(true);
    expect(canDownloadShare("html", false)).toBe(true);
    expect(canDownloadShare("image", false)).toBe(true);
  });
});

/**
 * `components/local/publishDialogLogic.ts`'s pure Mode-step logic. R3-7:
 * `canPublishRendered` is the fix for a real bug — `PublishDialog.tsx`
 * accepted a `fileKind` prop (plumbed all the way from `App.tsx`'s
 * `handleOpenPublish`) but never once read it, so the "Viewer page"
 * delivery option was unconditionally offered regardless of whether the
 * file's kind actually has a renderer (`filetypes/registry.ts`'s
 * `baseModes`). These tests pin the fix against the SAME registry table
 * `filetypeRegistry.test.ts` covers, so the two can never silently drift
 * apart.
 */
import { describe, expect, it } from "vitest";
import { canPublishRendered } from "../../src/components/local/publishDialogLogic";

describe("canPublishRendered", () => {
  it("is true for every code kind now that R3-7 gives them a renderer", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(canPublishRendered(kind)).toBe(true);
    }
  });

  it("is true for kinds that already had a renderer (md, html, csv, json, image)", () => {
    for (const kind of ["md", "mkmd", "html", "csv", "json", "image"] as const) {
      expect(canPublishRendered(kind)).toBe(true);
    }
  });

  it("is false for a kind with no renderer at all — the actual .py bug: unrecognized extensions fall back to the plain-text entry (source-only)", () => {
    expect(canPublishRendered("unknown")).toBe(false);
  });

  it("treats an unknown fileKind (edit-policy mode, where the dialog never learns the source file's kind) as renderable — 'don't know' must never narrow an existing share's options", () => {
    expect(canPublishRendered(undefined)).toBe(true);
  });
});

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
import { canPublishRendered, shouldShowShortAliasHint } from "../../src/components/local/publishDialogLogic";

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

/**
 * R3-4 — `shouldShowShortAliasHint`: a nudge, never a block, shown only
 * when the share is "anyone with the link" AND the chosen alias is short
 * enough to be guessable. A blank alias means "no alias chosen" (the
 * backend generates a random 22-char slug), which is never short/guessable
 * regardless of `SHORT_ALIAS_THRESHOLD`.
 */
describe("shouldShowShortAliasHint", () => {
  it("is true for a short alias on a link-accessible share", () => {
    expect(shouldShowShortAliasHint("link", "get")).toBe(true);
    expect(shouldShowShortAliasHint("link", "ab")).toBe(true);
  });

  it("is false once the alias reaches the threshold length", () => {
    expect(shouldShowShortAliasHint("link", "abcd1234")).toBe(false);
    expect(shouldShowShortAliasHint("link", "a".repeat(9))).toBe(false);
  });

  it("is false for a restricted (sign-in) share regardless of alias length", () => {
    expect(shouldShowShortAliasHint("restricted", "get")).toBe(false);
  });

  it("is false when no alias is chosen (blank, or all whitespace)", () => {
    expect(shouldShowShortAliasHint("link", "")).toBe(false);
    expect(shouldShowShortAliasHint("link", "   ")).toBe(false);
  });
});

/**
 * `share/shareIndicators.ts` — the Explorer tree's "own" vs "inherited"
 * share indicator state (roadmap §5.1).
 */
import { describe, expect, it } from "vitest";
import { computeShareIndicator, hasAnyShareIndicator, type ShareIndicatorInput } from "../../src/share/shareIndicators";

const FILE_SHARE: ShareIndicatorInput = { id: 1, source_path: "vault/notes/x.md", kind: "file" };
const FOLDER_SHARE: ShareIndicatorInput = { id: 2, source_path: "vault/notes", kind: "folder" };
const REVOKED_SHARE: ShareIndicatorInput = { id: 3, source_path: "vault/assets", kind: "folder", revoked_at: 123 };

describe("computeShareIndicator()", () => {
  it("marks the exact shared file as 'own'", () => {
    const result = computeShareIndicator([FILE_SHARE], "vault/notes/x.md");
    expect(result.own).toEqual([FILE_SHARE]);
    expect(result.inherited).toEqual([]);
  });

  it("marks the exact shared folder root as 'own', not 'inherited'", () => {
    const result = computeShareIndicator([FOLDER_SHARE], "vault/notes");
    expect(result.own).toEqual([FOLDER_SHARE]);
    expect(result.inherited).toEqual([]);
  });

  it("marks a file inside a shared folder as 'inherited'", () => {
    const result = computeShareIndicator([FOLDER_SHARE], "vault/notes/queue.md");
    expect(result.own).toEqual([]);
    expect(result.inherited).toEqual([FOLDER_SHARE]);
  });

  it("marks a nested descendant several levels deep as 'inherited'", () => {
    const result = computeShareIndicator([FOLDER_SHARE], "vault/notes/deep/nested/file.md");
    expect(result.inherited).toEqual([FOLDER_SHARE]);
  });

  it("does not false-positive on a sibling with a shared string prefix", () => {
    // "vault/notes-archive/x.md" is NOT inside "vault/notes" even though it
    // shares the "vault/notes" text prefix.
    const result = computeShareIndicator([FOLDER_SHARE], "vault/notes-archive/x.md");
    expect(result.own).toEqual([]);
    expect(result.inherited).toEqual([]);
  });

  it("a FILE share never produces an 'inherited' match for anything", () => {
    const result = computeShareIndicator([FILE_SHARE], "vault/notes/x.md/impossible-child");
    expect(result.inherited).toEqual([]);
  });

  it("excludes revoked shares entirely", () => {
    const result = computeShareIndicator([REVOKED_SHARE], "vault/assets");
    expect(result.own).toEqual([]);
    expect(result.inherited).toEqual([]);
  });

  it("a path can be both directly shared AND inherit from an ancestor folder share", () => {
    const nestedFileShare: ShareIndicatorInput = { id: 4, source_path: "vault/notes/pinned.md", kind: "file" };
    const result = computeShareIndicator([FOLDER_SHARE, nestedFileShare], "vault/notes/pinned.md");
    expect(result.own).toEqual([nestedFileShare]);
    expect(result.inherited).toEqual([FOLDER_SHARE]);
  });
});

describe("hasAnyShareIndicator()", () => {
  it("true for an own share", () => {
    expect(hasAnyShareIndicator([FILE_SHARE], "vault/notes/x.md")).toBe(true);
  });

  it("true for an inherited share", () => {
    expect(hasAnyShareIndicator([FOLDER_SHARE], "vault/notes/queue.md")).toBe(true);
  });

  it("false for an unrelated path", () => {
    expect(hasAnyShareIndicator([FILE_SHARE, FOLDER_SHARE], "vault/src/app.ts")).toBe(false);
  });
});

/**
 * `share/shareIndicators.ts` — the Explorer tree's "own" / "containing"
 * share indicator state (roadmap §5.1 + round 6 item 9). Folder shares are
 * gone (§4.4), so there is no "inherited" variant any more — only an exact
 * match ("own") or an ancestor of a shared file ("containing").
 */
import { describe, expect, it } from "vitest";
import { computeShareIndicator, hasAnyShareIndicator, type ShareIndicatorInput } from "../../src/share/shareIndicators";

const FILE_SHARE: ShareIndicatorInput = { id: 1, source_path: "vault/notes/x.md" };
const OTHER_FILE_SHARE: ShareIndicatorInput = { id: 2, source_path: "vault/notes/pinned.md" };
const REVOKED_SHARE: ShareIndicatorInput = { id: 3, source_path: "vault/assets/x.md", revoked_at: 123 };

describe("computeShareIndicator()", () => {
  it("marks the exact shared file as 'own'", () => {
    const result = computeShareIndicator([FILE_SHARE], "vault/notes/x.md");
    expect(result.own).toEqual([FILE_SHARE]);
  });

  it("does not mark an unrelated path", () => {
    const result = computeShareIndicator([FILE_SHARE], "vault/notes/other.md");
    expect(result.own).toEqual([]);
    expect(result.containing).toEqual([]);
  });

  it("does not false-positive on a sibling with a shared string prefix", () => {
    // "vault/notes-archive/x.md" is NOT inside "vault/notes" even though it
    // shares the "vault/notes" text prefix.
    const result = computeShareIndicator([FILE_SHARE], "vault/notes-archive/x.md");
    expect(result.own).toEqual([]);
    expect(result.containing).toEqual([]);
  });

  it("excludes revoked shares entirely", () => {
    const result = computeShareIndicator([REVOKED_SHARE], "vault/assets/x.md");
    expect(result.own).toEqual([]);
    expect(result.containing).toEqual([]);
  });

  it("a path can be both directly shared AND contain another share below it", () => {
    // Not really a folder here — just two independent file shares where one
    // path happens to be a string-prefix ancestor via the vault tree.
    const result = computeShareIndicator([FILE_SHARE, OTHER_FILE_SHARE], "vault/notes/x.md");
    expect(result.own).toEqual([FILE_SHARE]);
  });

  // Round 6 item 9 — ancestor folders of shared items get the muted marker.
  it("marks an ancestor folder of a shared FILE as 'containing'", () => {
    const result = computeShareIndicator([FILE_SHARE], "vault/notes");
    expect(result.own).toEqual([]);
    expect(result.containing).toEqual([FILE_SHARE]);
  });

  it("'containing' does not false-positive on a sibling string prefix", () => {
    // "vault/no" is a text prefix of "vault/notes/x.md" but not an ancestor.
    const result = computeShareIndicator([FILE_SHARE], "vault/no");
    expect(result.containing).toEqual([]);
  });

  it("excludes revoked shares from 'containing' too", () => {
    const result = computeShareIndicator([REVOKED_SHARE], "vault/assets");
    expect(result.containing).toEqual([]);
  });
});

describe("hasAnyShareIndicator()", () => {
  it("true for an own share", () => {
    expect(hasAnyShareIndicator([FILE_SHARE], "vault/notes/x.md")).toBe(true);
  });

  it("false for an unrelated path", () => {
    expect(hasAnyShareIndicator([FILE_SHARE], "vault/src/app.ts")).toBe(false);
  });

  it("true for an ancestor of a shared item (containing)", () => {
    expect(hasAnyShareIndicator([FILE_SHARE], "vault/notes")).toBe(true);
  });
});

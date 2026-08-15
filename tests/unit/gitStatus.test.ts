/**
 * Pins `git/status.ts`'s `classify()` — the pure head/workdir/stage ->
 * M/A/D/U mapping every tree letter, badge count, and Source Control row in
 * the app derives from (`computeStatus()` just walks `git.statusMatrix()`
 * rows through this one function). Testing `classify` directly means this
 * suite doesn't need a real git repo to pin the vocabulary itself — the e2e
 * `fs-git.spec.ts` covers the real `statusMatrix()` integration end to end.
 */
import { describe, expect, it } from "vitest";
import { classify } from "../../src/git/status";

describe("git status classify()", () => {
  it("maps untracked (head=0, workdir=2, stage=0) to U", () => {
    expect(classify(0, 2, 0)).toBe("U");
  });

  it("maps new+staged (head=0, workdir=2, stage=2) to A", () => {
    expect(classify(0, 2, 2)).toBe("A");
  });

  it("maps deleted (head=1, workdir=0) to D regardless of stage", () => {
    expect(classify(1, 0, 0)).toBe("D");
    expect(classify(1, 0, 1)).toBe("D");
    expect(classify(1, 0, 2)).toBe("D");
  });

  it("maps modified (head=1, workdir=2) to M regardless of stage", () => {
    expect(classify(1, 2, 0)).toBe("M");
    expect(classify(1, 2, 1)).toBe("M");
    expect(classify(1, 2, 2)).toBe("M");
  });

  it("leaves unmodified (head=1, workdir=1, stage=1) with no letter", () => {
    expect(classify(1, 1, 1)).toBeUndefined();
  });

  it("leaves absent-everywhere (head=0, workdir=0, stage=0) with no letter", () => {
    expect(classify(0, 0, 0)).toBeUndefined();
  });
});

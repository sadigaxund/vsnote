/**
 * Pins `git/mergeLogic.ts`'s pure logic (Phase 11 — real sync, roadmap
 * §5.2): per-file three-way merge classification (the auto-merge policy's
 * decision table — "remote-only-changed files take remote, local-only-
 * changed keep local, both-changed get content-level diff3"), the diff3
 * wrapper's clean-vs-conflict output, and backup-ref prune-to-5 selection.
 * No `isomorphic-git`/`fs` involved — `sync.ts`'s async I/O around this is
 * covered by the e2e suite (`tests/e2e/git-sync.spec.ts`) against a real
 * repo/remote, same split `gitSync.test.ts` documents for the
 * fast-forward-only policy.
 */
import { describe, expect, it } from "vitest";
import { classifyFileMerge, selectBackupRefsToDelete, threeWayMergeText } from "../../src/git/mergeLogic";

describe("classifyFileMerge() — three-way per-file classification", () => {
  it("is clean/unchanged when neither side touched the file", () => {
    expect(classifyFileMerge("same", "same", "same")).toEqual({ outcome: "clean", content: "same" });
  });

  it("takes remote when only remote changed it (local-unchanged)", () => {
    expect(classifyFileMerge("base", "base", "remote edit")).toEqual({ outcome: "clean", content: "remote edit" });
  });

  it("keeps local when only local changed it (remote-unchanged)", () => {
    expect(classifyFileMerge("base", "local edit", "base")).toEqual({ outcome: "clean", content: "local edit" });
  });

  it("is clean when both sides made the IDENTICAL edit", () => {
    expect(classifyFileMerge("base", "same edit", "same edit")).toEqual({ outcome: "clean", content: "same edit" });
  });

  it("takes remote's brand-new file when only remote added it", () => {
    expect(classifyFileMerge(undefined, undefined, "new content")).toEqual({ outcome: "clean", content: "new content" });
  });

  it("keeps local's brand-new file when only local added it", () => {
    expect(classifyFileMerge(undefined, "new content", undefined)).toEqual({ outcome: "clean", content: "new content" });
  });

  it("is clean when only remote deleted the file (local left it untouched)", () => {
    expect(classifyFileMerge("base", "base", undefined)).toEqual({ outcome: "clean", content: null });
  });

  it("is clean when only local deleted the file (remote left it untouched)", () => {
    expect(classifyFileMerge("base", undefined, "base")).toEqual({ outcome: "clean", content: null });
  });

  it("is clean when both sides deleted the file", () => {
    expect(classifyFileMerge("base", undefined, undefined)).toEqual({ outcome: "clean", content: null });
  });

  it("is a delete conflict when local deleted but remote kept editing", () => {
    const result = classifyFileMerge("base", undefined, "remote still editing");
    expect(result).toEqual({ outcome: "conflict", kind: "delete", base: "base", ours: undefined, theirs: "remote still editing" });
  });

  it("is a delete conflict when remote deleted but local kept editing", () => {
    const result = classifyFileMerge("base", "local still editing", undefined);
    expect(result).toEqual({ outcome: "conflict", kind: "delete", base: "base", ours: "local still editing", theirs: undefined });
  });

  it("auto-merges disjoint edits to different lines via diff3 (content-level, no true conflict)", () => {
    const base = "line1\nline2\nline3\n";
    const ours = "line1 MINE\nline2\nline3\n";
    const theirs = "line1\nline2\nline3 THEIRS\n";
    const result = classifyFileMerge(base, ours, theirs);
    expect(result.outcome).toBe("clean");
    if (result.outcome === "clean") {
      expect(result.content).toBe("line1 MINE\nline2\nline3 THEIRS\n");
    }
  });

  it("is a true content conflict when both sides edit the SAME line differently", () => {
    const base = "line1\nline2\nline3\n";
    const ours = "line1\nline2 MINE\nline3\n";
    const theirs = "line1\nline2 THEIRS\nline3\n";
    const result = classifyFileMerge(base, ours, theirs);
    expect(result.outcome).toBe("conflict");
    if (result.outcome === "conflict") {
      expect(result.kind).toBe("content");
      expect(result.ours).toBe(ours);
      expect(result.theirs).toBe(theirs);
    }
  });
});

describe("threeWayMergeText()", () => {
  it("cleanly merges disjoint-line edits", () => {
    const { clean, merged } = threeWayMergeText("a\nb\nc\n", "a MINE\nb\nc\n", "a\nb\nc THEIRS\n");
    expect(clean).toBe(true);
    expect(merged).toBe("a MINE\nb\nc THEIRS\n");
  });

  it("marks a genuine same-line conflict with conflict markers, not clean", () => {
    const { clean, merged } = threeWayMergeText("a\nb\nc\n", "a\nb MINE\nc\n", "a\nb THEIRS\nc\n", "mine", "theirs");
    expect(clean).toBe(false);
    expect(merged).toContain("<<<<<<< mine");
    expect(merged).toContain("b MINE");
    expect(merged).toContain("=======");
    expect(merged).toContain("b THEIRS");
    expect(merged).toContain(">>>>>>> theirs");
  });
});

describe("selectBackupRefsToDelete() — prune to 5", () => {
  it("keeps everything when there are 5 or fewer", () => {
    const names = ["pre-sync-1", "pre-sync-2", "pre-sync-3"];
    expect(selectBackupRefsToDelete(names)).toEqual([]);
  });

  it("keeps exactly the 5 most recent, deletes the rest", () => {
    const names = Array.from({ length: 8 }, (_, i) => `pre-sync-${1000 + i}`); // 1000..1007
    const toDelete = selectBackupRefsToDelete(names, 5);
    expect(toDelete.sort()).toEqual(["pre-sync-1000", "pre-sync-1001", "pre-sync-1002"].sort());
  });

  it("keep is not order-dependent — sorts by the embedded timestamp, not array order", () => {
    const names = ["pre-sync-3000", "pre-sync-1000", "pre-sync-5000", "pre-sync-2000", "pre-sync-4000", "pre-sync-6000"];
    const toDelete = selectBackupRefsToDelete(names, 5);
    expect(toDelete).toEqual(["pre-sync-1000"]); // oldest of the 6
  });

  it("respects a custom keep count", () => {
    const names = ["pre-sync-1", "pre-sync-2", "pre-sync-3"];
    expect(selectBackupRefsToDelete(names, 1).sort()).toEqual(["pre-sync-1", "pre-sync-2"].sort());
  });

  it("never touches a name that doesn't match the expected shape", () => {
    expect(selectBackupRefsToDelete(["not-a-backup-ref"], 0)).toEqual([]);
  });
});

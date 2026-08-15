/**
 * Pins `git/diff.ts`'s diff-stat computation: `toLines()` (content -> lines,
 * dropping the phantom trailing element a final "\n" produces) feeding
 * `toDiffLines()` (the LCS-flags walk that both the gutter and the +N -N
 * chip ultimately count). `diffFileVsHead` itself reads from the real fs, so
 * it's covered by the e2e `editor-diff.spec.ts` (chip vs. gutter vs. diff
 * mode agreement) instead of re-derived here against a fake filesystem.
 */
import { describe, expect, it } from "vitest";
import { toDiffLines, toLines } from "../../src/git/diff";

describe("toLines()", () => {
  it("splits on newlines", () => {
    expect(toLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("drops the phantom trailing empty line a final newline produces", () => {
    expect(toLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("returns no lines for an empty string (not a phantom single blank line)", () => {
    expect(toLines("")).toEqual([]);
  });
});

describe("toDiffLines() diff-stat computation", () => {
  it("counts a pure addition (no removed lines)", () => {
    const lines = toDiffLines(["a"], ["a", "b", "c"]);
    const added = lines.filter((l) => l.type === "added").length;
    const removed = lines.filter((l) => l.type === "removed").length;
    expect(added).toBe(2);
    expect(removed).toBe(0);
  });

  it("counts a pure deletion (no added lines)", () => {
    const lines = toDiffLines(["a", "b", "c"], ["a"]);
    const added = lines.filter((l) => l.type === "added").length;
    const removed = lines.filter((l) => l.type === "removed").length;
    expect(added).toBe(0);
    expect(removed).toBe(2);
  });

  it("counts a mixed modification independently of unchanged context lines", () => {
    // 3 unchanged context lines, 2 removed, 2 added — a shape close to the
    // seeded `indexer.ts` demo diff this app ships (a near-total rewrite
    // wrapped by a couple of unrelated unchanged lines at the edges).
    const oldLines = ["export {}", "old line 1", "old line 2", "shared tail"];
    const newLines = ["export {}", "new line 1", "new line 2", "shared tail"];
    const lines = toDiffLines(oldLines, newLines);
    const added = lines.filter((l) => l.type === "added").length;
    const removed = lines.filter((l) => l.type === "removed").length;
    const context = lines.filter((l) => l.type === "context").length;
    expect(added).toBe(2);
    expect(removed).toBe(2);
    expect(context).toBe(2);
  });

  it("reproduces DESIGN-SPEC's exact +12 -5 for the seeded architecture.md pair", () => {
    // The exact HEAD/WORKING strings this app seeds for architecture.md
    // (fs/seed.ts's ARCHITECTURE_MD_HEAD/_WORKING) — duplicated here (not
    // imported) so this test pins the number as a property of the diff
    // *algorithm* over these two documents, independent of whether seed.ts
    // ever re-exports its constants. seed.ts's own header comment records
    // that this exact pair was verified against this same toLines/lcsDiffFlags
    // pipeline to produce 5 removed / 12 added — DESIGN-SPEC's "+12 -5".
    const head = `# Indexing architecture

The indexer walks vault files and builds a lookup table on load.

## Constraints

- Index must finish before the UI unblocks
- Full rebuild on every note change
- Legacy parser stays a fallback

## Pipeline

Rebuild everything on save.
`;
    const working = `# Indexing architecture

The vault indexer walks the file graph and emits a sparse adjacency list. See [indexer.ts](../src/indexer.ts) for the walker.

## Constraints

- Cold index of 50k notes under \`900ms\`
- Incremental updates are **append-only**
- No blocking work on the render thread

> Treat the index as a cache. Never as truth.

## Pipeline

\`\`\`
walk(root) → parse() → link() → commit()
\`\`\`

## Rollback
Every commit is content-addressed, so a bad update reverts by replaying the commit log backwards.
`;
    const lines = toDiffLines(toLines(head), toLines(working));
    const added = lines.filter((l) => l.type === "added").length;
    const removed = lines.filter((l) => l.type === "removed").length;
    expect(added).toBe(12);
    expect(removed).toBe(5);
  });
});

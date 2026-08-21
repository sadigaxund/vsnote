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

  it("reproduces the seeded searchRank.ts pair: +26 -10 across a multi-hunk edit", () => {
    // The exact HEAD/WORKING strings fs/seed.ts seeds for src/searchRank.ts
    // (SEARCH_RANK_TS_HEAD/_WORKING, duplicated here per the same
    // algorithm-pinning rationale as the architecture.md case above). This
    // pair was authored for the DIFF VIEW showcase and verified with real
    // `git diff -U3` to be exactly 4 separated hunks, +26 −10; this test
    // pins that the app's own LCS pipeline agrees with git on the counts.
    const head = `// Search ranking v1 — path-substring hits plus raw link degree.

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or"]);

export interface ScoredNote {
  path: string;
  score: number;
}

/**
 * Ranks vault notes for a query: case-insensitive substring hits on the
 * path earn a flat boost; every inbound/outbound link adds a little.
 */
export function rankNotes(
  query: string,
  index: Map<string, string[]>,
): ScoredNote[] {
  const terms = tokenize(query);
  const results: ScoredNote[] = [];
  for (const [path, links] of index) {
    let score = 0;
    if (terms.some((t) => path.toLowerCase().includes(t))) score += 5;
    score += links.length;
    if (score > 0) results.push({ path, score });
  }
  return results.sort(byScoreDesc);
}

function byScoreDesc(a: ScoredNote, b: ScoredNote): number {
  return b.score - a.score;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}
`;
    const working = `// Search ranking v2 — BM25-lite scoring over paths and link degree.

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for",
  "with", "is", "it",
]);

export interface ScoredNote {
  path: string;
  score: number;
}

/**
 * Ranks vault notes for a query with a BM25-lite heuristic: term hits in
 * the path dominate, link degree acts as a mild prior, and stop-word
 * filtering keeps short queries from matching everything in the vault.
 */
export function rankNotes(
  query: string,
  index: Map<string, string[]>,
): ScoredNote[] {
  const terms = tokenize(query);
  const results: ScoredNote[] = [];
  for (const [path, links] of index) {
    let score = 0;
    let hits = 0;
    for (const t of terms) {
      if (!path.toLowerCase().includes(t)) continue;
      hits += 1;
      score += 2 * t.length;
    }
    // Link degree as a prior: worth something, never decisive.
    score += Math.log1p(links.length);
    if (hits > 0 || links.length > 8) results.push({ path, score });
  }
  return results.sort(byScoreThenPath);
}

function byScoreThenPath(a: ScoredNote, b: ScoredNote): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.path.localeCompare(b.path);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Keeps the palette's top-N cut stable across equal scores. */
export function topK(results: ScoredNote[], k = 20): ScoredNote[] {
  return results.slice(0, k);
}
`;
    const lines = toDiffLines(toLines(head), toLines(working));
    const added = lines.filter((l) => l.type === "added").length;
    const removed = lines.filter((l) => l.type === "removed").length;
    expect(added).toBe(26);
    expect(removed).toBe(10);
  });
});

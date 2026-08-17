/**
 * Guard for the unit suite's filesystem-isolation invariant.
 *
 * `src/fs/client.ts` instantiates lightning-fs at MODULE SCOPE, so any unit
 * test that transitively imports it opens a real (fake-indexeddb) IndexedDB
 * database just by loading. `vitest.config.ts` explains why exactly one test
 * file may do that: with two, lightning-fs consumers contend and hang.
 *
 * This is not hypothetical. Phase 15 added `tests/unit/importEntries.test.ts`,
 * whose module imported `fs/operations.ts` (which imports `fs/client.ts`).
 * The suite passed locally and then, on CI, all six `drafts.test.ts` tests
 * hung at their first filesystem call until the 20s timeout. The fix was to
 * split the pure helpers away from the fs-touching ones
 * (`fs/importEntriesFs.ts`); this test is what stops the next module from
 * quietly reintroducing the same coupling, since the symptom shows up only
 * on CI and looks like an unrelated flake in a different file.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");
const UNIT_DIR = __dirname;

/**
 * Files allowed to pull in the real lightning-fs client.
 *
 * `drafts.test.ts` is intentional: it exercises `fs/drafts.ts` against the
 * real client, which is the whole point of that file.
 *
 * The rest are PRE-EXISTING and unwanted. They reach `fs/client.ts` only
 * incidentally, by importing a git or store module that happens to pull the
 * client in transitively, and each one adds another lightning-fs consumer to
 * the suite. Do not add to this list: the point of this test is that the
 * next module cannot quietly join them. Removing entries is welcome, and
 * `fs/importEntriesFs.ts` shows the shape of the fix, splitting the pure
 * helpers away from the filesystem-touching ones so the test can import the
 * pure half.
 */
const ALLOWED = new Set([
  "drafts.test.ts",
  // Legacy, incidental. See the note above before touching.
  "diffStat.test.ts",
  "gitRemote.test.ts",
  "gitStatus.test.ts",
  "paneTree.test.ts",
]);

const FS_CLIENT = resolve(SRC, "fs/client.ts");

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  // Covers `import ... from "x"`, `export ... from "x"` and `import("x")`.
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Every module reachable from `entry`, following relative imports only. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const spec of importsOf(current)) {
      const resolved = resolveImport(current, spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe("unit suite filesystem isolation", () => {
  const testFiles = readdirSync(UNIT_DIR).filter((f) => f.endsWith(".test.ts"));

  it("finds the unit test files and the fs client it guards", () => {
    // Guards the guard: a bad path here would make every case below vacuous.
    expect(testFiles.length).toBeGreaterThan(10);
    expect(existsSync(FS_CLIENT)).toBe(true);
  });

  it("keeps the allowlist from growing", () => {
    // A ratchet: this number may go DOWN as modules get split, never up.
    expect(ALLOWED.size).toBeLessThanOrEqual(5);
    expect(testFiles).toContain("drafts.test.ts");
    for (const name of ALLOWED) expect(testFiles).toContain(name);
  });

  for (const file of readdirSync(UNIT_DIR).filter((f) => f.endsWith(".test.ts") && !ALLOWED.has(f))) {
    it(`${file} does not transitively import src/fs/client.ts`, () => {
      const reachable = reachableFrom(join(UNIT_DIR, file));
      expect(
        reachable.has(FS_CLIENT),
        `${file} reaches src/fs/client.ts, which instantiates lightning-fs on import. ` +
          `That breaks drafts.test.ts on CI (every test hangs to its timeout). Move the ` +
          `filesystem-touching code into its own module and test only the pure half.`,
      ).toBe(false);
    });
  }

  it("drafts.test.ts really does reach it, so the check above is meaningful", () => {
    expect(reachableFrom(join(UNIT_DIR, "drafts.test.ts")).has(FS_CLIENT)).toBe(true);
  });
});

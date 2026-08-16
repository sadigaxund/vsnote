/**
 * Minimal ambient type for the `diff3` npm package (a transitive dependency
 * of `isomorphic-git`, now a direct one — see `mergeLogic.ts`'s doc for
 * why: it's the exact diff3 engine `isomorphic-git`'s own built-in merge
 * driver uses internally, reused here directly so this app's own auto-merge
 * (`mergeLogic.ts::threeWayMergeText`) and `git.merge()`'s default behavior
 * never risk disagreeing). Ships no types of its own (plain CommonJS, no
 * `.d.ts`, confirmed by inspecting `node_modules/diff3`), and no
 * `@types/diff3` package exists on npm — this is deliberately narrow (only
 * the one call shape this codebase actually uses), not a full re-typing of
 * the package.
 */
declare module "diff3" {
  interface Diff3OkItem {
    ok: string[];
  }
  interface Diff3ConflictItem {
    conflict: {
      a: string[];
      aIndex: number;
      o: string[];
      oIndex: number;
      b: string[];
      bIndex: number;
    };
  }
  type Diff3Result = Array<Diff3OkItem | Diff3ConflictItem>;

  /** `diff3Merge(a, o, b)` — `a`/`b` are the two sides, `o` the common
   * ancestor ("original"), each an array of lines (matching this app's own
   * `LINEBREAKS`-split convention, same as `isomorphic-git`'s bundled
   * `mergeFile`). */
  export default function diff3Merge(a: string[], o: string[], b: string[]): Diff3Result;
}

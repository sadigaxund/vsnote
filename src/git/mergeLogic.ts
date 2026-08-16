/**
 * Phase 11 (real sync, roadmap §5.2) — the PURE decision logic behind the
 * auto-merge policy, split out of `sync.ts` so it's unit-testable without a
 * real repo/filesystem (same split `syncStatus.ts` documents for the
 * fast-forward-only policy, and `diff.ts`'s `toDiffLines`/`toLines` for the
 * diff stat). Nothing here touches `isomorphic-git`'s `fs`/`dir` — every
 * function takes plain strings/arrays and returns plain data.
 *
 * `classifyFileMerge` is the per-file heart of "Auto-merge: three-way from
 * the merge base — remote-only-changed files take remote, local-only-
 * changed keep local, both-changed get content-level diff3": given a
 * file's content at the merge base / local HEAD ("ours") / the remote
 * tracking ref ("theirs") — any of which may be `undefined` (the file
 * doesn't exist at that point) — it decides whether the file resolves
 * cleanly and with what content, or is a TRUE conflict needing the in-app
 * resolver (`components/local/ConflictResolver.tsx`).
 *
 * `threeWayMergeText` wraps the `diff3` package (the exact engine
 * `isomorphic-git`'s own built-in merge driver, `mergeFile` in its bundled
 * source, uses internally for `git.merge()`'s default `mergeDriver`) so
 * this app's own diff3 call produces byte-identical conflict-marker
 * formatting to what `git.merge()` would produce on its own — deliberately
 * NOT reinventing a second three-way-merge algorithm.
 */
import diff3Merge from "diff3";

export type FileMergeResult =
  | { outcome: "clean"; content: string | null }
  | {
      outcome: "conflict";
      /** "content" — both sides edited overlapping lines, diff3 couldn't
       * reconcile them. "delete" — one side deleted the file while the
       * other modified it ("modify/delete conflict", git's own term). */
      kind: "content" | "delete";
      base?: string;
      ours?: string;
      theirs?: string;
    };

/** Splits on line boundaries the same way `isomorphic-git`'s bundled
 * `mergeFile` does (`LINEBREAKS = /^.*(\r?\n|$)/gm`) — diff3 operates on
 * an array of lines (each retaining its own trailing newline), not raw
 * text, so a merged result reassembles with `join("")`, not `join("\n")`. */
const LINEBREAKS = /^.*(\r?\n|$)/gm;

function splitLines(text: string): string[] {
  return text.match(LINEBREAKS) ?? [];
}

/** Three-way merges one file's TEXT content via diff3. Returns `clean:
 * true` with the merged text when every hunk resolved automatically;
 * `clean: false` with conflict markers (`<<<<<<< mine` / `=======` /
 * `>>>>>>> theirs`, same 7-char marker convention `git merge` itself uses)
 * inlined at every unresolved hunk when it didn't. Pure — no I/O. */
export function threeWayMergeText(
  base: string,
  ours: string,
  theirs: string,
  ourLabel = "mine",
  theirLabel = "theirs",
): { clean: boolean; merged: string } {
  const result = diff3Merge(splitLines(ours), splitLines(base), splitLines(theirs));
  const markerSize = 7;
  let merged = "";
  let clean = true;
  for (const item of result) {
    if ("ok" in item) {
      merged += item.ok.join("");
    } else {
      clean = false;
      merged += `${"<".repeat(markerSize)} ${ourLabel}\n`;
      merged += item.conflict.a.join("");
      merged += `${"=".repeat(markerSize)}\n`;
      merged += item.conflict.b.join("");
      merged += `${">".repeat(markerSize)} ${theirLabel}\n`;
    }
  }
  return { clean, merged };
}

/**
 * Per-file three-way classification. `base`/`ours`/`theirs` are the file's
 * content at the merge base / local HEAD / `refs/remotes/origin/<branch>`
 * respectively — `undefined` means "doesn't exist there" (never created
 * yet, or deleted).
 *
 * Decision table (mirrors real `git merge`'s per-file logic exactly, since
 * both sides ultimately reduce to the same diff3 primitive):
 * - Neither side touched it since the base → unchanged (content = base, or
 *   no file at all if it never existed).
 * - Only the remote touched it → take remote (roadmap §5.2: "remote-only-
 *   changed files take remote").
 * - Only local touched it → keep local ("local-only-changed keep local").
 * - Both touched it but landed on the IDENTICAL result (including both
 *   independently deleting it) → clean, trivially — nothing to merge.
 *   Both touched it and one side deleted while the other kept editing → a
 *   genuine "modify/delete" conflict; diff3 has no way to reconcile
 *   "content" against "absence", so this is never attempted automatically.
 * - Both touched it, both sides still have content, and the results
 *   differ → content-level diff3 ("both-changed get content-level diff3");
 *   clean if diff3 resolved every hunk, a true conflict otherwise.
 */
export function classifyFileMerge(
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): FileMergeResult {
  const ourChanged = ours !== base;
  const theirChanged = theirs !== base;

  if (!ourChanged && !theirChanged) return { outcome: "clean", content: base ?? null };
  if (!ourChanged) return { outcome: "clean", content: theirs ?? null };
  if (!theirChanged) return { outcome: "clean", content: ours ?? null };
  if (ours === theirs) return { outcome: "clean", content: ours ?? null };

  if (ours === undefined || theirs === undefined) {
    return { outcome: "conflict", kind: "delete", base, ours, theirs };
  }

  const { clean, merged } = threeWayMergeText(base ?? "", ours, theirs);
  if (clean) return { outcome: "clean", content: merged };
  return { outcome: "conflict", kind: "content", base, ours, theirs };
}

/**
 * Backup-ref pruning (roadmap §5.2: "keep last 5"). Pure selection logic —
 * `git/backupRefs.ts` does the actual `git.listRefs`/`git.deleteRef` I/O
 * and calls this to decide WHICH names to delete. `names` are the bare ref
 * names under `refs/backup/` (e.g. `pre-sync-1755301200000`, matching
 * `backupRefs.ts`'s `backupRefName`) — sorted by the numeric timestamp
 * embedded in the name (not lexicographically on the whole string, though
 * for same-length epoch-ms values through the year 2286 those agree
 * anyway; extracting and comparing numerically is the honest version of
 * that claim rather than a hopeful one). Any name that doesn't match the
 * expected shape is left alone (never deleted by a function that can't
 * prove it understands the name) — defensive, not expected to trigger in
 * practice since this app is the only writer of `refs/backup/*`.
 */
export function selectBackupRefsToDelete(names: string[], keep = 5): string[] {
  const parsed = names
    .map((name) => ({ name, ts: Number(name.replace(/^pre-sync-/, "")) }))
    .filter((entry) => Number.isFinite(entry.ts) && entry.name.startsWith("pre-sync-"));
  parsed.sort((a, b) => b.ts - a.ts); // newest first
  return parsed.slice(keep).map((entry) => entry.name);
}

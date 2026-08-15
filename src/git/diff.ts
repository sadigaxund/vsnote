/**
 * Diff vs HEAD — the single source ARCHITECTURE.md's "Key flows" calls out:
 * "single `git/diff.ts` API used by gutter, diff stats chip, and status bar
 * so numbers always agree." Phase 2 wires the chip + status bar to it;
 * Phase 3 adds the gutter consumer on top of the same `diffFileVsHead`.
 *
 * Reuses `my-you-eye`'s own line-diff kernel (`lcsDiffFlags`, the library's
 * "one diff algorithm" per its AGENTS.md) run over lines instead of words,
 * rather than hand-rolling a second LCS implementation. This module only
 * adds the git-specific glue: reading the HEAD blob vs the working file,
 * and walking the LCS flags into an ordered `DiffLine[]` with line numbers.
 */
import * as git from "isomorphic-git";
import { lcsDiffFlags, type DiffLine } from "my-you-eye";
import { fs, GIT_DIR } from "./client";
import { pathExists, readTextFile } from "../fs/operations";
import { displayToFsPath, displayToRepoPath } from "../fs/paths";

export interface FileDiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
}

export const EMPTY_DIFF: FileDiffResult = { lines: [], added: 0, removed: 0 };

/** Reads a file's content as committed at HEAD (undefined if it doesn't
 * exist there — a new/untracked file). Exposed for callers that need to
 * show a deleted-from-working-tree file read-only (its last good version),
 * e.g. Source mode on a `D`-status tab. */
export async function readHeadFileContent(displayPath: string): Promise<string | undefined> {
  return readHeadContent(displayToRepoPath(displayPath));
}

async function readHeadContent(repoPath: string): Promise<string | undefined> {
  try {
    const oid = await git.resolveRef({ fs, dir: GIT_DIR, ref: "HEAD" });
    const { blob } = await git.readBlob({ fs, dir: GIT_DIR, oid, filepath: repoPath });
    return new TextDecoder("utf-8").decode(blob);
  } catch {
    // No HEAD commit yet, or the file doesn't exist at HEAD (new file).
    return undefined;
  }
}

/**
 * Walks LCS flags into unified order: a run of removed lines from the old
 * side, then a run of added lines from the new side, then a matched context
 * line, repeating — the same shape `pairDiffLines` (my-you-eye) expects as
 * input for a side-by-side render.
 */
function toDiffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const { aChanged, bChanged } = lcsDiffFlags(oldLines, newLines);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNo = 1;
  let newLineNo = 1;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && aChanged[i]) {
      lines.push({ type: "removed", content: oldLines[i], oldLine: oldLineNo });
      oldLineNo++;
      i++;
    } else if (j < newLines.length && bChanged[j]) {
      lines.push({ type: "added", content: newLines[j], newLine: newLineNo });
      newLineNo++;
      j++;
    } else if (i < oldLines.length && j < newLines.length) {
      lines.push({ type: "context", content: oldLines[i], oldLine: oldLineNo, newLine: newLineNo });
      oldLineNo++;
      newLineNo++;
      i++;
      j++;
    } else {
      break;
    }
  }
  return lines;
}

/** Splits on "\n"; drops the trailing empty element a final newline creates
 * so a file ending in `\n` doesn't produce a phantom last line. */
function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export async function diffFileVsHead(displayPath: string): Promise<FileDiffResult> {
  const repoPath = displayToRepoPath(displayPath);
  const fsPath = displayToFsPath(displayPath);

  const [headContent, hasWorking] = await Promise.all([
    readHeadContent(repoPath),
    pathExists(fsPath),
  ]);
  const workingContent = hasWorking ? await readTextFile(fsPath) : undefined;

  if (headContent === undefined && workingContent === undefined) return EMPTY_DIFF;

  const oldLines = headContent === undefined ? [] : toLines(headContent);
  const newLines = workingContent === undefined ? [] : toLines(workingContent);
  const lines = toDiffLines(oldLines, newLines);
  const added = lines.filter((l) => l.type === "added").length;
  const removed = lines.filter((l) => l.type === "removed").length;
  return { lines, added, removed };
}

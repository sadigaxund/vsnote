/**
 * Status matrix → per-file letters. The one place `statusMatrix` is called;
 * `useGitStore` consumes this, and it's what the tree/badge/status-bar
 * "untracked"/"changed" counts all derive from.
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR } from "./client";
import { repoToDisplayPath } from "../fs/paths";
import type { GitStatus } from "../types";

export type FileStatusMap = Record<string, GitStatus>;

export interface StatusResult {
  /** Keyed by display path (`vault/notes/architecture.md`). */
  statuses: FileStatusMap;
  changedCount: number;
  untrackedCount: number;
}

/**
 * Classifies one `statusMatrix` row — `[filepath, head, workdir, stage]` —
 * into the M/A/D/U vocabulary. `head`/`workdir`/`stage` are each `0`
 * (absent) / `1` (present, unmodified re: the other columns) / `2`
 * (present, different) per isomorphic-git's docs; `workdir` can also be `0`
 * for a file deleted from the working tree. Only the four combinations that
 * matter to this UI are named; everything else (most commonly `[1,1,1]`,
 * unmodified) has no status letter.
 */
function classify(head: number, workdir: number, stage: number): GitStatus | undefined {
  if (head === 0 && workdir === 2 && stage === 0) return "U"; // untracked
  if (head === 0 && workdir === 2 && stage === 2) return "A"; // new + staged
  if (head === 1 && workdir === 0) return "D"; // deleted (staged or not)
  if (head === 1 && workdir === 2) return "M"; // modified (staged or not)
  return undefined;
}

export async function computeStatus(): Promise<StatusResult> {
  const matrix = await git.statusMatrix({ fs, dir: GIT_DIR });
  const statuses: FileStatusMap = {};
  let changedCount = 0;
  let untrackedCount = 0;

  for (const [filepath, head, workdir, stage] of matrix) {
    const letter = classify(head, workdir, stage);
    if (!letter) continue;
    statuses[repoToDisplayPath(filepath)] = letter;
    changedCount++;
    if (letter === "U") untrackedCount++;
  }

  return { statuses, changedCount, untrackedCount };
}

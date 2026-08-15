/**
 * Commit — data API only this phase (the Source Control sidebar panel that
 * calls it is Phase 3's "commit box" per IMPLEMENTATION-PLAN.md). Stages
 * every path `statusMatrix` reports as changed (add for new/modified,
 * remove for deleted) and commits under the demo author identity.
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEMO_AUTHOR } from "./client";

export async function commitAll(message: string): Promise<string> {
  const matrix = await git.statusMatrix({ fs, dir: GIT_DIR });
  for (const [filepath, head, workdir] of matrix) {
    if (head === workdir) continue; // unmodified
    if (workdir === 0) {
      await git.remove({ fs, dir: GIT_DIR, filepath });
    } else {
      await git.add({ fs, dir: GIT_DIR, filepath });
    }
  }
  return git.commit({ fs, dir: GIT_DIR, message, author: DEMO_AUTHOR });
}

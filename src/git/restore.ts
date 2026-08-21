/**
 * "Restore from remote…" — the gentle sibling of Reset vault (user request,
 * 2026-08-21): instead of wiping the vault into a fresh welcome seed, wipe it
 * INTO a clone of the currently-configured remote, so "start over from what's
 * on the server" is one confirmed action rather than reset-then-reconfigure-
 * then-pull by hand.
 *
 * Composition, not new git machinery — every step reuses the sync pipeline's
 * own primitives:
 *   1. `resetFilesystem()`            — nuke working tree AND `.git` history.
 *   2. `git.init`                     — brand-new empty repo (default branch).
 *   3. `realFetch(config, branch)`    — the same fetch sync uses; carries auth,
 *                                       refspec setup (`ensureOrigin`), and
 *                                       error→SyncError mapping.
 *   4. `fastForwardBranch(branch)`    — points the local branch at the just-
 *                                       fetched tracking ref and checks it out
 *                                       (single-fetch, dodging isomorphic-git's
 *                                       double-fetch NotFoundError — see its doc).
 *
 * Failure semantics are honest about destructiveness: the wipe happens FIRST,
 * so a failed restore leaves an EMPTY repo — App.tsx falls back to the welcome
 * seed and surfaces the SyncError, never pretending content came back.
 *
 * Deliberately NOT available in demo builds: the sandbox must never touch a
 * user's real remote (DESIGN-SPEC item 45).
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEFAULT_BRANCH } from "./client";
import { clearReadCache } from "../fs/operations";
import { resetFilesystem } from "../fs/client";
import { fastForwardBranch, realFetch, remoteTrackingOid, SyncError, type RemoteConfig } from "./remote";

export async function restoreFromRemote(config: RemoteConfig): Promise<{ branch: string }> {
  clearReadCache();
  resetFilesystem();
  await git.init({ fs, dir: GIT_DIR, defaultBranch: DEFAULT_BRANCH });

  // Objects + refs land in the fresh .git only; no worktree writes yet.
  await realFetch(config, DEFAULT_BRANCH);

  const oid = await remoteTrackingOid(DEFAULT_BRANCH);
  if (!oid) {
    throw new SyncError("unknown", `The remote has no branch "${DEFAULT_BRANCH}" to restore from.`);
  }

  await fastForwardBranch(DEFAULT_BRANCH);
  return { branch: DEFAULT_BRANCH };
}

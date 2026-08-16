/**
 * Phase 11 (real sync, roadmap §5.2) — "Backup ref before any merge/pull
 * mutation: tag local HEAD as `refs/backup/pre-sync-<timestamp>` (keep last
 * 5). Recovery is structural, not hopeful." This module is the ONLY writer
 * of `refs/backup/*` — `sync.ts` calls `createBackupRef` immediately before
 * each of the two places it actually mutates history (the behind-only
 * fast-forward, and right before writing a merge commit — clean-auto or
 * user-resolved), never speculatively before merely COMPUTING whether a
 * merge would be clean.
 *
 * "Structural, not hopeful" is the operative test this module has to pass:
 * a backup ref is a completely ordinary git ref pointing at the exact
 * commit HEAD was at, indistinguishable from one `git tag` or `git branch`
 * would create — `git log refs/backup/pre-sync-<ts>` / `git checkout
 * refs/backup/pre-sync-<ts>` work with plain system git, no app involved,
 * exactly like the vault's own remote (roadmap §4: plaintext, always).
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR } from "./client";
import { selectBackupRefsToDelete } from "./mergeLogic";

export const BACKUP_REF_PREFIX = "refs/backup";

export function backupRefName(timestamp: number): string {
  return `pre-sync-${timestamp}`;
}

export function backupRefPath(name: string): string {
  return `${BACKUP_REF_PREFIX}/${name}`;
}

/** Bare names under `refs/backup/` (e.g. `pre-sync-1755301200000`), newest
 * first — thin wrapper over `git.listRefs` so callers (`sync.ts`, tests,
 * the e2e demo script's assertions) don't need to know the prefix. */
export async function listBackupRefs(): Promise<string[]> {
  const names = await git.listRefs({ fs, dir: GIT_DIR, filepath: BACKUP_REF_PREFIX });
  return [...names].sort().reverse();
}

/** Deletes every backup ref beyond the 5 most recent (`mergeLogic.ts`'s
 * `selectBackupRefsToDelete` — pure selection, this is just the I/O). */
export async function pruneBackupRefs(keep = 5): Promise<void> {
  const names = await git.listRefs({ fs, dir: GIT_DIR, filepath: BACKUP_REF_PREFIX });
  const toDelete = selectBackupRefsToDelete(names, keep);
  for (const name of toDelete) {
    await git.deleteRef({ fs, dir: GIT_DIR, ref: backupRefPath(name) });
  }
}

/** Tags current local HEAD as `refs/backup/pre-sync-<now>`, then prunes to
 * the 5 most recent. Returns the bare ref name just created, or `null` if
 * there's no HEAD yet to back up (a brand-new repo with zero commits —
 * nothing meaningful to protect, and nothing a merge/pull could touch
 * either, so skipping is correct, not a shortcut). `force: true` on the
 * write only matters for the vanishingly unlikely case of two calls in the
 * same millisecond; it never overwrites a DIFFERENT timestamp's backup. */
export async function createBackupRef(now: number = Date.now()): Promise<string | null> {
  const headOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: "HEAD" }).catch(() => null);
  if (!headOid) return null;
  const name = backupRefName(now);
  await git.writeRef({ fs, dir: GIT_DIR, ref: backupRefPath(name), value: headOid, force: true });
  await pruneBackupRefs();
  return name;
}

declare global {
  interface Window {
    __slateGitDebug?: { listBackupRefs: () => Promise<string[]> };
  }
}

// Permanent, read-only e2e verification hook — same precedent as
// `lib/renderProbe.ts`'s `window.__renderCounts` (harmless in production;
// exists so a Playwright spec can prove `refs/backup/pre-sync-*` genuinely
// exists after a merge, per IMPLEMENTATION-PLAN-V2.md Phase 11's exit
// criteria, rather than "trust the code path ran"). Backup refs never
// leave the browser's local repo (they're never pushed), so there is no
// other way for a Node-side test process to observe them — this module is
// always loaded as part of the real app (not the `/share/*` route, which
// never imports `git/`), so the hook is reliably present by the time any
// spec needs it.
if (typeof window !== "undefined") {
  window.__slateGitDebug = { listBackupRefs };
}

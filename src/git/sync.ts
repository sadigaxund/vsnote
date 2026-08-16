/**
 * Phase 11 (real sync, roadmap §5.2) — the one-button "Sync" pipeline:
 * "fetch → purely behind ⇒ fast-forward → purely ahead ⇒ push → diverged ⇒
 * auto-merge". `useGitStore.ts`'s `syncNow` is the only caller (via the
 * status bar's sync segment / command palette's "Sync now"); it auto-
 * commits any uncommitted local changes FIRST (using the rendered
 * `git/commitTemplate.ts` template), then calls `runSync` here.
 *
 * This module owns the divergent case's real mutation logic —
 * `git/mergeLogic.ts` supplies the pure per-file classification/diff3, this
 * module does the actual `isomorphic-git` I/O: reading blobs at three refs,
 * writing resolved content to the working tree, staging, committing a real
 * two-parent merge commit, and pushing it. `git/remote.ts`'s
 * `fastForwardBranch`/`pushBranch`/`mapError` are reused directly (not
 * duplicated) for the behind-only and ahead-only cases and for the actual
 * push call.
 *
 * **Backup ref discipline**: `backupRefs.ts`'s `createBackupRef` is called
 * immediately before each of the two places this module actually mutates
 * history — never merely before COMPUTING whether a merge would be clean
 * (`computeMergePlan` is read-only). A conflict that needs the resolver
 * therefore leaves NOTHING mutated yet (no backup ref needed — nothing to
 * protect against); the backup ref for that case is created inside
 * `resolveConflictAndPush`, right before it writes the resolution.
 */
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEMO_AUTHOR } from "./client";
import { computeStatus } from "./status";
import { pathExists, removeFile, writeFile } from "../fs/operations";
import { repoToFsPath } from "../fs/paths";
import { classifyDivergence } from "./syncStatus";
import {
  computeSyncStatus,
  fastForwardBranch,
  mapError,
  pushBranch,
  realFetch,
  remoteTrackingOid,
  SyncError,
  type RemoteConfig,
  type SyncStatus,
} from "./remote";
import { classifyFileMerge } from "./mergeLogic";
import { createBackupRef } from "./backupRefs";
import { buildTemplateVars, renderCommitTemplate } from "./commitTemplate";

export interface ConflictFile {
  path: string;
  /** "content" — both sides edited overlapping lines. "delete" — one side
   * deleted the file while the other modified it. */
  kind: "content" | "delete";
  base?: string;
  ours?: string;
  theirs?: string;
}

export interface CleanFile {
  path: string;
  /** `null` means this file should be DELETED (one side deleted it, the
   * other left it untouched — "remote-only-changed"/"local-only-changed"
   * takes the deletion same as it would take any other change). */
  content: string | null;
}

/** Everything needed to finish a diverged sync once the user has resolved
 * every true conflict — held in `useGitStore`'s `conflict` state between
 * `runSync` returning `action: "conflict"` and the user calling
 * `resolveConflict`. Plain data (no open handles/live editors) so it's
 * safe to sit in a zustand store. */
export interface PendingConflict {
  branch: string;
  ourOid: string;
  theirOid: string;
  baseOid: string | null;
  cleanFiles: CleanFile[];
  conflicts: ConflictFile[];
  /** Already-rendered (roadmap §5.3 template, `{files}` = every path this
   * merge touches) — reused verbatim by `resolveConflictAndPush` so the
   * message describes the merge as originally computed, not whatever the
   * clock reads when the user finally clicks through the resolver. */
  commitMessage: string;
}

export type SyncAction = "noop" | "fast-forward" | "push" | "merged" | "conflict";

export interface SyncOutcome {
  action: SyncAction;
  status: SyncStatus;
  /** The backup ref name (bare, e.g. `pre-sync-1755301200000`) created for
   * this sync, if any mutation happened. Absent for `"noop"`/`"push"`
   * (nothing that could lose local history — a plain push doesn't rewrite
   * anything) and for `"conflict"` (nothing written yet; the eventual
   * `resolveConflictAndPush` creates its own). */
  backupRef?: string;
  /** Present only for `action: "conflict"` — the resolver
   * (`components/local/ConflictResolver.tsx`) reads this. */
  conflict?: PendingConflict;
}

async function readBlobAt(oid: string, path: string): Promise<string | undefined> {
  try {
    const { blob } = await git.readBlob({ fs, dir: GIT_DIR, oid, filepath: path });
    return new TextDecoder("utf-8").decode(blob);
  } catch {
    return undefined;
  }
}

async function unionFilePaths(oids: Array<string | null>): Promise<string[]> {
  const lists = await Promise.all(
    oids.filter((oid): oid is string => oid !== null).map((oid) => git.listFiles({ fs, dir: GIT_DIR, ref: oid })),
  );
  const union = new Set<string>();
  for (const list of lists) for (const path of list) union.add(path);
  return [...union].sort();
}

/** Reads every file's content at base/ours/theirs and classifies it
 * (`mergeLogic.ts::classifyFileMerge`) — read-only, no working-tree or
 * index writes. Exported for `tests/unit` to exercise the async plumbing
 * separately from the pure classification it wraps, and for
 * `useGitStore.ts` if it ever needs a dry-run preview. */
export async function computeMergePlan(
  baseOid: string | null,
  ourOid: string,
  theirOid: string,
): Promise<{ cleanFiles: CleanFile[]; conflicts: ConflictFile[] }> {
  const paths = await unionFilePaths([baseOid, ourOid, theirOid]);
  const cleanFiles: CleanFile[] = [];
  const conflicts: ConflictFile[] = [];

  for (const path of paths) {
    const [base, ours, theirs] = await Promise.all([
      baseOid ? readBlobAt(baseOid, path) : Promise.resolve(undefined),
      readBlobAt(ourOid, path),
      readBlobAt(theirOid, path),
    ]);
    const result = classifyFileMerge(base, ours, theirs);
    if (result.outcome === "clean") {
      cleanFiles.push({ path, content: result.content });
    } else {
      conflicts.push({ path, kind: result.kind, base, ours, theirs });
    }
  }

  return { cleanFiles, conflicts };
}

/** Writes every resolved file to the working tree (fs) and stages it
 * (`git.add`/`git.remove`) — the shared apply step for both a clean
 * auto-merge and a user-resolved conflict. Never touches files that aren't
 * in `files` (everything else stays exactly as HEAD/the index already had
 * it — this only ever ADDS the merge's own changes on top). */
async function applyMergedFiles(files: Array<{ path: string; content: string | null }>): Promise<void> {
  for (const { path, content } of files) {
    const fsPath = repoToFsPath(path);
    if (content === null) {
      if (await pathExists(fsPath)) await removeFile(fsPath);
      await git.remove({ fs, dir: GIT_DIR, filepath: path });
    } else {
      await writeFile(fsPath, content);
      await git.add({ fs, dir: GIT_DIR, filepath: path });
    }
  }
}

/** Commits a real two-parent merge commit from whatever's currently
 * staged (`tree` omitted — same "built from the index" behavior
 * `git/commit.ts::commitAll` relies on) and moves `branch` to it. Mirrors
 * `isomorphic-git`'s own documented "manually resolving merge conflicts"
 * recipe (`parent: [ours, theirs]` on an ordinary `git.commit()` call) —
 * not a separate low-level tree-construction path. */
async function commitMerge(branch: string, ourOid: string, theirOid: string, message: string): Promise<string> {
  try {
    return await git.commit({
      fs,
      dir: GIT_DIR,
      // FULLY QUALIFIED — `git.commit()`'s `ref` param, confirmed by direct
      // testing, does NOT auto-resolve/expand a bare branch name the way
      // `git.resolveRef`/`git.push` do: passing a bare `branch` writes a
      // loose ref at that exact literal path (i.e. `.git/feat/incremental-
      // index`, a sibling of `refs/`, NOT `.git/refs/heads/feat/incremental-
      // index`) rather than updating `refs/heads/<branch>` — so `HEAD`
      // (which symbolically points at `refs/heads/<branch>` specifically)
      // stays STALE at the pre-merge commit even though the merge commit
      // itself, and a bare `resolveRef({ref: branch})`, both resolve
      // "correctly" (isomorphic-git's ref lookup tries an exact loose-file
      // match before trying the `refs/heads/` prefix, which is exactly what
      // made this so easy to miss: `git.resolveRef({ref: branch})` and
      // `git.push`, which also expands internally, both "worked", while
      // `computeSyncStatus`'s `resolveRef({ref: "HEAD"})` — the one thing
      // that actually matters for ahead/behind — did not). Every OTHER ref
      // write in this codebase already uses the fully-qualified form
      // (`remote.ts::fastForwardBranch`'s `refs/heads/${branch}`) — this
      // brings `commitMerge` in line with that convention instead of being
      // the one exception.
      ref: `refs/heads/${branch}`,
      message,
      author: DEMO_AUTHOR,
      parent: [ourOid, theirOid],
    });
  } catch (err) {
    throw mapError(err);
  }
}

function renderMergeMessage(template: string, device: string, branch: string, files: string[]): string {
  return renderCommitTemplate(template, buildTemplateVars({ device, branch, files }));
}

/**
 * The full "Sync" pipeline. Assumes the caller (`useGitStore.ts`'s
 * `syncNow`) has already auto-committed any uncommitted local changes —
 * this function itself still refuses (never silently drops anything) if it
 * somehow finds a dirty working tree at the point it's about to mutate
 * history, same "never discard user data" discipline `realPull` already
 * had.
 */
export async function runSync(
  config: RemoteConfig,
  branch: string,
  commitTemplate: string,
  device: string,
): Promise<SyncOutcome> {
  const status = await realFetch(config, branch);
  const state = classifyDivergence(status);

  if (state === "up-to-date") {
    return { action: "noop", status };
  }

  if (state === "behind-only") {
    const { changedCount } = await computeStatus();
    if (changedCount > 0) {
      throw new SyncError("dirty", "You have uncommitted changes — commit them before syncing (fast-forward would touch the working tree).");
    }
    const backupRef = await createBackupRef();
    await fastForwardBranch(branch);
    return { action: "fast-forward", status: await computeSyncStatus(branch), backupRef: backupRef ?? undefined };
  }

  if (state === "ahead-only") {
    await pushBranch(config, branch);
    return { action: "push", status: await computeSyncStatus(branch) };
  }

  // Diverged — roadmap §5.2's auto-merge policy.
  const { changedCount } = await computeStatus();
  if (changedCount > 0) {
    throw new SyncError("dirty", "You have uncommitted changes — commit them before syncing (a merge needs a clean working tree to start from).");
  }

  const ourOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: branch });
  const theirOid = await remoteTrackingOid(branch);
  if (!theirOid) {
    throw new SyncError("unknown", "The remote-tracking ref vanished mid-sync — try again.");
  }
  const bases = await git.findMergeBase({ fs, dir: GIT_DIR, oids: [ourOid, theirOid] });
  const baseOid: string | null = bases[0] ?? null;

  const { cleanFiles, conflicts } = await computeMergePlan(baseOid, ourOid, theirOid);
  const touchedFiles = [...cleanFiles.map((f) => f.path), ...conflicts.map((f) => f.path)];
  const message = renderMergeMessage(commitTemplate, device, branch, touchedFiles);

  if (conflicts.length === 0) {
    const backupRef = await createBackupRef();
    await applyMergedFiles(cleanFiles);
    await commitMerge(branch, ourOid, theirOid, message);
    await pushBranch(config, branch);
    return { action: "merged", status: await computeSyncStatus(branch), backupRef: backupRef ?? undefined };
  }

  return {
    action: "conflict",
    status,
    conflict: { branch, ourOid, theirOid, baseOid, cleanFiles, conflicts, commitMessage: message },
  };
}

/** Finishes a diverged sync after the user resolved every true conflict in
 * `components/local/ConflictResolver.tsx`. `resolutions` maps EVERY
 * `pending.conflicts[].path` to its final content (`null` = delete) — the
 * resolver guarantees every conflict has an entry (defaults to "take
 * mine") before this is ever called, so a missing key here falls back to
 * "keep the local version" rather than silently dropping the file. */
export async function resolveConflictAndPush(
  config: RemoteConfig,
  pending: PendingConflict,
  resolutions: Record<string, string | null>,
): Promise<SyncStatus> {
  const resolvedFiles: CleanFile[] = pending.conflicts.map((c) => ({
    path: c.path,
    content: c.path in resolutions ? resolutions[c.path] : (c.ours ?? null),
  }));
  // Backup ref for the safety net (see module doc) — the returned name
  // isn't needed by any caller today; `backupRefs.ts::listBackupRefs()` is
  // there for anything (tests, a future "restore" UI) that needs to read
  // it back.
  await createBackupRef();
  await applyMergedFiles([...pending.cleanFiles, ...resolvedFiles]);
  await commitMerge(pending.branch, pending.ourOid, pending.theirOid, pending.commitMessage);
  await pushBranch(config, pending.branch);
  return computeSyncStatus(pending.branch);
}

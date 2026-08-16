/**
 * Git status + REAL sync state (Phase 11 — replaces the old simulated
 * remote). `statuses`/`branch`/`changedCount`/`ahead`/`behind` are all
 * recomputed live from the real repo/refs on every `refresh()` (never
 * persisted — they'd go stale the moment another tab or `git` CLI touched
 * the vault); `lastSyncedAt` is the one real, meaningful thing worth
 * remembering across reloads, so it alone still persists to localStorage
 * like `useSettingsStore`.
 *
 * `ahead`/`behind` come from `git/remote.ts::computeSyncStatus` — real
 * `git.log`/`findMergeBase` over local HEAD vs. `refs/remotes/origin/
 * <branch>`, not a fake counter. They only change when: (a) a commit moves
 * local HEAD (`refresh()` recomputes against whatever the remote-tracking
 * ref currently holds), or (b) an explicit fetch/pull/push updates the
 * remote-tracking ref itself. There is no more "drift" simulation — a real
 * remote doesn't move on its own just because a tab is idle; the
 * `feat/incremental-index` drift previously here (`driftIncrement`,
 * `App.tsx`'s 30s interval, `SYNC_DRIFT_*` in `git/remote.ts`) is gone.
 *
 * `lastSyncedAt` is a raw epoch timestamp, not a pre-formatted "synced Xm
 * ago" string — IMPLEMENTATION-PLAN.md Phase 5's "'synced Xm ago' relative
 * timestamp ticking" needs the label to keep advancing between syncs
 * without a store write every tick; `src/lib/relativeTime.ts`'s
 * `formatSyncedLabel` re-derives the string on demand, and
 * `StatusBar.tsx`'s tick interval is what makes the *displayed* label
 * actually count up.
 *
 * `syncError` is the one new piece of UI-facing state this phase adds: the
 * message from the most recent failed push/pull/fetch (a real
 * `SyncError`), or `null`. Every sync action clears it on start and either
 * clears it again on success or repopulates it on failure — it never just
 * accumulates silently, and a failure never leaves `syncing` stuck (see
 * each action below).
 *
 * Diff results are cached per path (`git/diff.ts` is the single source the
 * chip and status bar both read — ARCHITECTURE.md "Key flows") and
 * invalidated on every `refresh()`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as git from "isomorphic-git";
import { fs, GIT_DIR, DEFAULT_BRANCH } from "../git/client";
import { computeStatus, type FileStatusMap } from "../git/status";
import { diffFileVsHead, EMPTY_DIFF, type FileDiffResult } from "../git/diff";
import { computeGitRemoteUrl, computeSyncStatus, realFetch, realPull, realPush, SyncError, type RemoteConfig } from "../git/remote";
import { runSync, resolveConflictAndPush, type PendingConflict } from "../git/sync";
import { commitAll } from "../git/commit";
import { buildTemplateVars, renderCommitTemplate } from "../git/commitTemplate";
import { useSettingsStore } from "./useSettingsStore";
import type { GitStatus } from "../types";

function remoteConfig(): RemoteConfig {
  const { gitAuthToken } = useSettingsStore.getState();
  return { url: computeGitRemoteUrl(), token: gitAuthToken };
}

function errorMessage(err: unknown): string {
  return err instanceof SyncError ? err.message : "Sync failed for an unknown reason.";
}

interface GitStoreState {
  branch: string;
  statuses: FileStatusMap;
  changedCount: number;
  untrackedCount: number;
  diffCache: Record<string, FileDiffResult>;
  /** Bumped on every `refresh()` — callers that cache "the active file's
   * diff" (App.tsx) key an effect off this alongside the path, since the
   * path alone doesn't change when a file op elsewhere (e.g. a drag-move)
   * invalidates the cache for the file that's still active. */
  refreshGeneration: number;
  /** `"sync"` covers the whole one-button pipeline (`syncNow`/
   * `resolveConflict`, `sync.ts`'s `runSync`/`resolveConflictAndPush`) —
   * distinct from the individual `"push"`/`"pull"`/`"fetch"` actions
   * (`SourceControlPanel.tsx`'s buttons) even though the status bar's
   * label collapses all four to "syncing…"/"pushing…"/"pulling…". */
  syncing: false | "push" | "pull" | "fetch" | "sync";

  // Real (git/remote.ts-derived) — recomputed on every refresh()/sync, never persisted.
  ahead: number;
  behind: number;
  /** Whether `refs/remotes/origin/<branch>` exists yet — false until the
   * first successful fetch/pull/push against the configured remote. */
  hasRemoteRef: boolean;
  /** The most recent sync failure's honest, specific message — or `null`.
   * Never a silent no-op: every push/pull/fetch/syncNow either clears this
   * on success or sets it on failure, and always clears `syncing` either
   * way (CLAUDE.md rule 3 — a down/misconfigured backend never hangs the
   * UI or throws an unhandled rejection). */
  syncError: string | null;
  /** Epoch ms of the last successful sync/push/pull — see module doc. */
  lastSyncedAt: number | null;
  /** Phase 11 (real sync, roadmap §5.2) — set by `syncNow` when `runSync`
   * hits a TRUE conflict it can't auto-merge; `null` otherwise. While set,
   * `components/local/ConflictResolver.tsx` is open (`App.tsx` mounts it
   * once, unconditionally, reading this field itself) and NOTHING has been
   * pushed or discarded yet — `resolveConflict`/`cancelConflict` are the
   * only two ways this clears. */
  conflict: PendingConflict | null;

  refresh: () => Promise<void>;
  statusFor: (displayPath: string) => GitStatus | undefined;
  diffFor: (displayPath: string) => Promise<FileDiffResult>;
  getCachedDiff: (displayPath: string) => FileDiffResult;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  fetch: () => Promise<void>;
  /** "Sync now" (the status bar's sync segment + the command palette's
   * "Sync now" command both call this) — Phase 11's real pipeline (roadmap
   * §5.2): auto-commits any uncommitted local changes first (rendered from
   * `useSettingsStore`'s `gitCommitTemplate`/`gitDeviceName`), then
   * `sync.ts`'s `runSync` — fetch → fast-forward if purely behind → push if
   * purely ahead → auto-merge if diverged. A clean auto-merge pushes
   * immediately; a true conflict sets `conflict` instead (see its doc) and
   * leaves `syncing` cleared without touching `lastSyncedAt` — the sync
   * isn't DONE yet, it's paused on the user. */
  syncNow: () => Promise<void>;
  /** Finishes a paused sync once the user has resolved every file in
   * `conflict` (`ConflictResolver.tsx`'s "Resolve & push"). `resolutions`
   * maps every `conflict.conflicts[].path` to its final content (`null` =
   * delete) — see `sync.ts::resolveConflictAndPush`'s doc for the
   * never-silently-drop fallback if a path is somehow missing. */
  resolveConflict: (resolutions: Record<string, string | null>) => Promise<void>;
  /** Discards the PENDING conflict UI state only — no git mutation at all
   * (nothing was written in the first place; see `conflict`'s doc). Local
   * history is exactly what it was before Sync ran (plus the auto-commit
   * of any uncommitted changes, which is a real, intentional commit, not
   * something this undoes) — the user can retry Sync, or fetch/inspect
   * manually, at any time afterward. */
  cancelConflict: () => void;
}

export const useGitStore = create<GitStoreState>()(
  persist(
    (set, get) => ({
      branch: DEFAULT_BRANCH,
      statuses: {},
      changedCount: 0,
      untrackedCount: 0,
      diffCache: {},
      refreshGeneration: 0,
      syncing: false,

      ahead: 0,
      behind: 0,
      hasRemoteRef: false,
      syncError: null,
      lastSyncedAt: null,
      conflict: null,

      refresh: async () => {
        const [{ statuses, changedCount, untrackedCount }, branch] = await Promise.all([
          computeStatus(),
          git.currentBranch({ fs, dir: GIT_DIR, fullname: false }).catch(() => DEFAULT_BRANCH),
        ]);
        const resolvedBranch = branch ?? DEFAULT_BRANCH;
        // Real ahead/behind, from actual refs — no network I/O (see module
        // doc), so this is always safe/cheap to run on every refresh(),
        // including with the backend down.
        const syncStatus = await computeSyncStatus(resolvedBranch).catch(() => ({
          ahead: get().ahead,
          behind: get().behind,
          hasRemoteRef: get().hasRemoteRef,
        }));
        // Diff results are invalidated wholesale on refresh — cheap to
        // recompute lazily per file via diffFor, and guarantees no stale
        // number ever lingers after an edit/commit/reset.
        set((state) => ({
          statuses,
          changedCount,
          untrackedCount,
          branch: resolvedBranch,
          diffCache: {},
          refreshGeneration: state.refreshGeneration + 1,
          ahead: syncStatus.ahead,
          behind: syncStatus.behind,
          hasRemoteRef: syncStatus.hasRemoteRef,
        }));
      },

      statusFor: (displayPath) => get().statuses[displayPath],

      diffFor: async (displayPath) => {
        const cached = get().diffCache[displayPath];
        if (cached) return cached;
        const result = await diffFileVsHead(displayPath);
        set((state) => ({ diffCache: { ...state.diffCache, [displayPath]: result } }));
        return result;
      },

      getCachedDiff: (displayPath) => get().diffCache[displayPath] ?? EMPTY_DIFF,

      push: async () => {
        set({ syncing: "push", syncError: null });
        try {
          const status = await realPush(remoteConfig(), get().branch);
          set({ ...status, syncing: false, lastSyncedAt: Date.now() });
        } catch (err) {
          set({ syncing: false, syncError: errorMessage(err) });
        }
      },

      pull: async () => {
        set({ syncing: "pull", syncError: null });
        try {
          const status = await realPull(remoteConfig(), get().branch);
          set({ ...status, syncing: false, lastSyncedAt: Date.now() });
          await get().refresh(); // pull may have moved HEAD/working tree
        } catch (err) {
          set({ syncing: false, syncError: errorMessage(err) });
        }
      },

      fetch: async () => {
        set({ syncing: "fetch", syncError: null });
        try {
          const status = await realFetch(remoteConfig(), get().branch);
          set({ ...status, syncing: false, lastSyncedAt: Date.now() });
        } catch (err) {
          set({ syncing: false, syncError: errorMessage(err) });
        }
      },

      syncNow: async () => {
        set({ syncing: "sync", syncError: null, conflict: null });
        try {
          // Roadmap §5.3: one-click Sync auto-commits any uncommitted
          // local changes FIRST, using the rendered default template —
          // "never lose changes, never add friction" (§5.2's own framing)
          // means a dirty working tree is no longer a reason to refuse;
          // it's just something Sync commits on the user's behalf before
          // doing anything else.
          const { changedCount, statuses } = await computeStatus();
          const { gitCommitTemplate, gitDeviceName } = useSettingsStore.getState();
          if (changedCount > 0) {
            const message = renderCommitTemplate(
              gitCommitTemplate,
              buildTemplateVars({ device: gitDeviceName, branch: get().branch, files: Object.keys(statuses) }),
            );
            await commitAll(message);
          }

          const outcome = await runSync(remoteConfig(), get().branch, gitCommitTemplate, gitDeviceName);
          if (outcome.action === "conflict") {
            // Paused, not failed — nothing pushed or discarded yet (see
            // `conflict`'s doc). Deliberately does NOT touch
            // `lastSyncedAt`: the sync isn't done.
            set({ ...outcome.status, syncing: false, conflict: outcome.conflict ?? null });
          } else {
            set({ ...outcome.status, syncing: false, lastSyncedAt: Date.now(), conflict: null });
          }
        } catch (err) {
          set({ syncing: false, syncError: errorMessage(err) });
          return;
        }
        await get().refresh(); // a fast-forward/merge may have moved HEAD/working tree
      },

      resolveConflict: async (resolutions) => {
        const pending = get().conflict;
        if (!pending) return;
        set({ syncing: "sync", syncError: null });
        try {
          const status = await resolveConflictAndPush(remoteConfig(), pending, resolutions);
          set({ ...status, syncing: false, lastSyncedAt: Date.now(), conflict: null });
        } catch (err) {
          // The conflict state is deliberately KEPT on failure (e.g. the
          // push itself rejected) — the user's resolution choices aren't
          // lost, they can just retry "Resolve & push" once whatever
          // failed (offline, auth) is fixed.
          set({ syncing: false, syncError: errorMessage(err) });
          return;
        }
        await get().refresh();
      },

      cancelConflict: () => set({ conflict: null }),
    }),
    {
      name: "slate-git-sync",
      // v2 (Phase 11): `ahead`/`behind` are no longer persisted at all —
      // they're real, derived-from-refs values now (see module doc), and
      // persisting a stale number across reloads would be exactly the kind
      // of "fake state that can drift from reality" this phase removes.
      // `lastSyncedAt` keeps its v1 shape (still a raw epoch ms, or now
      // `null` for "never synced" — a fresh vault genuinely has no sync
      // history, unlike v1's hardcoded "2m ago" demo seed).
      version: 2,
      migrate: (persisted) => {
        const raw = persisted as { lastSyncedAt?: number };
        return { lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : null };
      },
      partialize: (state) => ({
        lastSyncedAt: state.lastSyncedAt,
      }),
    },
  ),
);

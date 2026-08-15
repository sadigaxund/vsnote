/**
 * Git status + simulated sync state. `statuses`/`branch`/`changedCount` are
 * always recomputed live from the real repo (never persisted — they'd go
 * stale); `ahead`/`behind`/`syncedLabel` are the simulated-remote counters
 * (ARCHITECTURE.md: "simulated remote... ahead/behind counters"), which
 * have no real git backing so they persist to localStorage like
 * `useSettingsStore`, surviving reloads.
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
import { simulateFetch, simulatePull, simulatePush } from "../git/remote";
import type { GitStatus } from "../types";

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
  syncing: false | "push" | "pull" | "fetch";

  // Persisted (simulated — no real remote backs these).
  ahead: number;
  behind: number;
  syncedLabel: string;

  refresh: () => Promise<void>;
  statusFor: (displayPath: string) => GitStatus | undefined;
  diffFor: (displayPath: string) => Promise<FileDiffResult>;
  getCachedDiff: (displayPath: string) => FileDiffResult;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  fetch: () => Promise<void>;
  /** "Sync now" (Phase 5a: the status bar's sync segment + the command
   * palette's "Sync now" command both call this) — pull then push, VSCode's
   * usual single-button "sync" semantics, reusing the same simulated-remote
   * calls `push`/`pull` already use rather than a third code path. */
  syncNow: () => Promise<void>;
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

      ahead: 3,
      behind: 1,
      syncedLabel: "synced 2m ago",

      refresh: async () => {
        const [{ statuses, changedCount, untrackedCount }, branch] = await Promise.all([
          computeStatus(),
          git.currentBranch({ fs, dir: GIT_DIR, fullname: false }).catch(() => DEFAULT_BRANCH),
        ]);
        // Diff results are invalidated wholesale on refresh — cheap to
        // recompute lazily per file via diffFor, and guarantees no stale
        // number ever lingers after an edit/commit/reset.
        set((state) => ({
          statuses,
          changedCount,
          untrackedCount,
          branch: branch ?? DEFAULT_BRANCH,
          diffCache: {},
          refreshGeneration: state.refreshGeneration + 1,
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
        set({ syncing: "push" });
        const next = await simulatePush({ ahead: get().ahead, behind: get().behind });
        set({ ...next, syncing: false, syncedLabel: "synced just now" });
      },

      pull: async () => {
        set({ syncing: "pull" });
        const next = await simulatePull({ ahead: get().ahead, behind: get().behind });
        set({ ...next, syncing: false, syncedLabel: "synced just now" });
      },

      fetch: async () => {
        set({ syncing: "fetch" });
        const next = await simulateFetch({ ahead: get().ahead, behind: get().behind });
        set({ ...next, syncing: false, syncedLabel: "synced just now" });
      },

      syncNow: async () => {
        set({ syncing: "pull" });
        const afterPull = await simulatePull({ ahead: get().ahead, behind: get().behind });
        set({ ahead: afterPull.ahead, behind: afterPull.behind, syncing: "push" });
        const afterPush = await simulatePush({ ahead: afterPull.ahead, behind: afterPull.behind });
        set({ ahead: afterPush.ahead, behind: afterPush.behind, syncing: false, syncedLabel: "synced just now" });
      },
    }),
    {
      name: "slate-git-sync",
      partialize: (state) => ({
        ahead: state.ahead,
        behind: state.behind,
        syncedLabel: state.syncedLabel,
      }),
    },
  ),
);

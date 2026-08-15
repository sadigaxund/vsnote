/**
 * Git status + simulated sync state. `statuses`/`branch`/`changedCount` are
 * always recomputed live from the real repo (never persisted — they'd go
 * stale); `ahead`/`behind`/`lastSyncedAt` are the simulated-remote counters
 * (ARCHITECTURE.md: "simulated remote... ahead/behind counters"), which
 * have no real git backing so they persist to localStorage like
 * `useSettingsStore`, surviving reloads.
 *
 * `lastSyncedAt` is a raw epoch timestamp, not a pre-formatted "synced Xm
 * ago" string — IMPLEMENTATION-PLAN.md Phase 5's "'synced Xm ago' relative
 * timestamp ticking" needs the label to keep advancing between syncs
 * without a store write every tick; `src/lib/relativeTime.ts`'s
 * `formatSyncedLabel` re-derives the string on demand, and
 * `StatusBar.tsx`'s tick interval is what makes the *displayed* label
 * actually count up.
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

/** Ceiling for the simulated "ahead/behind drift" (`driftIncrement`,
 * `hooks/useSyncDrift.ts`) — keeps a long-idle tab's behind-count from
 * climbing forever and reading as broken rather than "someone else is
 * committing upstream". */
const MAX_DRIFT_BEHIND = 9;

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
  /** Epoch ms of the last successful sync/push/pull — see module doc. */
  lastSyncedAt: number;

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
  /** Phase 5b "ahead/behind drift" polish (IMPLEMENTATION-PLAN.md Phase 5):
   * simulates an upstream commit landing while this tab is idle by bumping
   * `behind`. Called from `hooks/useSyncDrift.ts`'s interval, not on every
   * render — a no-op while a real sync is in flight (`syncing`) so drift
   * never races the push/pull counters it's about to overwrite. */
  driftIncrement: () => void;
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
      // Matches DESIGN-SPEC/seed's "synced 2m ago" boot state without
      // hardcoding the formatted string (see module doc).
      lastSyncedAt: Date.now() - 2 * 60_000,

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
        set({ ...next, syncing: false, lastSyncedAt: Date.now() });
      },

      pull: async () => {
        set({ syncing: "pull" });
        const next = await simulatePull({ ahead: get().ahead, behind: get().behind });
        set({ ...next, syncing: false, lastSyncedAt: Date.now() });
      },

      fetch: async () => {
        set({ syncing: "fetch" });
        const next = await simulateFetch({ ahead: get().ahead, behind: get().behind });
        set({ ...next, syncing: false, lastSyncedAt: Date.now() });
      },

      syncNow: async () => {
        set({ syncing: "pull" });
        const afterPull = await simulatePull({ ahead: get().ahead, behind: get().behind });
        set({ ahead: afterPull.ahead, behind: afterPull.behind, syncing: "push" });
        const afterPush = await simulatePush({ ahead: afterPull.ahead, behind: afterPull.behind });
        set({ ahead: afterPush.ahead, behind: afterPush.behind, syncing: false, lastSyncedAt: Date.now() });
      },

      driftIncrement: () => {
        const { syncing, behind } = get();
        if (syncing || behind >= MAX_DRIFT_BEHIND) return;
        set({ behind: behind + 1 });
      },
    }),
    {
      name: "slate-git-sync",
      // v1: `syncedLabel` (a pre-formatted string) replaced by `lastSyncedAt`
      // (an epoch timestamp — see module doc). `migrate` best-effort parses
      // a v0 persisted string back into a timestamp so an existing session's
      // "synced Xm ago" doesn't visibly jump to "synced just now" the first
      // time it loads post-upgrade; any shape that doesn't parse just falls
      // through to the current boot default.
      version: 1,
      migrate: (persisted) => {
        const raw = persisted as { ahead?: number; behind?: number; syncedLabel?: string; lastSyncedAt?: number };
        if (typeof raw.lastSyncedAt === "number") {
          return { ahead: raw.ahead ?? 3, behind: raw.behind ?? 1, lastSyncedAt: raw.lastSyncedAt };
        }
        const match = /synced (\d+)([mh]) ago/.exec(raw.syncedLabel ?? "");
        const lastSyncedAt = match
          ? Date.now() - Number(match[1]) * (match[2] === "h" ? 3_600_000 : 60_000)
          : Date.now();
        return { ahead: raw.ahead ?? 3, behind: raw.behind ?? 1, lastSyncedAt };
      },
      partialize: (state) => ({
        ahead: state.ahead,
        behind: state.behind,
        lastSyncedAt: state.lastSyncedAt,
      }),
    },
  ),
);

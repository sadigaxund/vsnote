/**
 * Phase 17 Milestone C1 (docs/IMPLEMENTATION-PLAN-V2.md's Phase 17 section:
 * "Auto-sync policies: manual / every N minutes / on open+close / on-save
 * (debounced); each run = the existing Phase 11 pipeline (fetch -> ff ->
 * push -> clean auto-merge with backup refs -> resolver only for true
 * conflicts)") — this module owns ONLY the scheduling DECISION: when a
 * policy other than "manual" should invoke `useGitStore.getState().syncNow()`.
 * It is never a second sync implementation — `git/sync.ts`'s `runSync` (via
 * `useGitStore.ts`'s `syncNow`) stays the one and only pipeline; every
 * policy below just decides WHEN to call it.
 *
 * Pure + injectable-timer, the same "test seam, not a mocked global"
 * discipline `fs/drafts.ts`'s `setDraftDebounceMsForTests` already
 * established: every timer function (`setTimeout`/`clearTimeout`) is passed
 * in via `AutoSyncSchedulerDeps`, defaulting to the real globals, so
 * `tests/unit/autoSyncPolicy.test.ts` can supply a tiny manual fake clock
 * and assert every scheduling decision (interval ticks, on-save debounce/
 * coalescing, the open-close trigger, every gate) with ZERO real wall-clock
 * waits, while production (wired from `App.tsx`) always uses the real
 * `setTimeout`/`clearTimeout` below.
 */

export type SyncPolicy = "manual" | "interval" | "open-close" | "on-save";

/** Sane floor for "every N minutes" — never a zero/negative/sub-minute
 * timer, which would turn "auto-sync" into a busy-loop against the backend. */
export const MIN_SYNC_INTERVAL_MINUTES = 1;
/** `useSettingsStore`'s own default for a fresh `gitSyncIntervalMinutes`. */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
/** How long the "on-save" policy waits after the LAST settled save before
 * syncing — long enough to coalesce a burst of saves (e.g. ⌘S across
 * several files in a row, or a multi-file batch save) into ONE eventual
 * sync attempt, matching `fs/drafts.ts`'s own coalescing discipline for the
 * draft checkpoint write (`scheduleDraftSave`'s doc). */
export const ON_SAVE_DEBOUNCE_MS = 4_000;

/** Clamps a user-entered/persisted interval to a sane minimum. Non-finite
 * input (NaN, an empty-string parse, Infinity) falls back to the default
 * rather than producing a zero/negative/NaN timer delay; anything else is
 * rounded to the nearest whole minute and floored at
 * `MIN_SYNC_INTERVAL_MINUTES`. Exported so `SettingsView.tsx`'s interval
 * input and this module's own scheduler apply the IDENTICAL bound — never
 * two independently-drifting guesses about what "too small" means. */
export function clampSyncIntervalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.round(minutes));
}

function intervalMinutesToMs(minutes: number): number {
  return clampSyncIntervalMinutes(minutes) * 60_000;
}

/** The live gate state an auto-sync attempt is checked against, read fresh
 * at the moment of every attempt (never captured once) — mirrors
 * `useGitStore`'s own field shapes so a caller can pass `useGitStore.
 * getState()`/`useShareStore.getState()` straight through with no mapping. */
export interface AutoSyncGateState {
  /** `useGitStore`'s `syncing` field — `false`, or the in-flight action's
   * name. Non-`false` means a sync (manual or auto) is already running. */
  syncing: false | string;
  /** `useShareStore`'s `authenticated` field — a hard boolean, `false`
   * until an explicit sign-in resolves. Deliberately NOT the soft/tri-state
   * `reachability` (`"unknown"` until something probes it) for exactly the
   * reason `App.tsx`'s existing 60s background-fetch interval effect
   * documents: gating on `authenticated` means a signed-out session makes
   * ZERO auto-sync attempts, full stop, with no risk of firing on an
   * un-probed "unknown" state. */
  authenticated: boolean;
  /** `useGitStore`'s `conflict` field. A pending (unresolved) conflict
   * means a PREVIOUS sync (auto or manual) is paused waiting on the user —
   * `useGitStore.ts`'s `syncNow` clears any stale conflict the instant it's
   * called again, so retrying automatically here would silently wipe out
   * the user's still-open resolver on every scheduled tick. Auto-sync must
   * leave a paused conflict exactly as a manual run would and never loop on
   * it — see this module's own doc + the Phase 17 brief. */
  conflict: unknown;
}

/** Whether an auto-sync attempt is allowed to fire AT ALL, independent of
 * which policy triggered it — every trigger path below (`attemptSync`)
 * funnels through this one function, so "never while a sync is already
 * running", "never while signed out", and "never retry a paused conflict in
 * a loop" are each enforced in exactly one place. */
export function isAutoSyncAllowed(state: AutoSyncGateState): boolean {
  return state.authenticated && state.syncing === false && state.conflict == null;
}

export interface AutoSyncSchedulerDeps {
  /** Reads the CURRENT policy/interval from `useSettingsStore` — read live
   * at every scheduling decision (never captured once at construction), so
   * a Settings edit takes effect the moment the caller re-invokes `start()`
   * (see `App.tsx`'s wiring: every `gitSyncPolicy`/`gitSyncIntervalMinutes`
   * change re-runs it) — no remount needed, and no risk of a stale closure
   * over the settings object this scheduler was built with. */
  getPolicy: () => { policy: SyncPolicy; intervalMinutes: number };
  /** Reads the CURRENT gate state — same live-read discipline as
   * `getPolicy`. In production this is `() => ({ syncing: useGitStore.
   * getState().syncing, authenticated: useShareStore.getState().
   * authenticated, conflict: useGitStore.getState().conflict })`. */
  getGateState: () => AutoSyncGateState;
  /** The ONE real sync entry point — `useGitStore.getState().syncNow()` in
   * production. Never a second pipeline (see module doc). Errors are the
   * caller's problem exactly as they already are for a manual sync
   * (`syncNow` itself never throws — see `useGitStore.ts`'s doc); this
   * module doesn't need its own try/catch around the call. */
  runSync: () => Promise<void>;
  /** Test seam — see module doc. Defaults to the real globals below. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface AutoSyncScheduler {
  /** Begins interval scheduling if the CURRENT policy is `"interval"`; a
   * no-op for every other policy (they're driven by their own `notify*`/
   * `trigger*` calls below instead). Safe to call more than once — always
   * tears down any interval timer it already owns first, so calling it
   * again after a policy change re-derives scheduling from scratch. */
  start: () => void;
  /** Tears down whatever timer is currently pending (an interval tick or a
   * debounced on-save write) — call on unmount. */
  stop: () => void;
  /** "on-save" policy hook — call every time a save settles (both existing
   * save call sites in `App.tsx`). Debounces: repeated calls within
   * `ON_SAVE_DEBOUNCE_MS` of each other coalesce into ONE eventual sync
   * attempt. A no-op for every other policy (still safe to call
   * unconditionally from every save site regardless of the active policy). */
  notifySaveSettled: () => void;
  /** "open-close" policy hook — call once at app open and once when the
   * app is about to close/hide (`visibilitychange` -> hidden, the same
   * signal `App.tsx`'s existing dirty-draft flush already uses). Fires an
   * IMMEDIATE sync attempt (still gated by `isAutoSyncAllowed`); a no-op
   * for every other policy. */
  triggerOpenClose: () => void;
}

/** Builds a scheduler instance. Stateful (owns its own pending timer
 * handles) but every decision it makes is either a call to one of the pure
 * functions above or a live read via `deps` — nothing here is captured
 * once at construction time other than the `deps` object itself. */
export function createAutoSyncScheduler(deps: AutoSyncSchedulerDeps): AutoSyncScheduler {
  const setTimeoutFn = deps.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let intervalHandle: unknown = null;
  let debounceHandle: unknown = null;

  function attemptSync(): void {
    if (!isAutoSyncAllowed(deps.getGateState())) return;
    void deps.runSync();
  }

  function clearIntervalTimer(): void {
    if (intervalHandle !== null) {
      clearTimeoutFn(intervalHandle);
      intervalHandle = null;
    }
  }

  function clearDebounceTimer(): void {
    if (debounceHandle !== null) {
      clearTimeoutFn(debounceHandle);
      debounceHandle = null;
    }
  }

  // Recursive setTimeout, not setInterval: re-reads the CURRENT policy/
  // interval every time a tick reschedules itself, so a policy/interval
  // change is picked up by the tick already in flight's OWN reschedule at
  // the latest — and immediately, with no wait at all, if the caller
  // re-invokes `start()` itself (it tears down whatever's pending first —
  // see below). Also never compounds drift the way a fixed `setInterval`
  // can if a single tick's `attemptSync` call ever took noticeably long.
  function scheduleNextInterval(): void {
    clearIntervalTimer();
    const { policy, intervalMinutes } = deps.getPolicy();
    if (policy !== "interval") return;
    intervalHandle = setTimeoutFn(() => {
      intervalHandle = null;
      attemptSync();
      scheduleNextInterval();
    }, intervalMinutesToMs(intervalMinutes));
  }

  return {
    start: () => {
      scheduleNextInterval();
    },
    stop: () => {
      clearIntervalTimer();
      clearDebounceTimer();
    },
    notifySaveSettled: () => {
      const { policy } = deps.getPolicy();
      if (policy !== "on-save") return;
      clearDebounceTimer();
      debounceHandle = setTimeoutFn(() => {
        debounceHandle = null;
        attemptSync();
      }, ON_SAVE_DEBOUNCE_MS);
    },
    triggerOpenClose: () => {
      const { policy } = deps.getPolicy();
      if (policy !== "open-close") return;
      attemptSync();
    },
  };
}

/**
 * Pins `git/autoSyncPolicy.ts`'s scheduling contract (Phase 17 Milestone
 * C1): when each policy fires, that it always funnels through the ONE
 * `runSync` dependency (never a second pipeline), and every gate ("never
 * while syncing", "never while signed out", "never retry a paused conflict
 * in a loop") holds for every policy.
 *
 * Uses a tiny hand-rolled fake clock instead of real timers OR vitest's
 * `vi.useFakeTimers()` — the module's own `setTimeoutFn`/`clearTimeoutFn`
 * injection seam (mirroring `fs/drafts.ts`'s `setDraftDebounceMsForTests`)
 * is the thing under test here as much as the scheduling logic itself, so
 * exercising it directly (rather than swapping vitest's global clock) is
 * both a more direct test of the actual production wiring (`App.tsx` passes
 * the real `setTimeout`/`clearTimeout` the exact same way) and keeps this
 * suite at zero real wall-clock cost.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSyncIntervalMinutes,
  createAutoSyncScheduler,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  isAutoSyncAllowed,
  MIN_SYNC_INTERVAL_MINUTES,
  ON_SAVE_DEBOUNCE_MS,
  type AutoSyncGateState,
  type SyncPolicy,
} from "../../src/git/autoSyncPolicy";

/** A minimal manual fake clock: `setTimeout`/`clearTimeout` stand-ins that
 * record pending callbacks instead of scheduling anything real, plus an
 * `advance(ms)` that fires every callback whose delay has now elapsed, in
 * due-time order — including any timer a fired callback itself schedules
 * (e.g. `scheduleNextInterval`'s self-rescheduling), so a single `advance`
 * call can cross several ticks at once. */
class FakeClock {
  private now = 0;
  private nextId = 1;
  private timers: { id: number; due: number; fn: () => void }[] = [];

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, due: this.now + ms, fn });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers].sort((a, b) => a.due - b.due).find((t) => t.due <= target);
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.now = due.due;
      due.fn();
    }
    this.now = target;
  }

  pendingCount(): number {
    return this.timers.length;
  }
}

const OK_GATE: AutoSyncGateState = { syncing: false, authenticated: true, conflict: null };

function makeScheduler(opts: {
  clock: FakeClock;
  policy: SyncPolicy;
  intervalMinutes?: number;
  gate?: AutoSyncGateState;
  runSync: () => Promise<void>;
}) {
  let policy = opts.policy;
  let intervalMinutes = opts.intervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES;
  let gate = opts.gate ?? OK_GATE;
  const scheduler = createAutoSyncScheduler({
    getPolicy: () => ({ policy, intervalMinutes }),
    getGateState: () => gate,
    runSync: opts.runSync,
    setTimeoutFn: opts.clock.setTimeout,
    clearTimeoutFn: opts.clock.clearTimeout,
  });
  return {
    scheduler,
    setPolicy: (p: SyncPolicy) => (policy = p),
    setIntervalMinutes: (m: number) => (intervalMinutes = m),
    setGate: (g: AutoSyncGateState) => (gate = g),
  };
}

describe("git/autoSyncPolicy.ts — pure gate functions", () => {
  it("isAutoSyncAllowed: true only when authenticated, not syncing, and no pending conflict", () => {
    expect(isAutoSyncAllowed({ syncing: false, authenticated: true, conflict: null })).toBe(true);
    expect(isAutoSyncAllowed({ syncing: "sync", authenticated: true, conflict: null })).toBe(false);
    expect(isAutoSyncAllowed({ syncing: false, authenticated: false, conflict: null })).toBe(false);
    expect(isAutoSyncAllowed({ syncing: false, authenticated: true, conflict: { some: "conflict" } })).toBe(false);
  });

  it("clampSyncIntervalMinutes: floors at MIN_SYNC_INTERVAL_MINUTES", () => {
    expect(clampSyncIntervalMinutes(0)).toBe(MIN_SYNC_INTERVAL_MINUTES);
    expect(clampSyncIntervalMinutes(-5)).toBe(MIN_SYNC_INTERVAL_MINUTES);
    expect(clampSyncIntervalMinutes(0.4)).toBe(MIN_SYNC_INTERVAL_MINUTES);
  });

  it("clampSyncIntervalMinutes: rounds a fractional value above the floor", () => {
    expect(clampSyncIntervalMinutes(5.6)).toBe(6);
    expect(clampSyncIntervalMinutes(5.4)).toBe(5);
  });

  it("clampSyncIntervalMinutes: non-finite input falls back to the default rather than NaN/Infinity", () => {
    expect(clampSyncIntervalMinutes(NaN)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES);
    expect(clampSyncIntervalMinutes(Infinity)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES);
    expect(clampSyncIntervalMinutes(-Infinity)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES);
  });
});

describe("git/autoSyncPolicy.ts — createAutoSyncScheduler", () => {
  let clock: FakeClock;
  let runSync: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    clock = new FakeClock();
    runSync = vi.fn(async () => {});
  });

  it('"manual" policy: start() schedules nothing, ever', () => {
    const { scheduler } = makeScheduler({ clock, policy: "manual", runSync });
    scheduler.start();
    clock.advance(24 * 60 * 60_000); // a full day
    expect(runSync).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it('"interval" policy: fires once per interval, using the CURRENT intervalMinutes', () => {
    const { scheduler } = makeScheduler({ clock, policy: "interval", intervalMinutes: 5, runSync });
    scheduler.start();
    clock.advance(5 * 60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    expect(runSync).toHaveBeenCalledTimes(1);
    clock.advance(5 * 60_000);
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it('"interval" policy: re-invoking start() after a live interval change reschedules IMMEDIATELY off the new value', () => {
    // Mirrors App.tsx's real wiring: a Settings edit to gitSyncIntervalMinutes
    // re-runs `start()` (its effect's dep array includes the interval), which
    // tears down whatever's pending and reschedules fresh off the CURRENT
    // (now-changed) value — no need to wait out the stale 10-minute timer.
    const { scheduler, setIntervalMinutes } = makeScheduler({ clock, policy: "interval", intervalMinutes: 10, runSync });
    scheduler.start();
    clock.advance(5 * 60_000); // partway through the original 10-minute wait
    expect(runSync).not.toHaveBeenCalled();
    setIntervalMinutes(1);
    scheduler.start();
    clock.advance(60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('"interval" policy: WITHOUT re-invoking start(), a live interval change is picked up at latest by the reschedule after the tick already in flight', () => {
    const { scheduler, setIntervalMinutes } = makeScheduler({ clock, policy: "interval", intervalMinutes: 10, runSync });
    scheduler.start();
    clock.advance(10 * 60_000); // the already-scheduled tick fires (still on the OLD 10-minute cadence)
    expect(runSync).toHaveBeenCalledTimes(1);
    setIntervalMinutes(1); // changed AFTER that tick already rescheduled itself off the old value
    clock.advance(10 * 60_000 - 1); // the pending reschedule was computed at 10 minutes, before the change
    expect(runSync).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it('"interval" policy: switching to "manual" mid-flight stops future ticks once start() is re-run', () => {
    const { scheduler, setPolicy } = makeScheduler({ clock, policy: "interval", intervalMinutes: 5, runSync });
    scheduler.start();
    setPolicy("manual");
    scheduler.start(); // App.tsx re-runs start() on every policy/interval change (see its own wiring)
    clock.advance(60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('"interval" policy: interval bound — a sub-minimum interval still schedules at MIN_SYNC_INTERVAL_MINUTES, never a runaway sub-minute loop', () => {
    const { scheduler } = makeScheduler({ clock, policy: "interval", intervalMinutes: 0, runSync });
    scheduler.start();
    clock.advance(MIN_SYNC_INTERVAL_MINUTES * 60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('"interval" policy: stop() cancels the pending tick', () => {
    const { scheduler } = makeScheduler({ clock, policy: "interval", intervalMinutes: 5, runSync });
    scheduler.start();
    scheduler.stop();
    clock.advance(60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it('"on-save" policy: notifySaveSettled debounces/coalesces a burst of saves into ONE sync attempt', () => {
    const { scheduler } = makeScheduler({ clock, policy: "on-save", runSync });
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS - 1);
    scheduler.notifySaveSettled(); // resets the debounce window
    clock.advance(ON_SAVE_DEBOUNCE_MS - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('"on-save" policy: two saves far enough apart produce two sync attempts', () => {
    const { scheduler } = makeScheduler({ clock, policy: "on-save", runSync });
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    expect(runSync).toHaveBeenCalledTimes(1);
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it('notifySaveSettled is a no-op under every OTHER policy', () => {
    for (const policy of ["manual", "interval", "open-close"] as const) {
      const { scheduler } = makeScheduler({ clock, policy, runSync });
      scheduler.notifySaveSettled();
      clock.advance(ON_SAVE_DEBOUNCE_MS * 2);
    }
    expect(runSync).not.toHaveBeenCalled();
  });

  it('"open-close" policy: triggerOpenClose fires an IMMEDIATE attempt, no timer involved', () => {
    const { scheduler } = makeScheduler({ clock, policy: "open-close", runSync });
    scheduler.triggerOpenClose();
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
    scheduler.triggerOpenClose();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("triggerOpenClose is a no-op under every OTHER policy", () => {
    for (const policy of ["manual", "interval", "on-save"] as const) {
      const { scheduler } = makeScheduler({ clock, policy, runSync });
      scheduler.triggerOpenClose();
    }
    expect(runSync).not.toHaveBeenCalled();
  });

  it("never fires while a sync is already running, for every policy", () => {
    const busyGate: AutoSyncGateState = { syncing: "sync", authenticated: true, conflict: null };
    const interval = makeScheduler({ clock, policy: "interval", intervalMinutes: 1, gate: busyGate, runSync });
    interval.scheduler.start();
    clock.advance(60_000);
    const onSave = makeScheduler({ clock, policy: "on-save", gate: busyGate, runSync });
    onSave.scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    const openClose = makeScheduler({ clock, policy: "open-close", gate: busyGate, runSync });
    openClose.scheduler.triggerOpenClose();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("never fires while signed out, for every policy", () => {
    const signedOutGate: AutoSyncGateState = { syncing: false, authenticated: false, conflict: null };
    const interval = makeScheduler({ clock, policy: "interval", intervalMinutes: 1, gate: signedOutGate, runSync });
    interval.scheduler.start();
    clock.advance(60_000);
    const onSave = makeScheduler({ clock, policy: "on-save", gate: signedOutGate, runSync });
    onSave.scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    const openClose = makeScheduler({ clock, policy: "open-close", gate: signedOutGate, runSync });
    openClose.scheduler.triggerOpenClose();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('"interval" policy: a paused conflict from a prior sync suppresses every later tick, no retry loop', () => {
    let gate: AutoSyncGateState = OK_GATE;
    let runCount = 0;
    // Simulates the real pipeline: the FIRST run pauses on a true conflict
    // — `useGitStore.ts`'s `syncNow` clears `syncing` but leaves `conflict`
    // set, exactly what `isAutoSyncAllowed` must respect on every later
    // attempt (no auto-retry/auto-resolve).
    const scheduler = createAutoSyncScheduler({
      getPolicy: () => ({ policy: "interval", intervalMinutes: 1 }),
      getGateState: () => gate,
      runSync: async () => {
        runCount++;
        gate = { syncing: false, authenticated: true, conflict: { conflicts: ["notes/a.md"] } };
      },
      setTimeoutFn: clock.setTimeout,
      clearTimeoutFn: clock.clearTimeout,
    });
    scheduler.start();
    clock.advance(60_000); // first tick: runs, pauses on conflict
    expect(runCount).toBe(1);
    clock.advance(60_000 * 5); // several more ticks: must NOT retry while conflict is pending
    expect(runCount).toBe(1);
    expect(isAutoSyncAllowed(gate)).toBe(false);
  });
});

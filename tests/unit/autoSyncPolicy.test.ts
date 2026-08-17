/**
 * Pins `git/autoSyncPolicy.ts`'s scheduling contract (Phase 17 Milestone
 * C1, reworked round 7 item 54): the three COMBINABLE trigger toggles, that
 * every trigger funnels through the ONE `runSync` dependency via the
 * coalescing queue (at most one run in flight; a completed run opens a
 * quiet window that merges further triggers into a single follow-up), and
 * every gate ("never while syncing", "never while signed out", "never
 * retry a paused conflict in a loop") holds for every trigger.
 *
 * Uses a tiny hand-rolled fake clock instead of real timers OR vitest's
 * `vi.useFakeTimers()` — the module's own `setTimeoutFn`/`clearTimeoutFn`/
 * `nowFn` injection seam is the thing under test here as much as the
 * scheduling logic itself. Queue tests are async: a run's completion
 * bookkeeping lands on the microtask queue (`runSync().finally(...)`), so
 * each `advance` is followed by a microtask flush.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSyncIntervalMinutes,
  createAutoSyncScheduler,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  isAutoSyncAllowed,
  MIN_SYNC_INTERVAL_MINUTES,
  ON_SAVE_DEBOUNCE_MS,
  SYNC_QUIET_WINDOW_MS,
  type AutoSyncGateState,
  type SyncTriggers,
} from "../../src/git/autoSyncPolicy";

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

  nowMs = (): number => this.now;

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

/** Drains the microtask queue so a completed `runSync`'s `.finally`
 * bookkeeping (running=false, lastCompletedAt, pending drain scheduling)
 * has settled before the next assertion/advance. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const OK_GATE: AutoSyncGateState = { syncing: false, authenticated: true, conflict: null };
const OFF: SyncTriggers = { interval: false, openClose: false, onSave: false, intervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES };

function makeScheduler(opts: {
  clock: FakeClock;
  triggers?: Partial<SyncTriggers>;
  gate?: AutoSyncGateState;
  runSync: () => Promise<void>;
}) {
  let triggers: SyncTriggers = { ...OFF, ...opts.triggers };
  let gate = opts.gate ?? OK_GATE;
  const scheduler = createAutoSyncScheduler({
    getPolicy: () => triggers,
    getGateState: () => gate,
    runSync: opts.runSync,
    setTimeoutFn: opts.clock.setTimeout,
    clearTimeoutFn: opts.clock.clearTimeout,
    nowFn: opts.clock.nowMs,
  });
  return {
    scheduler,
    setTriggers: (next: Partial<SyncTriggers>) => (triggers = { ...triggers, ...next }),
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

  it("all toggles off (manual): start() schedules nothing, ever", () => {
    const { scheduler } = makeScheduler({ clock, runSync });
    scheduler.start();
    clock.advance(24 * 60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("interval: fires once per interval, using the CURRENT intervalMinutes", async () => {
    const { scheduler } = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 5 }, runSync });
    scheduler.start();
    clock.advance(5 * 60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
    clock.advance(5 * 60_000);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("interval: re-invoking start() after a live interval change reschedules IMMEDIATELY off the new value", async () => {
    const { scheduler, setTriggers } = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 10 }, runSync });
    scheduler.start();
    clock.advance(5 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
    setTriggers({ intervalMinutes: 1 });
    scheduler.start();
    clock.advance(60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("interval: switching it off mid-flight stops future ticks once start() is re-run", () => {
    const { scheduler, setTriggers } = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 5 }, runSync });
    scheduler.start();
    setTriggers({ interval: false });
    scheduler.start();
    clock.advance(60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("interval: a sub-minimum interval still schedules at MIN_SYNC_INTERVAL_MINUTES, never a runaway sub-minute loop", async () => {
    const { scheduler } = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 0 }, runSync });
    scheduler.start();
    clock.advance(MIN_SYNC_INTERVAL_MINUTES * 60_000 - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("interval: stop() cancels the pending tick", () => {
    const { scheduler } = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 5 }, runSync });
    scheduler.start();
    scheduler.stop();
    clock.advance(60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("onSave: notifySaveSettled debounces/coalesces a burst of saves into ONE sync attempt", async () => {
    const { scheduler } = makeScheduler({ clock, triggers: { onSave: true }, runSync });
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS - 1);
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS - 1);
    expect(runSync).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("onSave: a second save inside the quiet window coalesces into ONE follow-up run at window close (round 7 item 54)", async () => {
    const { scheduler } = makeScheduler({ clock, triggers: { onSave: true }, runSync });
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1); // completed; quiet window open

    // Two more saves land within the window — both merge into one pending.
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    await flush();
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1); // still inside the window
    clock.advance(SYNC_QUIET_WINDOW_MS);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(2); // exactly one follow-up
  });

  it("notifySaveSettled is a no-op while the onSave toggle is off, whatever else is on", () => {
    const { scheduler } = makeScheduler({ clock, triggers: { interval: true, openClose: true }, runSync });
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS * 2);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("openClose: triggerOpenClose fires an IMMEDIATE attempt", async () => {
    const { scheduler } = makeScheduler({ clock, triggers: { openClose: true }, runSync });
    scheduler.triggerOpenClose();
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("triggerOpenClose is a no-op while the openClose toggle is off", () => {
    const { scheduler } = makeScheduler({ clock, triggers: { interval: true, onSave: true }, runSync });
    scheduler.triggerOpenClose();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("all three toggles on: stacked triggers inside one quiet window collapse to a single follow-up run", async () => {
    const { scheduler } = makeScheduler({
      clock,
      triggers: { interval: true, openClose: true, onSave: true, intervalMinutes: 1 },
      runSync,
    });
    scheduler.start();
    scheduler.triggerOpenClose(); // app open: immediate run
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);

    // Inside the quiet window: a save debounce fires AND an interval tick
    // would… (interval is 1 minute, still pending) — plus another
    // open/close trigger. All merge into one pending follow-up.
    scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    await flush();
    scheduler.triggerOpenClose();
    await flush();
    expect(runSync).toHaveBeenCalledTimes(1);
    clock.advance(SYNC_QUIET_WINDOW_MS);
    await flush();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("at most one run in flight: triggers during a slow run set ONE pending follow-up", async () => {
    let release: () => void = () => {};
    const slowRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { scheduler } = makeScheduler({ clock, triggers: { openClose: true }, runSync: slowRun });
    scheduler.triggerOpenClose(); // starts, does not complete yet
    scheduler.triggerOpenClose(); // during the run
    scheduler.triggerOpenClose(); // during the run
    expect(slowRun).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(slowRun).toHaveBeenCalledTimes(1); // follow-up waits out the window
    clock.advance(SYNC_QUIET_WINDOW_MS);
    await flush();
    expect(slowRun).toHaveBeenCalledTimes(2); // the three extra triggers = one run
  });

  it("never fires while a sync is already running (manual click), for every trigger", () => {
    const busyGate: AutoSyncGateState = { syncing: "sync", authenticated: true, conflict: null };
    const interval = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 1 }, gate: busyGate, runSync });
    interval.scheduler.start();
    clock.advance(60_000);
    const onSave = makeScheduler({ clock, triggers: { onSave: true }, gate: busyGate, runSync });
    onSave.scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    const openClose = makeScheduler({ clock, triggers: { openClose: true }, gate: busyGate, runSync });
    openClose.scheduler.triggerOpenClose();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("never fires while signed out, for every trigger", () => {
    const signedOutGate: AutoSyncGateState = { syncing: false, authenticated: false, conflict: null };
    const interval = makeScheduler({ clock, triggers: { interval: true, intervalMinutes: 1 }, gate: signedOutGate, runSync });
    interval.scheduler.start();
    clock.advance(60_000);
    const onSave = makeScheduler({ clock, triggers: { onSave: true }, gate: signedOutGate, runSync });
    onSave.scheduler.notifySaveSettled();
    clock.advance(ON_SAVE_DEBOUNCE_MS);
    const openClose = makeScheduler({ clock, triggers: { openClose: true }, gate: signedOutGate, runSync });
    openClose.scheduler.triggerOpenClose();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("interval: a paused conflict from a prior sync suppresses every later tick, no retry loop", async () => {
    let gate: AutoSyncGateState = OK_GATE;
    let runCount = 0;
    const scheduler = createAutoSyncScheduler({
      getPolicy: () => ({ interval: true, openClose: false, onSave: false, intervalMinutes: 1 }),
      getGateState: () => gate,
      runSync: async () => {
        runCount++;
        gate = { syncing: false, authenticated: true, conflict: { conflicts: ["notes/a.md"] } };
      },
      setTimeoutFn: clock.setTimeout,
      clearTimeoutFn: clock.clearTimeout,
      nowFn: clock.nowMs,
    });
    scheduler.start();
    clock.advance(60_000);
    await flush();
    expect(runCount).toBe(1);
    clock.advance(60_000 * 5);
    await flush();
    expect(runCount).toBe(1);
    expect(isAutoSyncAllowed(gate)).toBe(false);
  });
});

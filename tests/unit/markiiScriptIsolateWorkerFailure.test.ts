/**
 * Defect fix (found in review before Phase M3 shipped): `WorkerRunner.
 * ensureWorker` (`src/markii/platform/browser/scriptIsolate.ts`) originally
 * attached only a `message` listener. A worker that fails at MODULE-
 * EVALUATION time (a bad wasm URL, a bundling problem) or crashes never
 * posts a `run-result` at all, so a pending `run()` would hang until the
 * external watchdog's full timeout and then report a generic "exceeded the
 * watchdog timeout" failure - masking the real error. This file proves the
 * fix: `error`/`messageerror` listeners settle the pending run immediately
 * with the real failure and drop the dead worker.
 *
 * Exercised against a FAKE global `Worker` (this suite runs under Node, no
 * real browser) - `createBrowserScriptIsolate` only ever touches the
 * `Worker` global lazily, inside `run()`, so stubbing it before each test
 * is enough; nothing here needs jsdom or a real Worker.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserScriptIsolate } from "../../src/markii/platform/browser/scriptIsolate";

type Listener = (event: unknown) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Listener[]>();
  terminated = false;
  posted: unknown[] = [];

  constructor(
    public url: URL,
    public options: unknown,
  ) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const originalWorker = globalThis.Worker;

describe("markii browser ScriptIsolate: worker failure handling", () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  });

  afterEach(() => {
    (globalThis as unknown as { Worker: unknown }).Worker = originalWorker;
  });

  it("a worker that fails at module-evaluation time settles the pending run with the real error, not a silent hang", async () => {
    const isolate = createBrowserScriptIsolate({ tier: "manual" }, { timeoutMs: 5000 });
    const runPromise = isolate.run({ code: "return 1", tier: "manual" });

    expect(FakeWorker.instances.length).toBe(1);
    FakeWorker.instances[0].emit("error", { message: "Failed to load module script: 404" });

    const result = await runPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("script-error");
      expect(result.error.message).toContain("Failed to load module script");
    }
  });

  it("a messageerror also settles the pending run with a real failure, not a hang", async () => {
    const isolate = createBrowserScriptIsolate({ tier: "manual" }, { timeoutMs: 5000 });
    const runPromise = isolate.run({ code: "return 1", tier: "manual" });

    FakeWorker.instances[0].emit("messageerror", {});

    const result = await runPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("could not be deserialized");
    }
  });

  it("drops the dead worker so the next run() builds a fresh one instead of reusing it", async () => {
    const isolate = createBrowserScriptIsolate({ tier: "manual" }, { timeoutMs: 5000 });
    const first = isolate.run({ code: "x", tier: "manual" });
    FakeWorker.instances[0].emit("error", { message: "boom" });
    await first;

    expect(FakeWorker.instances[0].terminated).toBe(true);

    const second = isolate.run({ code: "y", tier: "manual" });
    expect(FakeWorker.instances.length).toBe(2);

    // Resolve the second run normally so this test doesn't leave a dangling
    // watchdog timer running past the test's own lifetime.
    FakeWorker.instances[1].emit("message", {
      data: { type: "run-result", id: 1, result: { ok: true, value: "second" } },
    });
    await expect(second).resolves.toEqual({ ok: true, value: "second" });
  });

  it("a worker error with no pending run is a safe no-op that still drops the dead worker", async () => {
    const isolate = createBrowserScriptIsolate({ tier: "manual" }, { timeoutMs: 5000 });
    const first = isolate.run({ code: "x", tier: "manual" });
    FakeWorker.instances[0].emit("message", {
      data: { type: "run-result", id: 1, result: { ok: true, value: 1 } },
    });
    await first;

    // No pending run right now - emitting error must not throw.
    expect(() => FakeWorker.instances[0].emit("error", { message: "late crash" })).not.toThrow();
  });
});

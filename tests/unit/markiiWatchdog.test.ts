/**
 * `src/markii/host/watchdog.ts`'s external kill switch — the §10 guarantee
 * that a script isolate is terminated within its configured wall-clock
 * budget REGARDLESS of whether the underlying runner ever settles on its
 * own. Deliberately exercised against a fake `TerminableRunner` (never a
 * real Worker/wasmoon) — the whole point of `watchdog.ts` being
 * platform-agnostic is that this property is provable with plain
 * `setTimeout`, no browser required.
 */
import { describe, expect, it, vi } from "vitest";
import { createWatchdogIsolate, type TerminableRunner } from "../../src/markii/host/watchdog";

function hangingRunner(): { runner: TerminableRunner; terminate: ReturnType<typeof vi.fn> } {
  const terminate = vi.fn();
  const runner: TerminableRunner = {
    run: () => new Promise(() => {}), // never resolves, never rejects
    terminate,
  };
  return { runner, terminate };
}

describe("markii watchdog", () => {
  it("terminates and reports a limit failure when the runner never resolves", async () => {
    const { runner, terminate } = hangingRunner();
    const isolate = createWatchdogIsolate({ timeoutMs: 30, createRunner: () => runner });

    const start = Date.now();
    const result = await isolate.run({ code: "while true do end", tier: "manual" });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("limit");
    }
    expect(terminate).toHaveBeenCalledTimes(1);
    // Generous upper bound so this isn't flaky under CI load; still proves
    // the watchdog didn't hang indefinitely.
    expect(elapsed).toBeLessThan(2000);
  });

  it("resolves normally, without ever terminating, when the runner settles before the timeout", async () => {
    const terminate = vi.fn();
    const runner: TerminableRunner = {
      run: async () => ({ ok: true, value: 42 }),
      terminate,
    };
    const isolate = createWatchdogIsolate({ timeoutMs: 1000, createRunner: () => runner });

    const result = await isolate.run({ code: "return 42", tier: "manual" });

    expect(result).toEqual({ ok: true, value: 42 });
    expect(terminate).not.toHaveBeenCalled();
  });

  it("recreates a fresh runner for the next call after a terminate, never reusing the dead one", async () => {
    const { runner: firstRunner } = hangingRunner();
    let created = 0;
    const secondRunner: TerminableRunner = {
      run: async () => ({ ok: true, value: "second" }),
      terminate: vi.fn(),
    };
    const isolate = createWatchdogIsolate({
      timeoutMs: 20,
      createRunner: () => {
        created += 1;
        return created === 1 ? firstRunner : secondRunner;
      },
    });

    const first = await isolate.run({ code: "hang", tier: "manual" });
    expect(first.ok).toBe(false);

    const second = await isolate.run({ code: "return 'second'", tier: "manual" });
    expect(second).toEqual({ ok: true, value: "second" });
    expect(created).toBe(2);
  });

  it("dispose() terminates a live runner and is safe to call when there is none", () => {
    const terminate = vi.fn();
    const isolate = createWatchdogIsolate({
      timeoutMs: 1000,
      createRunner: () => ({ run: () => new Promise(() => {}), terminate }),
    });
    expect(() => isolate.dispose()).not.toThrow(); // no runner created yet
    void isolate.run({ code: "x", tier: "manual" });
    isolate.dispose();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("a runner that throws synchronously is reported as a script-error failure, not an unhandled rejection", async () => {
    const isolate = createWatchdogIsolate({
      timeoutMs: 1000,
      createRunner: () => ({
        run: () => Promise.reject(new Error("boom")),
        terminate: vi.fn(),
      }),
    });
    const result = await isolate.run({ code: "x", tier: "manual" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("script-error");
      expect(result.error.message).toContain("boom");
    }
  });
});

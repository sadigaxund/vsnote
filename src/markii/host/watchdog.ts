/**
 * Phase M3 §10 kill switch, platform-agnostic half.
 *
 * `@markii/lua`'s own in-VM `limits` (instruction count, wall-clock via a
 * `lua_sethook` count hook, memory cap) are a REAL, useful layer — see that
 * package's `limits.ts` doc comment — but its own author is explicit that
 * they are "best-effort, not airtight": the hook only fires BETWEEN Lua VM
 * instructions, so it cannot preempt a single WASM-synchronous hang, an
 * as-yet-undiscovered catch construct, or (the case that matters most here)
 * a host capability call whose promise never resolves — Lua isn't executing
 * any instructions while suspended on an `await`, so the in-VM hook simply
 * never fires during that window. `@markii/lua`'s own docs call the
 * EXTERNAL, terminatable-isolate watchdog "the real guarantee" for exactly
 * that reason.
 *
 * This module is that external guarantee, and it is deliberately
 * independent of wasmoon, Workers, or any browser API: it wraps an
 * arbitrary `TerminableRunner` (something that can `run()` and, on demand,
 * `terminate()`) in a wall-clock race. If `run()` hasn't settled by
 * `timeoutMs`, this module calls `terminate()` on it, discards the runner
 * (so the NEXT call gets a fresh one rather than ever reusing a
 * half-terminated worker), and resolves with a `limit`-kind `ExecuteResult`
 * failure — the same closed vocabulary `@markii/runtime`'s
 * `normalizeFailureKind` understands, so a watchdog kill renders identically
 * to any other resource-limit failure.
 *
 * Being platform-agnostic (no `Worker`, no `postMessage`) is what makes this
 * the piece worker 1's unit tests can exercise directly: a fake
 * `TerminableRunner` whose `run()` never resolves proves the watchdog fires
 * and terminates within the configured timeout, with no jsdom/real-Worker
 * dependency at all. `src/markii/platform/browser/scriptIsolate.ts` supplies
 * the real `TerminableRunner` (a Web Worker running `@markii/lua`) and is
 * the only thing that actually needs a browser.
 *
 * "Recreate lazily, never deadlock a queue": `runDocumentScripts`
 * (`@markii/runtime`) calls its `ScriptExecutor` sequentially, one script at
 * a time, always awaiting the previous call before starting the next — so
 * there is never more than one in-flight `run()` per `ScriptIsolate`, and
 * therefore never a queue to deadlock. After a terminate, `runner` is set
 * back to `null`; the NEXT `run()` call (the next script in the same batch,
 * or a later batch entirely) lazily calls `createRunner()` again rather than
 * touching the dead one.
 */
import type { ExecuteResult, ExecutionTier } from "@markii/runtime";
import type { DocViewSnapshot, ScriptIsolate } from "./types";

export interface TerminableRunner {
  run(input: { code: string; tier: ExecutionTier; doc?: DocViewSnapshot }): Promise<ExecuteResult>;
  /** Kills the underlying isolate immediately. Must be safe to call even if `run` never settles. */
  terminate(): void;
}

export interface WatchdogConfig {
  /** Wall-clock milliseconds a single script run may take before this isolate is terminated. */
  timeoutMs: number;
  /** Lazily constructs a fresh runner. Called at most once per live runner; called again after every terminate. */
  createRunner: () => TerminableRunner;
}

function limitFailure(message: string): ExecuteResult {
  return { ok: false, error: { kind: "limit", message } };
}

function toExecuteFailure(err: unknown): ExecuteResult {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { kind: "script-error", message } };
}

/**
 * Wraps `createRunner` in the wall-clock watchdog described above and
 * returns a `ScriptIsolate` (plus `dispose`, for the caller's own
 * end-of-batch cleanup — see `runScripts.ts`).
 */
export function createWatchdogIsolate(config: WatchdogConfig): ScriptIsolate {
  let runner: TerminableRunner | null = null;

  function ensureRunner(): TerminableRunner {
    if (!runner) runner = config.createRunner();
    return runner;
  }

  async function run(input: { code: string; tier: ExecutionTier; doc?: DocViewSnapshot }): Promise<ExecuteResult> {
    const active = ensureRunner();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<ExecuteResult>((resolve) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // The runner that timed out is dead to us regardless of what
        // terminate() itself does internally; drop it so the next call
        // starts fresh rather than ever reusing it.
        if (runner === active) runner = null;
        active.terminate();
        resolve(
          limitFailure(
            `Script run exceeded the ${config.timeoutMs}ms watchdog timeout and was terminated`,
          ),
        );
      }, config.timeoutMs);
    });

    try {
      const result = await Promise.race([
        active.run(input).then((r) => {
          settled = true;
          return r;
        }),
        timeoutPromise,
      ]);
      return result;
    } catch (err) {
      settled = true;
      return toExecuteFailure(err);
    } finally {
      clearTimeout(timer);
    }
  }

  function dispose(): void {
    if (runner) {
      runner.terminate();
      runner = null;
    }
  }

  return { run, dispose };
}

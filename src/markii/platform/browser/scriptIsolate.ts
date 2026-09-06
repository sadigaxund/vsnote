/**
 * Phase M3 — the main-thread half of the `ScriptIsolate` port
 * (`src/markii/host/types.ts`): spawns `scriptIsolate.worker.ts` as a
 * dedicated Web Worker, speaks `workerProtocol.ts`'s message shapes to it,
 * bridges the worker's `net-call` RPC to a real `NetProvider`, and wraps the
 * whole thing in `src/markii/host/watchdog.ts`'s platform-agnostic wall-clock
 * kill switch.
 *
 * ## Two layers of limits, and why both exist
 *
 * `@markii/lua`'s own `limits` option (default: 100M instructions, 5000ms
 * wall clock via an in-VM hook, 32MiB memory — see that package's
 * `limits.ts`) is real and effective for the common case: ordinary
 * CPU-bound runaway Lua (an infinite loop, a huge table build) is caught
 * IN-PROCESS, with a precise, typed `kind: 'limit'` failure, well before
 * this file's own timeout would ever fire. But it is explicitly
 * "best-effort, not airtight" by its own author's admission: the hook only
 * runs BETWEEN Lua VM instructions, so it cannot observe a hang that
 * happens while Lua is SUSPENDED — the exact shape of a `net.get`/
 * `net.post` call whose promise never resolves (a host `fetch` that hangs,
 * or, on this worker, a `net-call` RPC reply that never arrives because the
 * main thread died or a handler bug swallowed it). `DEFAULT_TIMEOUT_MS`
 * below is set comfortably above the library's own default wall-clock limit
 * (5000ms) specifically so the in-VM hook gets the first, precise shot at
 * ordinary compute-bound runaway scripts, and this watchdog exists purely
 * to catch what that hook structurally cannot: a hung host-side await, or
 * any other way the worker could simply never reply. Both layers are kept —
 * removing either one leaves a real gap the other doesn't cover.
 *
 * ## Recreate lazily, never leak a worker
 *
 * `WorkerRunner` (this file) owns exactly one live `Worker`, created lazily
 * on its first `run()` call. `watchdog.ts`'s `createWatchdogIsolate` is what
 * decides when a runner is dead (a timeout fires) and drops its reference so
 * the NEXT `run()` builds a brand new `WorkerRunner` (and therefore a brand
 * new `Worker`) rather than ever reusing one that was just `terminate()`d —
 * see that module's doc comment for the full "why this can't deadlock" case.
 *
 * ## `doc` is always a `DocViewSnapshot`, never a real `DocView`
 *
 * `@markii/runtime`'s real `DocView` carries a `value(name)` FUNCTION, which
 * cannot cross `postMessage` (`DataCloneError`). `runScripts.ts` (host)
 * converts the real `DocView` into a plain, cloneable `DocViewSnapshot`
 * before ever calling `ScriptIsolate.run` (see `host/docViewSnapshot.ts`'s
 * module doc) — by the time `run` below builds a `RunRequestMessage`, `doc`
 * is already safe to send as-is; `scriptIsolate.worker.ts` reconstructs a
 * real `DocView` from it on the receiving side, right before handing it to
 * `@markii/lua`.
 */
import type { ExecuteResult, ExecutionTier } from "@markii/runtime";
import { DEFAULT_LIMITS } from "@markii/lua";
import type { CapabilityConfig } from "../../host/capabilities";
import { createWatchdogIsolate, type TerminableRunner } from "../../host/watchdog";
import type { DocViewSnapshot, ScriptIsolate } from "../../host/types";
import type {
  BundleCallMessage,
  BundleCallResultMessage,
  CacheCallMessage,
  CacheCallResultMessage,
  MainToWorkerMessage,
  NetCallMessage,
  NetCallResultMessage,
  RunRequestMessage,
  WorkerToMainMessage,
} from "./workerProtocol";

/**
 * Comfortably above `@markii/lua`'s own default `wallClockMs` (5000) — see
 * the module doc's "two layers of limits" section for why this is a
 * SECOND, independent bound rather than a tighter duplicate of the first.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BrowserScriptIsolateOptions {
  /** Wall-clock milliseconds before this run's worker is terminated. Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

class WorkerRunner implements TerminableRunner {
  private worker: Worker | null = null;
  private nextRunId = 0;
  private pendingResolve: ((result: ExecuteResult) => void) | null = null;

  constructor(private readonly config: CapabilityConfig) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./scriptIsolate.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleMessage(event.data);
    });
    // A worker that fails at MODULE-EVALUATION time (a bad wasm URL, a
    // bundling problem, a syntax error in the worker chunk) never posts a
    // `run-result` at all — without these listeners a pending `run()` would
    // simply hang until the external watchdog's full timeout elapsed and
    // then report a generic "exceeded the Nms watchdog timeout" failure,
    // masking the REAL error. `error` fires for that case (and for an
    // uncaught exception during the worker's lifetime); `messageerror`
    // fires when a posted message itself cannot be deserialized on the
    // receiving end. Both settle the pending run immediately with the
    // actual failure and drop the dead worker so the NEXT `run()` builds a
    // fresh one rather than ever touching this one again.
    worker.addEventListener("error", (event: ErrorEvent) => {
      this.handleWorkerFailure(event.message || "the script worker failed to load or crashed");
    });
    worker.addEventListener("messageerror", () => {
      this.handleWorkerFailure("a message to or from the script worker could not be deserialized");
    });
    this.worker = worker;
    return worker;
  }

  private handleWorkerFailure(message: string): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.worker?.terminate();
    this.worker = null;
    resolve?.({ ok: false, error: { kind: "script-error", message } });
  }

  private handleMessage(msg: WorkerToMainMessage): void {
    if (msg.type === "run-result") {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve?.(msg.result);
      return;
    }
    if (msg.type === "net-call") {
      void this.handleNetCall(msg);
      return;
    }
    if (msg.type === "bundle-call") {
      void this.handleBundleCall(msg);
      return;
    }
    void this.handleCacheCall(msg);
  }

  private async handleNetCall(msg: NetCallMessage): Promise<void> {
    const worker = this.worker;
    const net = this.config.net;
    if (!worker) return;
    if (!net) {
      this.replyNetCall(worker, { type: "net-call-result", callId: msg.callId, ok: false, error: "no net provider is configured for this run" });
      return;
    }
    try {
      let result: { status: number; body: string };
      if (msg.method === "get") {
        result = await net.get(msg.url);
      } else if (msg.method === "post") {
        if (!net.post) throw new Error("net.post is not supported by this host");
        result = await net.post(msg.url, msg.body ?? "");
      } else {
        if (!net.patch) throw new Error("net.patch is not supported by this host");
        result = await net.patch(msg.url, msg.body ?? "");
      }
      this.replyNetCall(worker, { type: "net-call-result", callId: msg.callId, ok: true, status: result.status, body: result.body });
    } catch (err) {
      this.replyNetCall(worker, {
        type: "net-call-result",
        callId: msg.callId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private replyNetCall(worker: Worker, message: NetCallResultMessage): void {
    const outbound: MainToWorkerMessage = message;
    worker.postMessage(outbound);
  }

  /**
   * `@markii/bundle`'s `ScriptView` (worker 2) has the same "real functions
   * cannot cross `postMessage`" shape `net` already does — see
   * `workerProtocol.ts`'s module doc's `bundle-call` section. `this.config.
   * bundle` was built by `host/capabilities.ts` ENTIRELY on this (main)
   * thread, honoring the tier/`bundleWrite` gate documented there; this
   * method only ever forwards to whatever `ScriptView` it was already
   * handed — it makes no capability decision of its own.
   */
  private async handleBundleCall(msg: BundleCallMessage): Promise<void> {
    const worker = this.worker;
    const bundle = this.config.bundle;
    if (!worker) return;
    if (!bundle) {
      this.replyBundleCall(worker, { type: "bundle-call-result", callId: msg.callId, ok: false, op: msg.op, error: "no bundle is open for this run" });
      return;
    }
    try {
      if (msg.op === "read") {
        const data = await bundle.read(msg.path);
        this.replyBundleCall(worker, { type: "bundle-call-result", callId: msg.callId, ok: true, op: "read", data });
      } else if (msg.op === "write") {
        await bundle.write(msg.path, msg.data ?? new Uint8Array());
        this.replyBundleCall(worker, { type: "bundle-call-result", callId: msg.callId, ok: true, op: "write" });
      } else {
        const exists = await bundle.exists(msg.path);
        this.replyBundleCall(worker, { type: "bundle-call-result", callId: msg.callId, ok: true, op: "exists", exists });
      }
    } catch (err) {
      this.replyBundleCall(worker, {
        type: "bundle-call-result",
        callId: msg.callId,
        ok: false,
        op: msg.op,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private replyBundleCall(worker: Worker, message: BundleCallResultMessage): void {
    const outbound: MainToWorkerMessage = message;
    worker.postMessage(outbound);
  }

  /** Same RPC pattern as `handleBundleCall`, for `@markii/lua`'s `CacheProvider` (`cache.get`/`cache.set`, worker 2). */
  private async handleCacheCall(msg: CacheCallMessage): Promise<void> {
    const worker = this.worker;
    const cache = this.config.cache;
    if (!worker) return;
    if (!cache) {
      this.replyCacheCall(worker, { type: "cache-call-result", callId: msg.callId, ok: false, op: msg.op, error: "no cache is configured for this run" });
      return;
    }
    try {
      if (msg.op === "get") {
        const entry = await cache.get(msg.key);
        this.replyCacheCall(worker, { type: "cache-call-result", callId: msg.callId, ok: true, op: "get", entry });
      } else {
        await cache.set(msg.key, msg.entry!);
        this.replyCacheCall(worker, { type: "cache-call-result", callId: msg.callId, ok: true, op: "set" });
      }
    } catch (err) {
      this.replyCacheCall(worker, {
        type: "cache-call-result",
        callId: msg.callId,
        ok: false,
        op: msg.op,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private replyCacheCall(worker: Worker, message: CacheCallResultMessage): void {
    const outbound: MainToWorkerMessage = message;
    worker.postMessage(outbound);
  }

  run(input: { code: string; tier: ExecutionTier; doc?: DocViewSnapshot }): Promise<ExecuteResult> {
    const worker = this.ensureWorker();
    const id = ++this.nextRunId;
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      const message: RunRequestMessage = {
        type: "run",
        id,
        code: input.code,
        tier: input.tier,
        doc: input.doc,
        hasNet: Boolean(this.config.net),
        netGrants: this.config.netGrants ?? { get: [], post: [] },
        hasBundle: Boolean(this.config.bundle),
        hasCache: Boolean(this.config.cache),
        packModules: this.config.packModules ?? {},
        limits: DEFAULT_LIMITS,
      };
      worker.postMessage(message);
    });
  }

  terminate(): void {
    // The watchdog's own timeout promise has already resolved the caller's
    // `run()` awaiter by the time this is called (see `watchdog.ts`) — this
    // never rejects/resolves `pendingResolve` itself, it just makes sure the
    // dead worker cannot deliver a stale reply to a FUTURE run's handler
    // (there won't be one: a terminated `Worker` never posts again).
    this.pendingResolve = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

/**
 * Builds a fresh, tier-scoped `ScriptIsolate` for one `runScripts` call —
 * see `runScripts.ts` (host) for why a new one is constructed per run
 * rather than pooled. Internally: a `WorkerRunner` (this file) wrapped in
 * `createWatchdogIsolate` (`host/watchdog.ts`) for the external kill switch.
 */
export function createBrowserScriptIsolate(
  config: CapabilityConfig,
  options?: BrowserScriptIsolateOptions,
): ScriptIsolate {
  return createWatchdogIsolate({
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    createRunner: () => new WorkerRunner(config),
  });
}

/**
 * Phase M3 — the postMessage protocol between `scriptIsolate.ts` (main
 * thread) and `scriptIsolate.worker.ts` (the dedicated Worker running
 * `@markii/lua`).
 *
 * Two message families, in opposite directions:
 *
 * - `run` (main -> worker) / `run-result` (worker -> main): one script
 *   execution request/response. Only one is ever in flight per worker (see
 *   `watchdog.ts`'s doc comment on why `runDocumentScripts` never overlaps
 *   calls), so a single `id` per pending run is enough correlation.
 * - `net-call` (worker -> main) / `net-call-result` (main -> worker): the
 *   RPC bridge for the `net` capability. `@markii/lua`'s `NetProvider` is a
 *   pair of async functions — those cannot cross `postMessage` (functions
 *   are not structured-cloneable) — so the worker's own `NetProvider`
 *   implementation (built in `scriptIsolate.worker.ts`) posts a `net-call`
 *   for every `net.get`/`net.post`/`net.patch` a script makes and awaits the
 *   matching `net-call-result`, which the main thread produces by actually
 *   calling `createBrowserNetProvider()` (`netProvider.ts`). Net calls use
 *   their OWN `callId` counter, independent of and (in principle) able to
 *   interleave with the run/run-result pair they occur during, since a
 *   script's own execution is suspended on the awaited net call.
 *
 * `net`/`cache`/`bundle` capability WIRING beyond `net` itself is out of
 * scope for worker 1 (see `capabilities.ts`'s and `types.ts`'s doc comments
 * — cache and bundle are worker 2's to build on top of this same RPC
 * pattern once bundles exist).
 */
import type { ExecuteResult, ExecutionTier } from "@markii/runtime";
import type { MarshalLimits, NetGrants, ScriptLimits } from "@markii/lua";
import type { DocViewSnapshot } from "../../host/docViewSnapshot";

export interface RunRequestMessage {
  type: "run";
  id: number;
  code: string;
  tier: ExecutionTier;
  /**
   * A cloneable `DocViewSnapshot` (`host/docViewSnapshot.ts`), NEVER a real
   * `@markii/runtime` `DocView` — that type's `value` is a function, which
   * `structuredClone`/`postMessage` cannot carry (`DataCloneError`).
   * `scriptIsolate.worker.ts` calls `reconstructDocView` on this to build
   * the real `DocView` `@markii/lua` actually needs, immediately before
   * running the script.
   */
  doc?: DocViewSnapshot;
  hasNet: boolean;
  netGrants: NetGrants;
  maxFetchBytes?: number;
  limits?: Partial<ScriptLimits>;
  marshalLimits?: Partial<MarshalLimits>;
}

export interface RunResultMessage {
  type: "run-result";
  id: number;
  result: ExecuteResult;
}

export interface NetCallMessage {
  type: "net-call";
  callId: number;
  method: "get" | "post" | "patch";
  url: string;
  body?: string;
}

export type NetCallResultMessage =
  | { type: "net-call-result"; callId: number; ok: true; status: number; body: string }
  | { type: "net-call-result"; callId: number; ok: false; error: string };

export type MainToWorkerMessage = RunRequestMessage | NetCallResultMessage;
export type WorkerToMainMessage = RunResultMessage | NetCallMessage;

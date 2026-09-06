/**
 * Phase M3 — the postMessage protocol between `scriptIsolate.ts` (main
 * thread) and `scriptIsolate.worker.ts` (the dedicated Worker running
 * `@markii/lua`).
 *
 * Message families, in opposite directions:
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
 * - `bundle-call` / `bundle-call-result` (worker 2): the SAME RPC pattern
 *   for `@markii/bundle`'s `ScriptView` — its `read`/`write`/`exists` are
 *   also real, function-carrying methods that cannot cross `postMessage`.
 *   `CapabilityConfig.bundle` (`host/capabilities.ts`) stays on the MAIN
 *   thread (`scriptIsolate.ts`'s `WorkerRunner.config.bundle`); the worker
 *   only ever sees `hasBundle: boolean` in the `run` message and builds a
 *   local `ScriptView`-shaped RPC client from it (`scriptIsolate.worker.ts`'s
 *   `makeBundleClient`) that posts a `bundle-call` per method call.
 * - `cache-call` / `cache-call-result` (worker 2): identical RPC pattern
 *   for `@markii/lua`'s `CacheProvider` (`cache.get`/`cache.set`).
 *
 * `packModules` (worker 2) is the one exception to "function-carrying
 * things need RPC": `@markii/lua`'s `PackModuleResolver` is a SYNCHRONOUS
 * `(packName, modulePath) => string | undefined` function
 * (`@markii/lua`'s `require.ts`), so rather than bridge it over RPC, the
 * main thread instead sends the plain, structured-cloneable DATA a
 * resolver would consult (namespace -> module path -> source text,
 * `host/packs.ts`'s `packModulesSnapshot`) in the `run` message itself, and
 * the worker builds a synchronous resolver locally from that map — no
 * round trip needed at all, and no risk of a synchronous Lua->JS->
 * (async RPC)->JS->Lua call ever needing to "yield across a C-call
 * boundary" the way an actually-async capability would.
 */
import type { ExecuteResult, ExecutionTier } from "@markii/runtime";
import type { CacheEntry, MarshalLimits, NetGrants, ScriptLimits } from "@markii/lua";
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
  /** Whether `CapabilityConfig.bundle` was constructed for this run (worker 2) — the real `ScriptView` stays on the main thread; see module doc's `bundle-call` section. */
  hasBundle: boolean;
  /** Whether `CapabilityConfig.cache` was constructed for this run (worker 2) — see module doc's `cache-call` section. */
  hasCache: boolean;
  /** Namespace -> module path -> source text for every enabled pack (worker 2, `host/packs.ts`'s `packModulesSnapshot`) — plain data, see module doc. */
  packModules: Record<string, Record<string, string>>;
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

export type BundleCallOp = "read" | "write" | "exists";

export interface BundleCallMessage {
  type: "bundle-call";
  callId: number;
  op: BundleCallOp;
  path: string;
  /** Present only for `op: "write"`. */
  data?: Uint8Array;
}

export type BundleCallResultMessage =
  | { type: "bundle-call-result"; callId: number; ok: true; op: "read"; data: Uint8Array | undefined }
  | { type: "bundle-call-result"; callId: number; ok: true; op: "write" }
  | { type: "bundle-call-result"; callId: number; ok: true; op: "exists"; exists: boolean }
  | { type: "bundle-call-result"; callId: number; ok: false; op: BundleCallOp; error: string };

export type CacheCallOp = "get" | "set";

export interface CacheCallMessage {
  type: "cache-call";
  callId: number;
  op: CacheCallOp;
  key: string;
  /** Present only for `op: "set"`. */
  entry?: CacheEntry;
}

export type CacheCallResultMessage =
  | { type: "cache-call-result"; callId: number; ok: true; op: "get"; entry: CacheEntry | undefined }
  | { type: "cache-call-result"; callId: number; ok: true; op: "set" }
  | { type: "cache-call-result"; callId: number; ok: false; op: CacheCallOp; error: string };

export type MainToWorkerMessage =
  | RunRequestMessage
  | NetCallResultMessage
  | BundleCallResultMessage
  | CacheCallResultMessage;
export type WorkerToMainMessage = RunResultMessage | NetCallMessage | BundleCallMessage | CacheCallMessage;

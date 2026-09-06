/**
 * Phase M3 — the actual Web Worker module that runs `@markii/lua` scripts.
 * This is the FIRST Web Worker in this repository (see
 * `docs/ARCHITECTURE.md`'s Phase M3 section for the pattern this
 * establishes); `scriptIsolate.ts` is the main-thread side that spawns and
 * talks to it, and `watchdog.ts` (platform-agnostic) is what kills it on a
 * wall-clock overrun.
 *
 * Scripts NEVER run on the main thread: this file, executed inside a
 * `new Worker(..., { type: "module" })`, is the only place `createLuaExecutor`
 * is ever called anywhere in this codebase's browser platform.
 *
 * ## The wasm asset (CLAUDE.md rule 3: offline-capable)
 *
 * `@markii/lua`'s `createLuaExecutor` -> `runScript` -> `createEmptyLuaEngine`
 * forwards a `wasmUri` straight to wasmoon's `LuaFactory`. Left `undefined`
 * in a browser bundle (confirmed by reading `node_modules/wasmoon/dist/
 * index.js`'s `LuaFactory` constructor directly), wasmoon fetches
 * `https://unpkg.com/wasmoon@<version>/dist/glue.wasm` over the network at
 * runtime — an unpkg dependency that would break "usable with backend down"
 * for something that isn't even backend-related, and would break a genuinely
 * offline PWA-cached session outright (no network reaches unpkg at all).
 * `wasmoon/dist/glue.wasm?url` below is a Vite `?url` asset import (the same
 * convention `materialIconLoader.ts` uses for SVGs) — Vite copies the real
 * `.wasm` file into the build output under a content-hashed name and this
 * import resolves to that same-origin URL string. Passed as `wasmUri`, this
 * is confirmed against `wasmoon`'s own `LuaFactory` source: a defined
 * `customWasmUri` is used verbatim and the browser-default unpkg branch is
 * never reached. `vite.config.ts`'s PWA plugin globs `**\/*.{js,css,html,
 * svg,png,ico,woff2}` for precaching — `.wasm` is added there in this same
 * change specifically so this asset (and the worker's own chunk) are
 * precached for offline use, not just bundled for online use.
 *
 * ## Protocol
 *
 * See `workerProtocol.ts`'s doc comment for the full run/run-result and
 * net-call/net-call-result message shapes this file implements one side of.
 */
import wasmGlueUrl from "wasmoon/dist/glue.wasm?url";
import { createLuaExecutor } from "@markii/lua";
import type { NetProvider } from "@markii/lua";
import type { ExecuteResult } from "@markii/runtime";
import { reconstructDocView } from "../../host/docViewSnapshot";
import type {
  MainToWorkerMessage,
  NetCallMessage,
  RunRequestMessage,
  RunResultMessage,
  WorkerToMainMessage,
} from "./workerProtocol";

/** Minimal shape this file needs from the global worker scope, deliberately
 * NOT the full `webworker` lib `DedicatedWorkerGlobalScope` — pulling in
 * that lib alongside the app-wide `DOM` lib (`tsconfig.app.json` covers this
 * whole `src/` tree with one lib set) would conflict on shared global names
 * (`self`, `postMessage`). Casting through this narrow interface keeps this
 * file type-safe without changing the project's lib configuration. */
interface WorkerGlobal {
  postMessage(message: WorkerToMainMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<MainToWorkerMessage>) => void): void;
}
const workerSelf = self as unknown as WorkerGlobal;

let netCallCounter = 0;
const pendingNetCalls = new Map<number, { resolve: (r: { status: number; body: string }) => void; reject: (e: Error) => void }>();

function makeNetProvider(): NetProvider {
  function call(method: "get" | "post" | "patch", url: string, body?: string): Promise<{ status: number; body: string }> {
    const callId = ++netCallCounter;
    return new Promise((resolve, reject) => {
      pendingNetCalls.set(callId, { resolve, reject });
      const message: NetCallMessage = { type: "net-call", callId, method, url, body };
      workerSelf.postMessage(message);
    });
  }
  return {
    get: (url) => call("get", url),
    post: (url, body) => call("post", url, body ?? ""),
    patch: (url, body) => call("patch", url, body ?? ""),
  };
}

async function handleRun(msg: RunRequestMessage): Promise<void> {
  const net = msg.hasNet ? makeNetProvider() : undefined;
  const executor = createLuaExecutor({
    net,
    netGrants: msg.hasNet ? msg.netGrants : undefined,
    maxFetchBytes: msg.maxFetchBytes,
    limits: msg.limits,
    marshalLimits: msg.marshalLimits,
    // Bundle/pack `require` wiring is worker 2's to add on top of this same
    // message once bundles exist (see `types.ts`'s `FileBackend` doc).
    wasmUri: wasmGlueUrl,
  });
  // `msg.doc` is a cloneable `DocViewSnapshot`, never a real `DocView` (see
  // `workerProtocol.ts`'s doc comment) - reconstruct the real, function-
  // carrying `DocView` `@markii/lua` expects HERE, inside the isolate,
  // right before it is used, so it never has to cross a message boundary.
  const doc = msg.doc ? reconstructDocView(msg.doc) : undefined;
  let result: ExecuteResult;
  try {
    result = await executor({ code: msg.code, tier: msg.tier, doc });
  } catch (err) {
    // `createLuaExecutor`'s adapter is documented as never throwing (it
    // wraps `runScript`, which never throws) — this catch exists purely as
    // defense in depth so a future upstream regression still reports a
    // clean failure instead of an unhandled worker rejection with no
    // `run-result` reply, which would otherwise hang the main thread's
    // watchdog until its own timeout.
    result = { ok: false, error: { kind: "script-error", message: err instanceof Error ? err.message : String(err) } };
  }
  const response: RunResultMessage = { type: "run-result", id: msg.id, result };
  workerSelf.postMessage(response);
}

workerSelf.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "net-call-result") {
    const pending = pendingNetCalls.get(msg.callId);
    if (!pending) return;
    pendingNetCalls.delete(msg.callId);
    if (msg.ok) pending.resolve({ status: msg.status, body: msg.body });
    else pending.reject(new Error(msg.error));
    return;
  }
  if (msg.type === "run") {
    void handleRun(msg);
  }
});

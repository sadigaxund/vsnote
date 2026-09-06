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
import type { CacheEntry, CacheProvider, NetProvider, PackModuleResolver } from "@markii/lua";
import type { ScriptView } from "@markii/bundle";
import type { ExecuteResult } from "@markii/runtime";
import { normalizeBundlePath } from "@markii/bundle";
import { reconstructDocView } from "../../host/docViewSnapshot";
import type {
  BundleCallResultMessage,
  CacheCallResultMessage,
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

/**
 * Worker 2: the RPC-client half of `ScriptView`/`CacheProvider` — see
 * `workerProtocol.ts`'s module doc's `bundle-call`/`cache-call` sections.
 * Both real capabilities (a real `ScriptView`/`CacheProvider`, built from
 * this note's actually-opened bundle) live on the MAIN thread
 * (`scriptIsolate.ts`'s `WorkerRunner.config`); this worker only ever holds
 * a client that posts one message per call and awaits the matching reply,
 * mirroring `makeNetProvider` above exactly.
 */
let bundleCallCounter = 0;
const pendingBundleCalls = new Map<number, { resolve: (r: BundleCallResultMessage) => void }>();

function makeBundleClient(): ScriptView {
  function call(op: "read" | "write" | "exists", path: string, data?: Uint8Array): Promise<BundleCallResultMessage> {
    const callId = ++bundleCallCounter;
    return new Promise((resolve) => {
      pendingBundleCalls.set(callId, { resolve });
      workerSelf.postMessage({ type: "bundle-call", callId, op, path, data });
    });
  }
  return {
    async read(path) {
      const result = await call("read", path);
      if (!result.ok) throw new Error(result.error);
      return result.op === "read" ? result.data : undefined;
    },
    async write(path, data) {
      const result = await call("write", path, data);
      if (!result.ok) throw new Error(result.error);
    },
    async exists(path) {
      const result = await call("exists", path);
      if (!result.ok) throw new Error(result.error);
      return result.op === "exists" ? result.exists : false;
    },
  };
}

let cacheCallCounter = 0;
const pendingCacheCalls = new Map<number, { resolve: (r: CacheCallResultMessage) => void }>();

function makeCacheClient(): CacheProvider {
  function call(op: "get" | "set", key: string, entry?: CacheEntry): Promise<CacheCallResultMessage> {
    const callId = ++cacheCallCounter;
    return new Promise((resolve) => {
      pendingCacheCalls.set(callId, { resolve });
      workerSelf.postMessage({ type: "cache-call", callId, op, key, entry });
    });
  }
  return {
    async get(key) {
      const result = await call("get", key);
      if (!result.ok) return undefined;
      return result.op === "get" ? result.entry : undefined;
    },
    async set(key, entry) {
      const result = await call("set", key, entry);
      if (!result.ok) throw new Error(result.error);
    },
  };
}

/**
 * Builds a synchronous `PackModuleResolver` (`@markii/lua`'s `require
 * "packName/modulePath"` seam) directly from the plain data map the `run`
 * message carries — see `workerProtocol.ts`'s module doc for why no RPC is
 * needed here (the resolver itself is synchronous). Tries `modulePath` and
 * `${modulePath}.lua`, mirroring `host/packs.ts`'s
 * `createPackModuleResolverFor` (which this worker cannot call directly:
 * that function closes over `EnabledPack`'s full shape, including
 * `scriptModules`, which is exactly what `packModules` already flattens to
 * plain data for the message boundary).
 */
function makePackModuleResolver(packModules: Record<string, Record<string, string>>): PackModuleResolver | undefined {
  if (Object.keys(packModules).length === 0) return undefined;
  return (packName, modulePath) => {
    const modules = packModules[packName];
    if (!modules) return undefined;
    // Defense in depth (mirrors `host/packs.ts`'s `createPackModuleResolverFor`):
    // `modulePath` is untrusted script input, not an archive-derived key, so
    // it is jailed the same way any other bundle-shaped path is before ever
    // being used as a lookup key.
    const normalized = normalizeBundlePath(modulePath);
    if (!normalized.ok) return undefined;
    if (Object.hasOwn(modules, normalized.path)) return modules[normalized.path];
    const withExt = `${normalized.path}.lua`;
    if (Object.hasOwn(modules, withExt)) return modules[withExt];
    return undefined;
  };
}

async function handleRun(msg: RunRequestMessage): Promise<void> {
  const net = msg.hasNet ? makeNetProvider() : undefined;
  const bundle = msg.hasBundle ? makeBundleClient() : undefined;
  const cache = msg.hasCache ? makeCacheClient() : undefined;
  const packModuleResolver = makePackModuleResolver(msg.packModules);
  const executor = createLuaExecutor({
    net,
    netGrants: msg.hasNet ? msg.netGrants : undefined,
    bundle,
    cache,
    packModuleResolver,
    maxFetchBytes: msg.maxFetchBytes,
    limits: msg.limits,
    marshalLimits: msg.marshalLimits,
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
  if (msg.type === "bundle-call-result") {
    const pending = pendingBundleCalls.get(msg.callId);
    if (!pending) return;
    pendingBundleCalls.delete(msg.callId);
    pending.resolve(msg);
    return;
  }
  if (msg.type === "cache-call-result") {
    const pending = pendingCacheCalls.get(msg.callId);
    if (!pending) return;
    pendingCacheCalls.delete(msg.callId);
    pending.resolve(msg);
    return;
  }
  if (msg.type === "run") {
    void handleRun(msg);
  }
});

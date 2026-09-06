/**
 * Phase M3 (docs/PLAN-2026-09-05-refresh.md §6, elaborated in
 * docs/temp-plan-add-extension.md) — platform-agnostic Port interfaces for
 * the markii scripting/bundle host layer.
 *
 * This module (and everything else under `src/markii/host/`) may import
 * `@markii/*` packages and plain TypeScript. It must NEVER import a browser
 * global (`window`, `fetch`, `Worker`, `indexedDB`, ...), an app-shell store,
 * or anything under `src/fs/*` — every such dependency is expressed as a
 * Port here and satisfied by a concrete adapter under
 * `src/markii/platform/browser/` (and, later, any other platform folder).
 * This is what lets a future Electron or VS Code host reuse every module in
 * `host/` unchanged.
 *
 * Four ports are defined, because those are the only four kinds of "reach
 * outside this note's own text" a markii host actually needs for M3:
 *
 * 1. `ScriptIsolate` — run one script to completion or kill it. The §10 kill
 *    switch. See `src/markii/host/watchdog.ts` for the platform-agnostic
 *    watchdog wrapper, and `src/markii/platform/browser/scriptIsolate.ts`
 *    for the Worker-backed concrete isolate.
 * 2. `GrantStore` — persisted, content-keyed capability grants (§8/§10
 *    security model). See `src/markii/host/runScripts.ts` for how a grant
 *    key is computed and consulted, and
 *    `src/markii/platform/browser/grantStore.ts` for the lightning-fs-backed
 *    implementation.
 * 3. `NetProvider` — the host's actual network primitive, injected into a
 *    script's `net` capability. Re-exported from `@markii/lua` rather than
 *    redefined: it is EXACTLY the shape `runScript`'s `net` option expects,
 *    and there is no reason for a second, structurally-identical interface
 *    to exist and drift from it.
 * 4. `FileBackend` — a bundle-rooted read/write/list/exists surface. Worker
 *    2 (`.mkz` bundles via `@markii/bundle`) owns the concrete
 *    implementation; this file only defines the shape so worker 2's
 *    `PackSettings`/bundle-loading code and worker 3's UI can be typed
 *    against it now. Every path a `FileBackend` implementation accepts MUST
 *    be run through `@markii/bundle`'s `normalizeBundlePath`/path-jail
 *    machinery before touching real storage — this interface does not, and
 *    cannot, enforce that itself; it is the implementation's job.
 */
import type { ExecuteResult, ExecutionTier } from "@markii/runtime";
import type { ScriptBlock } from "@markii/core";
import type { NetProvider } from "@markii/lua";
import type { DocViewSnapshot } from "./docViewSnapshot";

export type { NetProvider };
export type { DocViewSnapshot };

/**
 * Runs one script and reports its outcome. Implementations MUST NEVER
 * execute the script on the calling (main) thread — see
 * `src/markii/platform/browser/scriptIsolate.ts`'s module doc for the
 * concrete Worker + watchdog design that satisfies this. `run` must never
 * throw: any failure (a script error, a capability denial, a resource-limit
 * or watchdog kill) comes back as an `ExecuteResult` with `ok: false`.
 *
 * `doc` is a `DocViewSnapshot` (`docViewSnapshot.ts`), NOT `@markii/runtime`'s
 * own `DocView` — `DocView.value` is a function, which makes it
 * non-structured-cloneable, so `runScripts.ts` converts the real `DocView`
 * `runDocumentScripts` hands it into this cloneable snapshot shape BEFORE
 * ever calling `run`. This is deliberate at the PORT level, not merely a
 * browser-adapter concern: every current and future `ScriptIsolate`
 * implementation is guaranteed a payload safe to move across a process/
 * worker/thread boundary, by construction. A concrete isolate that
 * actually needs a real `DocView` (e.g. to hand to `@markii/lua`) calls
 * `reconstructDocView` on its own receiving side, never before.
 */
export interface ScriptIsolate {
  run(input: { code: string; tier: ExecutionTier; doc?: DocViewSnapshot }): Promise<ExecuteResult>;
  /** Releases any live worker/isolate resource. Safe to call multiple times. */
  dispose(): void;
}

/**
 * Net/bundle-write permissions a grant unlocks for the MANUAL tier only.
 * `auto`/`scheduled` runs never consult this shape at all (see
 * `runScripts.ts` and `capabilities.ts`'s doc comments for why that is
 * enforced in code, not merely by convention) — a `GrantedPermissions`
 * value only ever matters for a `'manual'` trigger's capability config.
 *
 * Deliberately small and additive: worker 2's bundle/pack work is expected
 * to grow this shape (e.g. a `bundleWrite` flag per bundle root, pack
 * capabilities) without touching the `GrantStore` contract itself.
 */
export interface GrantedPermissions {
  net: {
    /** Hostnames this grant allows a `net.get`/`net.fetch_json` against. */
    get: readonly string[];
    /**
     * Hostnames this grant allows a `net.post` against. `@markii/lua` gates
     * `net.patch` off this SAME allowlist (there is no separate patch host
     * list at the library level — see its `capabilities.ts`: `net.patch` is
     * enabled whenever a host is in `post` AND the `NetProvider` exposes a
     * `patch` method), so this one array covers both.
     */
    post: readonly string[];
  };
  /**
   * Whether this grant allows this note's scripts to write into their
   * bundle (`bundle.write`, spec §11). Worker 1 only threads this flag
   * through the capability config; the bundle-backed `ScriptView` that
   * actually enforces (or ignores) it is worker 2's to wire up.
   */
  bundleWrite: boolean;
}

/** A grant with no capabilities unlocked at all — the safe default for "no grant exists yet" and for every non-manual trigger. */
export const NO_PERMISSIONS: GrantedPermissions = {
  net: { get: [], post: [] },
  bundleWrite: false,
};

/** One persisted grant, as `GrantStore.get`/`list`/`listByPath` return it. */
export interface GrantRecord {
  /** `computeGrantKey` (`@markii/runtime`) hash of the note's executable closure at grant time. Re-editing any script invalidates this key, which is the entire point (docs/security.md). */
  key: string;
  /** Display path of the note this grant was made for. A grant is keyed by content, not path, but the path is what a settings UI groups/labels grants by (worker 3). */
  path: string;
  permissions: GrantedPermissions;
  /** `Date.now()` at grant time. */
  grantedAt: number;
}

/**
 * Persisted, content-keyed capability grants (docs/security.md's grant
 * model). Implementations persist via the `src/fs/drafts.ts` convention — a
 * second logical folder on the same lightning-fs instance — never a new
 * IndexedDB dependency; see
 * `src/markii/platform/browser/grantStore.ts`.
 *
 * Worker 3's Packs/Grants settings panel calls `list()` (or `listByPath()`
 * for a per-note view) to render rows, and `revoke(key)` on a row's revoke
 * action. Nothing else in this interface is worker-3-specific: `get`/`set`
 * are the run-path's own read/write.
 */
export interface GrantStore {
  get(key: string): Promise<GrantRecord | undefined>;
  set(record: GrantRecord): Promise<void>;
  revoke(key: string): Promise<void>;
  /** Every grant recorded for one note path, newest first. */
  listByPath(path: string): Promise<GrantRecord[]>;
  /** Every grant this store holds, across every note, newest first. */
  list(): Promise<GrantRecord[]>;
}

/** What a `GrantPrompt` callback is handed: enough for a UI to show the user what is asking for capabilities and why. */
export interface GrantPromptRequest {
  /** Display path of the note requesting capabilities. */
  path: string;
  /** The `computeGrantKey` hash this decision will be stored under. */
  grantKey: string;
  /** The note's own script blocks, for a dialog that wants to list them (name/lang) — never executed by the prompt itself. */
  scripts: readonly ScriptBlock[];
}

export type GrantDecision = { granted: true; permissions: GrantedPermissions } | { granted: false };

/**
 * The permission-prompt seam (docs/security.md): "the prompt itself is a
 * callback the host calls". `runScripts.ts` calls this exactly once per
 * manual run that has no existing valid grant, awaits the decision, and (on
 * `granted: true`) persists it via `GrantStore.set` before running anything.
 * Worker 3 wires a my-you-eye Dialog to this exact function shape.
 *
 * `DEFAULT_DENY_PROMPT` below is the seam's default: it denies every
 * request without ever showing anything, so no script can acquire a
 * capability before worker 3's real dialog exists.
 */
export type GrantPrompt = (request: GrantPromptRequest) => Promise<GrantDecision>;

/** Denies every request immediately. The safe default until a real UI prompt is wired in (worker 3). */
export const DEFAULT_DENY_PROMPT: GrantPrompt = async () => ({ granted: false });

/**
 * A bundle-rooted file surface (spec §11's `.mkz` bundles, `@markii/bundle`).
 * Worker 1 defines this shape only; the concrete bundle-backed
 * implementation (zip-backed via `@markii/bundle`'s `openZipBundle`/
 * `createMemoryBundleStorage`, path-jailed via `normalizeBundlePath`) is
 * worker 2's to build under `src/markii/platform/browser/`. Nothing in
 * worker 1's code constructs or consumes a `FileBackend` yet — it exists so
 * worker 2 and worker 3 can type bundle-facing code against a stable
 * interface from the start of M3, not bolt one on after the fact.
 */
export interface FileBackend {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  list(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

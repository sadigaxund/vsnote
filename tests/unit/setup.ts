/**
 * Vitest setup — runs before every unit test file. The unit suite exercises
 * real store/module code (zustand `persist`, `fs/drafts.ts` over the real
 * lightning-fs client) rather than reimplementing their logic as fixtures,
 * so it needs the two browser APIs those modules assume exist:
 *
 *  - `window.localStorage` — zustand's `persist` middleware defaults to
 *    `createJSONStorage(() => window.localStorage)` (see
 *    `node_modules/zustand/esm/middleware.mjs`). A tiny synchronous
 *    in-memory Map-backed shim is enough; pulling in `jsdom` for this one
 *    API alone would be a lot of dead weight for a Node-environment suite
 *    that never renders anything.
 *  - `indexedDB` — `@isomorphic-git/lightning-fs` (this app's real fs
 *    backend, used by `fs/client.ts`/`fs/operations.ts`/`fs/drafts.ts`)
 *    reads/writes IndexedDB directly. `fake-indexeddb/auto` installs a
 *    spec-compliant in-memory IndexedDB implementation as the global
 *    `indexedDB`/`IDBKeyRange`/etc. — the standard way to exercise
 *    IndexedDB-backed code under Node.
 *
 * `globalThis.window` is deliberately a bare `{ localStorage }` object, not
 * `globalThis` itself — so a store that started reaching for some other
 * browser-only global would fail loudly here instead of silently working
 * because the test environment happens to expose more than a real Node
 * process would.
 */
import "fake-indexeddb/auto";

/**
 * `navigator` — required by the same lightning-fs backend as `indexedDB`:
 * `DefaultBackend`'s constructor branches on `navigator.locks` to choose
 * between the Web Locks mutex and its IndexedDB-backed fallback
 * (`node_modules/@isomorphic-git/lightning-fs/src/DefaultBackend.js`), so a
 * missing global is a hard `ReferenceError`, not a soft feature-detect.
 *
 * This shim exists because that global's availability depends on the Node
 * VERSION, which is exactly the kind of accidental dependency this file's
 * docstring above says it refuses to rely on. Node 21+ exposes a global
 * `navigator`; Node 20 does not. The suite therefore passed on a developer
 * machine (Node 22) and failed on CI (Node 20) with six `drafts.test.ts`
 * failures, caught by the first real GitHub Actions run in Phase 13.
 *
 * Deliberately WITHOUT a `locks` property: real browsers have it, Node's
 * built-in `navigator` does not, and omitting it pins every environment to
 * the same IndexedDB-mutex code path that `fake-indexeddb` above already
 * supports. Adding `locks` here would silently switch the code under test
 * onto a different branch than the one CI and local dev exercise today.
 */
if (!("navigator" in globalThis)) {
  (globalThis as unknown as { navigator: Record<string, never> }).navigator = {};
}

class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const localStorageShim = new MemoryStorage();
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
  localStorage: localStorageShim,
};
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = localStorageShim;

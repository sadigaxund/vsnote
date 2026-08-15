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

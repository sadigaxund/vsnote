/**
 * Phase M3 — per-note value persistence, the host-level (platform-agnostic)
 * half. Owns the shape of what gets hydrated INTO a `@markii/runtime`
 * `ValueStore` and what gets written back OUT of one; the actual bytes-on-
 * disk concern (lightning-fs, path encoding) lives in
 * `src/markii/platform/browser/valuePersistence.ts`, mirroring
 * `src/fs/drafts.ts`'s split between "what" and "where".
 *
 * `@markii/runtime`'s `createValueStore` is explicitly in-memory only (see
 * its module doc) — persisting it across reloads/sessions is entirely this
 * host's job, which is exactly what these two functions do:
 *
 * - `hydrateValueStore` loads a previous run's snapshot back into a fresh
 *   `ValueStore`. Every entry that was `'fresh'` when persisted is
 *   downgraded to `'stale'` on hydrate: "rendering is pure; running is an
 *   event" means simply OPENING a note (or any non-manual render) must
 *   never claim a value is fresh when nothing has run yet THIS session — a
 *   stale marker is the honest state until `runScripts` actually runs
 *   again. `'error'` entries stay `'error'` (they were never fresh to begin
 *   with) and carry their `failureKind` forward unchanged.
 * - `snapshotForPersist` is the inverse: exactly `store.snapshot()`, kept as
 *   a named function (rather than callers reading `.snapshot()` directly)
 *   so the "this is the thing that gets written to disk" intent is visible
 *   at the call site in `runScripts.ts`.
 *
 * "A note with stale or missing values must still render fine": this
 * module never throws on absent/malformed persisted data — `hydrateValueStore`
 * accepts `undefined` (never persisted before) and simply returns an empty
 * store, which `@markii/react`'s renderer already degrades a `'missing'`
 * value to gracefully.
 */
import { createValueStore, type StoredValue, type ValueStore } from "@markii/runtime";

/** Downgrades every persisted `'fresh'` entry to `'stale'`; leaves `'error'`/`'stale'`/`'missing'` entries as they were. Exported for direct unit testing of the degrade rule in isolation from the store. */
export function staleifyPersistedValues(
  persisted: Record<string, StoredValue> | undefined,
): Record<string, StoredValue> {
  if (!persisted) return {};
  const result: Record<string, StoredValue> = {};
  for (const [name, entry] of Object.entries(persisted)) {
    result[name] = entry.status === "fresh" ? { ...entry, status: "stale" } : entry;
  }
  return result;
}

/** Builds a fresh `ValueStore` hydrated from a previous session's persisted snapshot (or an empty one, if none exists yet). */
export function hydrateValueStore(persisted: Record<string, StoredValue> | undefined): ValueStore {
  return createValueStore(staleifyPersistedValues(persisted));
}

/** The exact shape `runScripts.ts` persists after a run: a plain snapshot of the store's current entries. */
export function snapshotForPersist(store: ValueStore): Record<string, StoredValue> {
  return store.snapshot();
}

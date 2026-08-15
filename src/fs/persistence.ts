/**
 * Durability safeguard (IMPLEMENTATION-PLAN.md Phase 5 / DESIGN-SPEC
 * amendment 6's spirit — persistence is a hard requirement): asks the
 * browser for the Storage Standard's "persistent" bucket via
 * `navigator.storage.persist()` so the IndexedDB-backed vault
 * (`fs/client.ts`'s lightning-fs instance) isn't silently evicted under
 * disk pressure the way "best-effort" storage can be. This is advisory only
 * — the browser may grant, deny, or (Safari, some embedded webviews) not
 * implement the API at all — so the caller (`App.tsx`'s boot effect) never
 * blocks on the result; it only decides whether to show the muted
 * status-bar warning.
 */
export type StoragePersistenceStatus = "granted" | "denied" | "unsupported";

export async function requestPersistentStorage(): Promise<StoragePersistenceStatus> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return "unsupported";
  }
  try {
    // Already granted from a previous visit? Some browsers (Chrome) grant
    // automatically based on site-engagement heuristics without ever
    // showing a prompt; `persisted()` reports that without re-asking.
    const already = await navigator.storage.persisted?.();
    if (already) return "granted";
    const granted = await navigator.storage.persist();
    return granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Minimal LRU+TTL cache (COMPONENT-BACKLOG TODO §6.1.1, from vercel-labs
 * `server-cache-lru` translated to the client): Map-based, insertion-order
 * iteration gives O(1) LRU touch/evict; `at` timestamps give lazy TTL.
 *
 * Pure and dependency-free so it is unit-testable under the suite's
 * fs-isolation invariant (`fs/operations.ts` composes it but tests import
 * only this module). Deliberately tiny: correctness comes from callers
 * invalidating on mutation, TTL is only a backstop for bypass paths.
 */
export class LruTtlCache<V> {
  private readonly map = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch: delete+set moves the key to insertion order's tail.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) {
      // Evict least-recently-used = first key in insertion order.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, at: this.now() });
  }

  /** Drops every entry — the mutation-invalidation primitive. */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

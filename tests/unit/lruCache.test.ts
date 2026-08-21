/**
 * Unit coverage for `src/lib/lruCache.ts` — LRU eviction order, TTL expiry,
 * and clear() (fs-isolation safe: pure module, no store imports).
 */
import { describe, expect, it } from "vitest";
import { LruTtlCache } from "../../src/lib/lruCache";

function makeCache(maxEntries: number, ttlMs: number, clock: { t: number }) {
  return new LruTtlCache<string>(maxEntries, ttlMs, () => clock.t);
}

describe("LruTtlCache", () => {
  it("stores and returns values", () => {
    const c = makeCache(2, 1000, { t: 0 });
    c.set("a", "1");
    expect(c.get("a")).toBe("1");
  });

  it("evicts the least-recently-used entry beyond capacity", () => {
    const c = makeCache(2, 1000, { t: 0 });
    c.set("a", "1");
    c.set("b", "2");
    c.get("a"); // touch a → b is now LRU
    c.set("c", "3");
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe("3");
  });

  it("re-setting an existing key refreshes it without evicting", () => {
    const c = makeCache(2, 1000, { t: 0 });
    c.set("a", "1");
    c.set("b", "2");
    c.set("a", "1x"); // a exists — refresh in place
    c.set("c", "3"); // evicts b (LRU), not a
    expect(c.get("a")).toBe("1x");
    expect(c.get("b")).toBeUndefined();
  });

  it("expires entries past the TTL and stops serving them lazily", () => {
    const clock = { t: 0 };
    const c = makeCache(4, 5000, clock);
    c.set("a", "1");
    clock.t = 4000;
    expect(c.get("a")).toBe("1"); // inside TTL
    clock.t = 5001;
    expect(c.get("a")).toBeUndefined(); // expired
    expect(c.size).toBe(0); // lazy delete removed it
  });

  it("expired entries do not count toward capacity pressure", () => {
    const clock = { t: 0 };
    const c = makeCache(1, 1000, clock);
    c.set("a", "1");
    clock.t = 2000; // a expired but still occupies its slot until touched
    c.set("b", "2"); // set() sees size===1... must still fit b
    expect(c.get("b")).toBe("2");
    expect(c.get("a")).toBeUndefined();
  });

  it("clear() drops everything", () => {
    const c = makeCache(4, 100000, { t: 0 });
    c.set("a", "1");
    c.set("b", "2");
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });
});

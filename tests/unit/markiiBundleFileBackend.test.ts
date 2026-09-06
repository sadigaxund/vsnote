/**
 * `src/markii/host/bundle.ts`'s `createBundleFileBackend`/`createCacheProvider`
 * — the path-jail (via `@markii/bundle`'s `normalizeBundlePath`) every
 * method routes through, and the cache's hit/miss/corrupt-degrade
 * behavior. Exercised against `@markii/bundle`'s `createMemoryBundleStorage`
 * — no real filesystem, no lightning-fs (`fsIsolation.test.ts`'s ratchet is
 * irrelevant here: neither module this file imports reaches `src/fs/*`).
 */
import { describe, expect, it } from "vitest";
import { createMemoryBundleStorage } from "@markii/bundle";
import { createBundleFileBackend, createCacheProvider, BundleFileBackendPathError } from "../../src/markii/host/bundle";

const enc = new TextEncoder();

describe("createBundleFileBackend path jail", () => {
  it("reads and writes a plain path", async () => {
    const storage = createMemoryBundleStorage();
    const backend = createBundleFileBackend(storage);
    await backend.write("scripts/util.lua", enc.encode("return 1"));
    expect(await backend.exists("scripts/util.lua")).toBe(true);
    expect(new TextDecoder().decode(await backend.read("scripts/util.lua"))).toBe("return 1");
  });

  it("rejects a .. traversal segment on read/write/exists", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("../secret")).rejects.toThrow(BundleFileBackendPathError);
    await expect(backend.write("../secret", enc.encode("x"))).rejects.toThrow(BundleFileBackendPathError);
    await expect(backend.exists("../secret")).rejects.toThrow(BundleFileBackendPathError);
  });

  it("rejects an absolute path", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("/etc/passwd")).rejects.toThrow(BundleFileBackendPathError);
  });

  it("rejects a backslash path", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("scripts\\util.lua")).rejects.toThrow(BundleFileBackendPathError);
  });

  it("rejects a drive-letter path", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("C:/evil")).rejects.toThrow(BundleFileBackendPathError);
  });

  it("rejects a null byte", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("scripts/util\0.lua")).rejects.toThrow(BundleFileBackendPathError);
  });

  it("list(dir) filters to the directory's own prefix", async () => {
    const storage = createMemoryBundleStorage({
      "scripts/a.lua": "a",
      "scripts/b.lua": "b",
      "assets/img.png": "x",
    });
    const backend = createBundleFileBackend(storage);
    expect((await backend.list("scripts")).sort()).toEqual(["scripts/a.lua", "scripts/b.lua"]);
  });

  it("list('') lists the whole bundle", async () => {
    const storage = createMemoryBundleStorage({ "a.txt": "a", "b.txt": "b" });
    const backend = createBundleFileBackend(storage);
    expect((await backend.list("")).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("read of a missing path throws (not a silent undefined)", async () => {
    const backend = createBundleFileBackend(createMemoryBundleStorage());
    await expect(backend.read("nope.txt")).rejects.toThrow(/not found/);
  });
});

describe("createCacheProvider", () => {
  it("is a miss for an unknown key", async () => {
    const cache = createCacheProvider(createMemoryBundleStorage());
    expect(await cache.get("no-such-key")).toBeUndefined();
  });

  it("round-trips a set entry as a hit", async () => {
    const storage = createMemoryBundleStorage();
    const cache = createCacheProvider(storage);
    await cache.set("weather", { value: { tempC: 21 }, storedAtMs: 1000 });
    expect(await cache.get("weather")).toEqual({ value: { tempC: 21 }, storedAtMs: 1000 });
  });

  it("degrades a corrupt cache file to a miss, never an error", async () => {
    const storage = createMemoryBundleStorage();
    await storage.write(".cache/weather.json", enc.encode("{ not valid json"));
    const cache = createCacheProvider(storage);
    await expect(cache.get("weather")).resolves.toBeUndefined();
  });

  it("degrades a well-formed-but-wrong-shaped cache file to a miss", async () => {
    const storage = createMemoryBundleStorage();
    await storage.write(".cache/weather.json", enc.encode(JSON.stringify({ notValue: 1 })));
    const cache = createCacheProvider(storage);
    await expect(cache.get("weather")).resolves.toBeUndefined();
  });

  it("encodes an arbitrary key into a safe .cache/ path, never touching write:.cache/ policy", async () => {
    const storage = createMemoryBundleStorage();
    const cache = createCacheProvider(storage);
    await cache.set("a key/with?odd:chars", { value: 1, storedAtMs: 1 });
    expect(await cache.get("a key/with?odd:chars")).toEqual({ value: 1, storedAtMs: 1 });
  });
});

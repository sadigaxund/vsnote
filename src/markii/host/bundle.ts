/**
 * Phase M3 (worker 2) — the platform-agnostic half of `.mkz` bundle
 * support: builds a `FileBackend` (`host/types.ts`) and a `cache.get`
 * `CacheProvider` (`@markii/lua`'s `CapabilityConfig`) over a plain
 * `@markii/bundle` `BundleStorage`. Pure: `@markii/bundle`'s main entry has
 * no Node dependency, no browser dependency, and neither does this module
 * — the actual bytes (opening a `.mkz`'s zip bytes into a `BundleStorage`,
 * persisting an in-memory one back to the vault) is
 * `platform/browser/bundleVault.ts`'s job.
 *
 * ## The path jail is structural, not a convention
 *
 * `host/types.ts`'s `FileBackend` doc is explicit: "Every path a
 * `FileBackend` implementation accepts MUST be run through
 * `@markii/bundle`'s `normalizeBundlePath`/path-jail machinery before
 * touching real storage — this interface does not, and cannot, enforce
 * that itself; it is the implementation's job." `resolveOrThrow` below is
 * the ONE function in this module that ever turns a caller-supplied string
 * into a path handed to a `BundleStorage` method — every exported
 * function's every method funnels through it, so "every path is jailed" is
 * a structural property of this file (there is no second, unjailed way to
 * reach `storage.read`/`write`/`exists`/`list` from here), not merely
 * something every method happened to remember to do. `BundleStorage`
 * itself also re-normalizes internally (`@markii/bundle`'s own contract,
 * see `storage.d.ts`'s doc comment) — this is intentional belt-and-
 * suspenders, the same discipline `@markii/lua`'s own capability layer uses
 * throughout, not redundant defense.
 *
 * ## Cache is independent of `bundleWrite`
 *
 * `cache.get`/`cache.set` (spec's `cache.get(key, ttl, fn)`) is backed by
 * files under `.cache/` in the SAME bundle, but through a SEPARATE code
 * path from `createFileBackend`/`createScriptView`'s `write:.cache/` grant
 * gate: the cache is host-internal memoization (a script never chooses
 * WHAT key or WHERE it's stored beyond the key string, and never reads
 * another script's raw bytes back out except through the same `get`/`set`
 * pair), not a general bundle-write capability, so it does not need a
 * user-facing "bundle write" grant to be useful for the common case this
 * exists for: letting an `auto`/`scheduled` run memoize an expensive
 * `net.fetch_json` without needing a manual grant at all. `host/
 * capabilities.ts` wires `cache` independently of `permissions.bundleWrite`
 * for exactly this reason — see that module's doc comment.
 *
 * A missing or corrupt cache entry is always a plain miss, never an error:
 * `cacheGet` swallows a malformed JSON payload (a hand-edited or corrupted
 * `.cache/*.json` file) and returns `undefined`, exactly as if the key had
 * never been cached — "degrade to a normal recompute," never a thrown
 * error, matching every other persistence layer in this codebase
 * (`valuePersistence.ts`, `grantStore.ts`).
 */
import {
  normalizeBundlePath,
  type BundleStorage,
} from "@markii/bundle";
import type { CacheEntry, CacheProvider } from "@markii/lua";
import type { FileBackend } from "./types";

/** Thrown by every method below for a path that fails `normalizeBundlePath` — never lets an unjailed string reach `storage`. */
export class BundleFileBackendPathError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`bundle path rejected: ${JSON.stringify(path)} (${reason})`);
  }
}

/** The ONE place a caller-supplied path is turned into a `BundleStorage`-safe path. See module doc. */
function resolveOrThrow(path: string): string {
  const result = normalizeBundlePath(path);
  if (!result.ok) throw new BundleFileBackendPathError(path, result.reason);
  return result.path;
}

/**
 * Builds a `FileBackend` (`host/types.ts`) over a plain `BundleStorage`.
 * Every method resolves its path through `resolveOrThrow` before ever
 * calling `storage`. `list(dir)` is the one method `BundleStorage`/
 * `ScriptView` don't share a shape for: `BundleStorage.list()` returns
 * every path in the bundle, so this filters that to `dir`'s own prefix
 * (an empty/`"."` `dir` lists the whole bundle).
 */
export function createBundleFileBackend(storage: BundleStorage): FileBackend {
  return {
    async read(path) {
      const resolved = resolveOrThrow(path);
      const bytes = await storage.read(resolved);
      if (bytes === undefined) throw new Error(`bundle file not found: ${resolved}`);
      return bytes;
    },
    async write(path, bytes) {
      await storage.write(resolveOrThrow(path), bytes);
    },
    async list(dir) {
      const prefix = dir.trim().length === 0 || dir === "." ? "" : resolveOrThrow(dir);
      const all = await storage.list();
      if (prefix === "") return all;
      return all.filter((p) => p === prefix || p.startsWith(`${prefix}/`));
    },
    async exists(path) {
      return storage.exists(resolveOrThrow(path));
    },
  };
}

/** `.cache/<encoded key>.json`'s directory — every cache entry lives here, and nowhere else. */
const CACHE_DIR = ".cache";

/** Encodes an arbitrary `cache.get` key into a single safe path segment. `encodeURIComponent` never produces `/`, `..`, a backslash, or a null byte, so the result always normalizes cleanly. */
function cacheEntryPath(key: string): string {
  return `${CACHE_DIR}/${encodeURIComponent(key)}.json`;
}

/**
 * Builds a `CacheProvider` (`@markii/lua`) over a `BundleStorage`'s
 * `.cache/` directory. Writes go straight through `storage.write` — NOT
 * through a `ScriptView`'s `write:.cache/` grant check — because this is
 * the host's own internal memoization channel, not the script-facing
 * `bundle.write` capability (see module doc's "cache is independent of
 * bundleWrite" section). A read that finds no entry, or an entry whose
 * JSON is malformed, is a plain miss (`undefined`) — never a thrown error.
 */
export function createCacheProvider(storage: BundleStorage): CacheProvider {
  return {
    async get(key) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await storage.read(cacheEntryPath(key));
      } catch {
        return undefined;
      }
      if (bytes === undefined) return undefined;
      try {
        const text = new TextDecoder().decode(bytes);
        const parsed: unknown = JSON.parse(text);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "value" in parsed &&
          "storedAtMs" in parsed &&
          typeof (parsed as { storedAtMs: unknown }).storedAtMs === "number"
        ) {
          return parsed as CacheEntry;
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, entry) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry));
      await storage.write(cacheEntryPath(key), bytes);
    },
  };
}

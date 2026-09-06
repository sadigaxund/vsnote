/**
 * Two things under test:
 *
 * 1. `src/markii/host/valuePersistence.ts`'s hydrate/degrade rule in
 *    isolation (pure, no fs): a persisted `'fresh'` value must come back
 *    `'stale'` on hydrate ("rendering is pure; running is an event" - a
 *    reload/reopen must never claim a value is fresh before anything has
 *    run this session), while `'error'` entries are left alone.
 * 2. The round trip through `src/markii/platform/browser/valuePersistence.ts`'s
 *    `*Over` functions, against a FAKE in-memory `FileOps` — deliberately
 *    NOT the real lightning-fs client: `tests/unit/fsIsolation.test.ts`
 *    forbids any new test file from transitively importing
 *    `src/fs/client.ts` (a second lightning-fs consumer alongside
 *    `drafts.test.ts` was found to hang the suite on CI). See
 *    `fileOps.ts`'s doc comment for the full rationale; this is exactly the
 *    "test only the pure half" split that guard prescribes.
 */
import { describe, expect, it } from "vitest";
import type { StoredValue } from "@markii/runtime";
import { hydrateValueStore, staleifyPersistedValues } from "../../src/markii/host/valuePersistence";
import {
  clearPersistedValuesOver,
  loadPersistedValuesOver,
  savePersistedValuesOver,
} from "../../src/markii/platform/browser/valuePersistence";
import type { FileOps } from "../../src/markii/platform/browser/fileOps";
import { valueFsPath } from "../../src/markii/platform/browser/paths";

describe("markii value persistence: hydrate/degrade rule (pure)", () => {
  it("downgrades a persisted fresh value to stale", () => {
    const persisted: Record<string, StoredValue> = { stars: { value: 42, status: "fresh", ranAt: 1 } };
    const result = staleifyPersistedValues(persisted);
    expect(result.stars).toEqual({ value: 42, status: "stale", ranAt: 1 });
  });

  it("leaves an error entry as error, failureKind included", () => {
    const persisted: Record<string, StoredValue> = {
      broken: { value: undefined, status: "error", error: "boom", failureKind: "script-error" },
    };
    const result = staleifyPersistedValues(persisted);
    expect(result.broken).toEqual(persisted.broken);
  });

  it("undefined input degrades to an empty record, never throws", () => {
    expect(staleifyPersistedValues(undefined)).toEqual({});
  });

  it("hydrateValueStore builds a real ValueStore whose get/has reflect the staleified values", () => {
    const store = hydrateValueStore({ stars: { value: 7, status: "fresh" } });
    expect(store.has("stars")).toBe(true);
    expect(store.get("stars")?.status).toBe("stale");
    expect(store.has("missing")).toBe(false);
    expect(store.get("missing")).toBeUndefined();
  });

  it("hydrateValueStore with no persisted data is an empty, non-throwing store", () => {
    const store = hydrateValueStore(undefined);
    expect(store.snapshot()).toEqual({});
  });
});

/** A tiny in-memory `FileOps`, standing in for the real lightning-fs client — see this file's module doc for why. */
function fakeFileOps(): FileOps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async pathExists(path) {
      return files.has(path);
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async removeFile(path) {
      files.delete(path);
    },
  };
}

describe("markii value persistence: browser round trip (fake FileOps)", () => {
  const PATH = "notes/scratch.mk.md";

  it("a note that never ran scripts has no persisted values", async () => {
    const ops = fakeFileOps();
    expect(await loadPersistedValuesOver(ops, PATH)).toBeUndefined();
  });

  it("saves and loads a snapshot back byte-for-byte", async () => {
    const ops = fakeFileOps();
    const snapshot: Record<string, StoredValue> = {
      stars: { value: 123, status: "fresh", ranAt: 1000 },
      broken: { value: undefined, status: "error", error: "nope", failureKind: "limit" },
    };
    await savePersistedValuesOver(ops, PATH, snapshot);
    expect(await loadPersistedValuesOver(ops, PATH)).toEqual(snapshot);
  });

  it("a later save fully replaces the previous snapshot", async () => {
    const ops = fakeFileOps();
    await savePersistedValuesOver(ops, PATH, { a: { value: 1, status: "fresh" } });
    await savePersistedValuesOver(ops, PATH, { b: { value: 2, status: "fresh" } });
    const loaded = await loadPersistedValuesOver(ops, PATH);
    expect(loaded).toEqual({ b: { value: 2, status: "fresh" } });
  });

  it("clearPersistedValuesOver removes the file, and is a no-op when nothing exists", async () => {
    const ops = fakeFileOps();
    await savePersistedValuesOver(ops, PATH, { a: { value: 1, status: "fresh" } });
    await clearPersistedValuesOver(ops, PATH);
    expect(await loadPersistedValuesOver(ops, PATH)).toBeUndefined();
    await expect(clearPersistedValuesOver(ops, PATH)).resolves.toBeUndefined();
  });

  it("distinct note paths persist independently", async () => {
    const ops = fakeFileOps();
    await savePersistedValuesOver(ops, "notes/a.mk.md", { a: { value: 1, status: "fresh" } });
    await savePersistedValuesOver(ops, "notes/b.mk.md", { b: { value: 2, status: "fresh" } });
    expect(await loadPersistedValuesOver(ops, "notes/a.mk.md")).toEqual({ a: { value: 1, status: "fresh" } });
    expect(await loadPersistedValuesOver(ops, "notes/b.mk.md")).toEqual({ b: { value: 2, status: "fresh" } });
  });

  it("malformed JSON on disk degrades to undefined rather than throwing", async () => {
    const ops = fakeFileOps();
    ops.files.set(valueFsPath(PATH), "not json");
    expect(await loadPersistedValuesOver(ops, PATH)).toBeUndefined();
  });
});

/**
 * `src/markii/platform/browser/grantStore.ts`'s `createGrantStoreOver` —
 * get/set/revoke/listByPath/list — exercised against a FAKE in-memory
 * `FileOps`, not the real lightning-fs client: `tests/unit/fsIsolation.
 * test.ts` forbids a new test file from transitively reaching
 * `src/fs/client.ts` (a second lightning-fs consumer alongside
 * `drafts.test.ts` hangs the suite on CI). See `fileOps.ts`'s doc comment.
 */
import { describe, expect, it } from "vitest";
import { createGrantStoreOver } from "../../src/markii/platform/browser/grantStore";
import type { FileOps } from "../../src/markii/platform/browser/fileOps";
import type { GrantRecord } from "../../src/markii/host/types";

function fakeFileOps(): FileOps {
  const files = new Map<string, string>();
  return {
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

function record(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    key: "key-a",
    path: "notes/scratch.mk.md",
    permissions: { net: { get: ["api.example.com"], post: [] }, bundleWrite: false },
    grantedAt: 1000,
    ...overrides,
  };
}

describe("markii browser GrantStore", () => {
  it("get() on an unknown key is undefined", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    expect(await store.get("nope")).toBeUndefined();
  });

  it("set() then get() round-trips the exact record", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    await store.set(record());
    expect(await store.get("key-a")).toEqual(record());
  });

  it("revoke() removes a grant; revoking an unknown key is a no-op", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    await store.set(record());
    await store.revoke("key-a");
    expect(await store.get("key-a")).toBeUndefined();
    await expect(store.revoke("never-existed")).resolves.toBeUndefined();
  });

  it("listByPath() returns only grants for that path, newest first", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    await store.set(record({ key: "k1", path: "notes/a.mk.md", grantedAt: 1 }));
    await store.set(record({ key: "k2", path: "notes/a.mk.md", grantedAt: 5 }));
    await store.set(record({ key: "k3", path: "notes/b.mk.md", grantedAt: 3 }));

    const forA = await store.listByPath("notes/a.mk.md");
    expect(forA.map((g) => g.key)).toEqual(["k2", "k1"]);
  });

  it("list() returns every grant across every path, newest first", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    await store.set(record({ key: "k1", path: "notes/a.mk.md", grantedAt: 1 }));
    await store.set(record({ key: "k2", path: "notes/b.mk.md", grantedAt: 9 }));
    const all = await store.list();
    expect(all.map((g) => g.key)).toEqual(["k2", "k1"]);
  });

  it("an edited script's new grant key is a distinct record from the old one, both listable", async () => {
    const store = createGrantStoreOver(fakeFileOps());
    await store.set(record({ key: "before-edit", path: "notes/a.mk.md" }));
    await store.set(record({ key: "after-edit", path: "notes/a.mk.md" }));
    const forPath = await store.listByPath("notes/a.mk.md");
    expect(forPath.map((g) => g.key).sort()).toEqual(["after-edit", "before-edit"]);
  });
});

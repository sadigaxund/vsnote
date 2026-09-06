/**
 * `src/markii/platform/browser/packStore.ts`'s `createPackStoreOver` —
 * exercised against a FAKE in-memory `FileOps` (see `fileOps.ts`'s doc
 * comment / `markiiGrantStore.test.ts`'s identical convention), never the
 * real lightning-fs client.
 */
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { createPackStoreOver } from "../../src/markii/platform/browser/packStore";
import type { FileOps } from "../../src/markii/platform/browser/fileOps";

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

function mkp(name: string): Uint8Array {
  const enc = new TextEncoder();
  return zipSync({
    "pack.json": enc.encode(JSON.stringify({ name, engine: "react", components: {} })),
    "webview.js": enc.encode("//"),
  });
}

describe("createPackStoreOver", () => {
  it("enable persists a valid pack and list returns it", async () => {
    const store = createPackStoreOver(fakeFileOps());
    const result = await store.enable(mkp("ana"));
    expect(result.ok).toBe(true);
    const list = await store.list();
    expect(list.map((p) => p.namespace)).toEqual(["ana"]);
    expect(list[0]!.enabled).toBe(true);
  });

  it("enable refuses a second pack claiming a namespace that is already installed (no silent last-one-wins)", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));

    const enc = new TextEncoder();
    const differentPackSameNamespace = zipSync({
      "pack.json": enc.encode(JSON.stringify({ name: "ana", engine: "react", components: { x: "./X.tsx" } })),
      "webview.js": enc.encode("// a totally different pack that happens to share the name"),
    });
    const result = await store.enable(differentPackSameNamespace);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("collision");

    // The original pack is untouched — never silently overwritten.
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.manifest.components).toEqual({});
  });

  it("enable refuses even re-uploading the exact same namespace while it is already installed", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));
    const second = await store.enable(mkp("ana"));
    expect(second.ok).toBe(false);
  });

  it("removing a pack frees its namespace for a new enable", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));
    await store.remove("ana");
    const result = await store.enable(mkp("ana"));
    expect(result.ok).toBe(true);
  });

  it("disable keeps the record but flips enabled to false", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));
    await store.disable("ana");
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.enabled).toBe(false);
  });

  it("reenable flips a disabled record back to enabled with no re-upload", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));
    await store.disable("ana");
    await store.reenable("ana");
    const list = await store.list();
    expect(list[0]!.enabled).toBe(true);
  });

  it("disable/reenable/remove are no-ops for an unknown namespace", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await expect(store.disable("nope")).resolves.toBeUndefined();
    await expect(store.reenable("nope")).resolves.toBeUndefined();
    await expect(store.remove("nope")).resolves.toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("remove deletes the record outright", async () => {
    const store = createPackStoreOver(fakeFileOps());
    await store.enable(mkp("ana"));
    await store.remove("ana");
    expect(await store.list()).toEqual([]);
  });

  it("enable reports a load failure without persisting anything", async () => {
    const store = createPackStoreOver(fakeFileOps());
    const enc = new TextEncoder();
    const badBytes = zipSync({ "pack.json": enc.encode("not json") , "webview.js": enc.encode("//") });
    const result = await store.enable(badBytes);
    expect(result.ok).toBe(false);
    expect(await store.list()).toEqual([]);
  });
});

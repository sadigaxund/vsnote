/**
 * `src/markii/host/capabilities.ts`'s bundle/cache wiring (worker 2):
 * asserts on the CONSTRUCTED `CapabilityConfig` itself (calling
 * `config.bundle.write(...)` and observing whether it throws), not on a
 * mock's own bookkeeping — per the M3 worker-2 brief's explicit
 * instruction. Also covers `note.mk.md`/`manifest.json` staying refused
 * even when `bundleWrite` is granted (that policy is `@markii/bundle`'s
 * own `isWriteAllowed`, exercised here through this module's real wiring,
 * not re-implemented).
 */
import { describe, expect, it } from "vitest";
import { createDefaultManifest, createMemoryBundleStorage, type BundleManifest } from "@markii/bundle";
import { buildCapabilityConfig } from "../../src/markii/host/capabilities";
import { NO_PERMISSIONS, type GrantedPermissions } from "../../src/markii/host/types";

function manifestAllowingCacheWrite(): BundleManifest {
  return { ...createDefaultManifest(), permissions: { bundle: ["read", "write:.cache/"] } };
}

function permissionsWith(bundleWrite: boolean): GrantedPermissions {
  return { net: { get: [], post: [] }, bundleWrite };
}

describe("buildCapabilityConfig bundle/cache wiring", () => {
  it("manual + bundleWrite: true builds a bundle view whose write actually succeeds", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "manual",
      permissions: permissionsWith(true),
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    expect(config.bundle).toBeDefined();
    await expect(config.bundle!.write(".cache/x.json", new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it("manual + bundleWrite: false builds a bundle view whose write is refused", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "manual",
      permissions: permissionsWith(false),
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    expect(config.bundle).toBeDefined();
    await expect(config.bundle!.write(".cache/x.json", new Uint8Array([1]))).rejects.toThrow();
  });

  it("manual with no permissions object at all never grants write", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "manual",
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    await expect(config.bundle!.write(".cache/x.json", new Uint8Array([1]))).rejects.toThrow();
  });

  it("auto tier never builds a write-capable bundle view, even if permissions (illegitimately) claim bundleWrite: true", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "auto",
      permissions: permissionsWith(true),
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    expect(config.bundle).toBeDefined();
    await expect(config.bundle!.write(".cache/x.json", new Uint8Array([1]))).rejects.toThrow();
  });

  it("scheduled tier (maps to auto) also never builds a write-capable bundle view", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "scheduled",
      permissions: permissionsWith(true),
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    await expect(config.bundle!.write(".cache/x.json", new Uint8Array([1]))).rejects.toThrow();
  });

  it("read works under auto tier with no bundleWrite at all, as long as the bundle's own manifest declares it wants read (DEFECT-10 intersection: this module always OFFERS read, but the manifest must still ask for it)", async () => {
    const storage = createMemoryBundleStorage({ "note.mk.md": "hello" });
    const manifest: BundleManifest = { ...createDefaultManifest(), permissions: { bundle: ["read"] } };
    const autoConfig = buildCapabilityConfig({ trigger: "auto", bundle: { storage, manifest } });
    expect(new TextDecoder().decode(await autoConfig.bundle!.read("note.mk.md"))).toBe("hello");
  });

  it("a manifest that declares no bundle permissions at all gets no read either, even though this module always offers it", async () => {
    const storage = createMemoryBundleStorage({ "note.mk.md": "hello" });
    const autoConfig = buildCapabilityConfig({ trigger: "auto", bundle: { storage, manifest: createDefaultManifest() } });
    await expect(autoConfig.bundle!.read("note.mk.md")).rejects.toThrow();
  });

  it("note.mk.md and manifest.json writes are refused even under manual + bundleWrite: true", async () => {
    const storage = createMemoryBundleStorage();
    const config = buildCapabilityConfig({
      trigger: "manual",
      permissions: permissionsWith(true),
      bundle: { storage, manifest: manifestAllowingCacheWrite() },
    });
    await expect(config.bundle!.write("note.mk.md", new Uint8Array([1]))).rejects.toThrow();
    await expect(config.bundle!.write("manifest.json", new Uint8Array([1]))).rejects.toThrow();
  });

  it("no bundle input at all means no bundle/cache capability, for any tier", () => {
    const manualConfig = buildCapabilityConfig({ trigger: "manual", permissions: NO_PERMISSIONS });
    expect(manualConfig.bundle).toBeUndefined();
    expect(manualConfig.cache).toBeUndefined();
  });

  it("cache is wired independently of bundleWrite and tier, whenever a bundle exists", () => {
    const storage = createMemoryBundleStorage();
    const autoConfig = buildCapabilityConfig({ trigger: "auto", bundle: { storage, manifest: createDefaultManifest() } });
    const manualConfig = buildCapabilityConfig({
      trigger: "manual",
      permissions: permissionsWith(false),
      bundle: { storage, manifest: createDefaultManifest() },
    });
    expect(autoConfig.cache).toBeDefined();
    expect(manualConfig.cache).toBeDefined();
  });

  it("packModules only appears on the config when non-empty", () => {
    const empty = buildCapabilityConfig({ trigger: "manual", packModules: {} });
    expect(empty.packModules).toBeUndefined();
    const nonEmpty = buildCapabilityConfig({ trigger: "manual", packModules: { ana: { http: "return {}" } } });
    expect(nonEmpty.packModules).toEqual({ ana: { http: "return {}" } });
  });
});

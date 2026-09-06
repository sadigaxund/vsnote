/**
 * `src/markii/host/packs.ts` (worker 2): opening a real `.mkp` archive's
 * bytes (built with `fflate` directly, the same library `@markii/bundle`'s
 * zip form uses, listed as a direct dependency of this app), namespace
 * collision detection, `require`-resolver behavior (including refusing a
 * path outside the pack), and the grant-closure helpers that decide which
 * enabled packs a note's scripts actually reference.
 */
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  collisionsAmong,
  createPackModuleResolverFor,
  grantClosurePacksFor,
  loadPackFromArchiveBytes,
  packModulesSnapshot,
  referencedPackNamespaces,
  type EnabledPack,
} from "../../src/markii/host/packs";
import type { ScriptBlock } from "@markii/core";

function buildMkp(opts: {
  name: string;
  engine?: string;
  components?: Record<string, string>;
  scripts?: Record<string, string>;
  version?: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const manifest = {
    name: opts.name,
    engine: opts.engine ?? "react",
    components: opts.components ?? {},
    ...(opts.version ? { version: opts.version } : {}),
  };
  const files: Record<string, Uint8Array> = {
    "pack.json": enc.encode(JSON.stringify(manifest)),
    "webview.js": enc.encode("// prebuilt, never executed by VSNote"),
  };
  for (const [name, source] of Object.entries(opts.scripts ?? {})) {
    files[`scripts/${name}`] = enc.encode(source);
  }
  return zipSync(files);
}

function scriptBlock(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return { name: "s", lang: "lua", code: "", ...overrides };
}

describe("loadPackFromArchiveBytes", () => {
  it("opens a well-formed .mkp and decodes its Lua modules, never carrying webview.js bytes", async () => {
    const bytes = buildMkp({
      name: "ana",
      components: { timeline: "./Timeline.tsx" },
      scripts: { "http.lua": 'return { get = function() return "ok" end }' },
    });
    const result = await loadPackFromArchiveBytes(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.namespace).toBe("ana");
    expect(result.pack.enabled).toBe(true);
    expect(result.pack.scriptModules["http.lua"]).toContain("return { get");
    expect(Object.keys(result.pack)).not.toContain("scriptBytes");
    expect(Object.keys(result.pack)).not.toContain("stylesheetBytes");
  });

  it("reports a missing-entry failure for an archive with no webview.js", async () => {
    const enc = new TextEncoder();
    const bytes = zipSync({ "pack.json": enc.encode(JSON.stringify({ name: "x", engine: "react", components: {} })) });
    const result = await loadPackFromArchiveBytes(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing-entry");
  });

  it("reports a manifest failure for an invalid pack.json", async () => {
    const enc = new TextEncoder();
    const bytes = zipSync({
      "pack.json": enc.encode(JSON.stringify({ name: "Not Valid!", engine: "react", components: {} })),
      "webview.js": enc.encode("//"),
    });
    const result = await loadPackFromArchiveBytes(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("manifest");
  });
});

describe("collisionsAmong", () => {
  it("finds no collisions among distinct namespaces", () => {
    expect(collisionsAmong([{ namespace: "ana" }, { namespace: "bee" }])).toEqual([]);
  });

  it("finds a collision when two packs share a namespace", () => {
    const collisions = collisionsAmong([{ namespace: "ana" }, { namespace: "ana" }]);
    expect(collisions).toEqual([{ namespace: "ana", count: 2 }]);
  });
});

function enabledPack(overrides: Partial<EnabledPack> = {}): EnabledPack {
  return {
    namespace: "ana",
    manifest: { name: "ana", engine: "react", components: {} },
    scriptModules: { "http.lua": "return {}" },
    enabled: true,
    enabledAt: 1,
    ...overrides,
  };
}

describe("createPackModuleResolverFor", () => {
  it("resolves a module by exact key", () => {
    const resolver = createPackModuleResolverFor([enabledPack()]);
    expect(resolver("ana", "http.lua")).toBe("return {}");
  });

  it("resolves a module written without the .lua extension (require convention)", () => {
    const resolver = createPackModuleResolverFor([enabledPack()]);
    expect(resolver("ana", "http")).toBe("return {}");
  });

  it("returns undefined for an unknown namespace", () => {
    const resolver = createPackModuleResolverFor([enabledPack()]);
    expect(resolver("nope", "http")).toBeUndefined();
  });

  it("returns undefined for a disabled pack", () => {
    const resolver = createPackModuleResolverFor([enabledPack({ enabled: false })]);
    expect(resolver("ana", "http")).toBeUndefined();
  });

  it("refuses a modulePath that escapes the pack (path-jail defense in depth)", () => {
    const resolver = createPackModuleResolverFor([enabledPack()]);
    expect(resolver("ana", "../../etc/passwd")).toBeUndefined();
  });

  it("returns undefined for a module the pack does not declare", () => {
    const resolver = createPackModuleResolverFor([enabledPack()]);
    expect(resolver("ana", "nonexistent")).toBeUndefined();
  });
});

describe("packModulesSnapshot", () => {
  it("includes only enabled packs' modules", () => {
    const snapshot = packModulesSnapshot([enabledPack(), enabledPack({ namespace: "bee", enabled: false })]);
    expect(Object.keys(snapshot)).toEqual(["ana"]);
  });
});

describe("referencedPackNamespaces / grantClosurePacksFor", () => {
  it("finds a namespace referenced by a literal require string", () => {
    const scripts = [scriptBlock({ code: 'local http = require("ana/http")\nreturn http' })];
    expect(referencedPackNamespaces(scripts, [enabledPack()])).toEqual(["ana"]);
  });

  it("does not include an enabled pack that is never required", () => {
    const scripts = [scriptBlock({ code: "return 1" })];
    expect(referencedPackNamespaces(scripts, [enabledPack()])).toEqual([]);
  });

  it("does not include a disabled pack even if referenced", () => {
    const scripts = [scriptBlock({ code: 'require("ana/http")' })];
    expect(referencedPackNamespaces(scripts, [enabledPack({ enabled: false })])).toEqual([]);
  });

  it("grantClosurePacksFor carries namespace/version/modules for a referenced pack", () => {
    const scripts = [scriptBlock({ code: 'require("ana/http")' })];
    const packs = grantClosurePacksFor(scripts, [enabledPack({ manifest: { name: "ana", engine: "react", components: {}, version: "1.0.0" } })]);
    expect(packs).toEqual([{ namespace: "ana", version: "1.0.0", modules: { "http.lua": "return {}" } }]);
  });
});

/**
 * Phase M3 (worker 2) — the platform-agnostic pack model: opening a `.mkp`
 * archive's bytes into an `EnabledPack`, detecting namespace collisions
 * among a set of them, and a synchronous `PackModuleResolver`
 * (`@markii/lua`'s `require "packName/modulePath"` seam) over their Lua
 * modules.
 *
 * Pure: `@markii/pack`'s main entry has no Node/browser dependency, and
 * neither does this module. `platform/browser/packStore.ts` owns the
 * actual persistence (a JSON file on the shared lightning-fs vault,
 * mirroring `grantStore.ts`'s convention) and the "currently enabled"
 * state; this module is what that store's `enable()` calls to validate and
 * decode an archive's bytes in the first place.
 *
 * ## `webview.js` is decoded, never executed
 *
 * `openPackArchive`'s `scriptBytes` (the pack's compiled `webview.js`) and
 * `stylesheetBytes` are NEVER read by this module, NEVER persisted by
 * `packStore.ts`, and NEVER referenced by any Lua-facing API here. Only
 * `scriptModules` (the pack's shared `scripts/*.lua`, pure Lua SOURCE TEXT)
 * is decoded and kept — see `docs/ARCHITECTURE.md`'s Phase M3 section and
 * `src/markdown/packPlaceholder.tsx`'s doc comment for the full reasoning:
 * a pack's compiled JS component is arbitrary third-party code with no
 * sandbox on this app's rendering path, and running it would hand a pack
 * full access to the app origin merely by a note being opened.
 */
import {
  detectNamespaceCollisions,
  openPackArchive,
  parsePackManifest,
  type NamespaceCollision,
  type PackManifest,
} from "@markii/pack";
import { normalizeBundlePath } from "@markii/bundle";
import type { GrantClosurePack } from "@markii/runtime";
import type { ScriptBlock } from "@markii/core";
import type { PackModuleResolver } from "@markii/lua";

/** One installed, decoded pack — everything the host needs to register its components as placeholders, resolve its Lua modules, and hash it into a grant closure. Never carries `scriptBytes`/`stylesheetBytes` (see module doc). */
export interface EnabledPack {
  /** The pack's namespace, `manifest.name` (`@markii/pack`'s `validatePackName` already enforced this at `parsePackManifest`/`openPackArchive` time). */
  namespace: string;
  manifest: PackManifest;
  /** Bundle-relative `scripts/*.lua` module path (no `scripts/` prefix, e.g. `"http.lua"`) -> decoded UTF-8 source text. */
  scriptModules: Readonly<Record<string, string>>;
  /** Whether this pack is currently active (`packStore.ts`'s `enable`/`disable`). A disabled pack stays in the store (so re-enabling needs no re-upload) but contributes nothing to rendering, completion, or `require` resolution. */
  enabled: boolean;
  enabledAt: number;
}

export type PackLoadFailure =
  | { kind: "zip"; message: string }
  | { kind: "manifest"; errors: string[] }
  | { kind: "missing-entry"; entry: string; message: string };

export type PackLoadResult = { ok: true; pack: EnabledPack } | { ok: false; error: PackLoadFailure };

/**
 * Opens a `.mkp` archive's raw bytes and decodes it into an `EnabledPack`
 * (`enabled: true`, `enabledAt: Date.now()`). Never throws — every failure
 * (`openPackArchive`'s own `PackArchiveError` cases) comes back as
 * `{ ok: false, error }`. `webview.js`/`webview.css` bytes are read by
 * `openPackArchive` internally but discarded here immediately — never
 * copied into the returned `EnabledPack`, never executed.
 */
export async function loadPackFromArchiveBytes(bytes: Uint8Array): Promise<PackLoadResult> {
  const result = await openPackArchive(bytes);
  if (!result.ok) return { ok: false, error: result.error };

  const decoder = new TextDecoder();
  const scriptModules: Record<string, string> = {};
  for (const [path, moduleBytes] of Object.entries(result.archive.scriptModules)) {
    scriptModules[path] = decoder.decode(moduleBytes);
  }

  return {
    ok: true,
    pack: {
      namespace: result.archive.manifest.name,
      manifest: result.archive.manifest,
      scriptModules,
      enabled: true,
      enabledAt: Date.now(),
    },
  };
}

/** Re-validates a persisted manifest (belt and suspenders for a hand-edited or corrupted store entry) — never throws. */
export function revalidatePackManifest(manifestJson: string): { ok: true; manifest: PackManifest } | { ok: false; errors: string[] } {
  const result = parsePackManifest(manifestJson);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, manifest: result.manifest };
}

/** Namespace collisions among the given packs' namespaces, in `@markii/pack`'s own `detectNamespaceCollisions` shape. Only ENABLED packs should ordinarily be passed here — see `packStore.ts`'s `enable()`, which checks a candidate against the currently enabled set before persisting it. */
export function collisionsAmong(packs: readonly Pick<EnabledPack, "namespace">[]): readonly NamespaceCollision[] {
  return detectNamespaceCollisions(packs.map((p) => p.namespace));
}

/**
 * Builds a synchronous `PackModuleResolver` (`@markii/lua`'s `require
 * "packName/modulePath"` seam) over a set of enabled packs' decoded Lua
 * modules. Disabled packs and unknown namespaces resolve to `undefined`
 * (a clean capability denial upstream, never a crash). A `modulePath` that
 * fails `normalizeBundlePath` (a `..` segment, an absolute path, a
 * backslash, a drive letter, a null byte) is refused the same way —
 * belt-and-suspenders alongside the fact that `scriptModules` is a flat
 * map keyed by exact, already-validated archive paths, so a traversal
 * string could never coincidentally match a real key anyway; this makes
 * "a path outside the pack is refused" a directly testable, named
 * behavior rather than an accident of map lookup semantics.
 *
 * Tries `modulePath` and `${modulePath}.lua` as candidate keys: a script
 * writes `require "ana/http"` (no extension, per spec), while
 * `openPackArchive`'s `scriptModules` keys carry the real file's `.lua`
 * extension (`"http.lua"`).
 */
export function createPackModuleResolverFor(packs: readonly EnabledPack[]): PackModuleResolver {
  const byNamespace = new Map<string, EnabledPack>();
  for (const pack of packs) {
    if (pack.enabled) byNamespace.set(pack.namespace, pack);
  }

  return (packName, modulePath) => {
    const pack = byNamespace.get(packName);
    if (!pack) return undefined;

    const normalized = normalizeBundlePath(modulePath);
    if (!normalized.ok) return undefined;

    const candidates = [normalized.path, `${normalized.path}.lua`];
    for (const candidate of candidates) {
      if (Object.hasOwn(pack.scriptModules, candidate)) return pack.scriptModules[candidate];
    }
    return undefined;
  };
}

/** Plain data snapshot for `@markii/lua`'s in-worker resolver construction (see `platform/browser/workerProtocol.ts`): namespace -> module path -> source text, enabled packs only. */
export function packModulesSnapshot(packs: readonly EnabledPack[]): Record<string, Record<string, string>> {
  const snapshot: Record<string, Record<string, string>> = {};
  for (const pack of packs) {
    if (pack.enabled) snapshot[pack.namespace] = { ...pack.scriptModules };
  }
  return snapshot;
}

/**
 * Which of the given enabled packs' namespaces are actually referenced by
 * `require "<namespace>/..."` anywhere in `scripts`' code — a lightweight
 * source scan (not a real Lua parse), used ONLY to decide which packs'
 * modules participate in this note's grant-closure hash
 * (`grantClosure.ts`). A false negative (a dynamically-built require
 * string this regex can't see) means that pack's version/modules don't
 * invalidate this note's grant when they change — a known, documented
 * limitation (see the M3 worker-2 handoff), not a security hole: the
 * closure still includes every namespace this scan DOES find, which is the
 * overwhelming common case (`require "ns/module"` written as a literal).
 */
export function referencedPackNamespaces(scripts: readonly ScriptBlock[], enabledPacks: readonly EnabledPack[]): string[] {
  const known = new Set(enabledPacks.filter((p) => p.enabled).map((p) => p.namespace));
  const found = new Set<string>();
  const pattern = /require\s*\(?\s*["']([a-z][a-z0-9-]*)\//g;
  for (const script of scripts) {
    for (const match of script.code.matchAll(pattern)) {
      const namespace = match[1]!;
      if (known.has(namespace)) found.add(namespace);
    }
  }
  return [...found];
}

/** Builds this note's `GrantClosurePack[]` section (`@markii/runtime`'s `GrantClosure.packs`) for the packs it actually references — see `referencedPackNamespaces`. */
export function grantClosurePacksFor(scripts: readonly ScriptBlock[], enabledPacks: readonly EnabledPack[]): GrantClosurePack[] {
  const byNamespace = new Map(enabledPacks.map((p) => [p.namespace, p] as const));
  return referencedPackNamespaces(scripts, enabledPacks).map((namespace) => {
    const pack = byNamespace.get(namespace)!;
    return {
      namespace,
      version: pack.manifest.version ?? "",
      modules: { ...pack.scriptModules },
    };
  });
}

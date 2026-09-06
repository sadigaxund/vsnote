/**
 * Phase M3 — builds the capability config a `ScriptIsolate` run needs, from
 * a `RunTrigger`'s tier plus whatever `GrantedPermissions` apply.
 *
 * This is the enforcement point CLAUDE.md's brief calls out explicitly:
 * "auto and scheduled get the read-only tier and must not receive
 * write-capable capabilities - enforce this in the code, do not merely pass
 * the tier down and trust the library". `@markii/lua`'s own `runScript`
 * DOES already refuse an effectful op under `tier: 'auto'` (see that
 * package's `capabilities.ts`), but this module does not rely on that alone
 * — for a non-manual tier it never even CONSTRUCTS a net config with `post`/
 * `patch` populated, regardless of what `GrantedPermissions` says. Two
 * independent reasons a write can't happen under `auto`/`scheduled`: the
 * library's own tier check, and this module never handing it the means to
 * try. This mirrors the belt-and-suspenders discipline `@markii/lua` itself
 * uses throughout (see e.g. its `require.ts` doc comment on the bytecode
 * signature check).
 *
 * ## `GrantedPermissions.bundleWrite`, now consumed (worker 2)
 *
 * Worker 1 left `GrantedPermissions.bundleWrite` (`host/types.ts`) threaded
 * through the grant request/decision/store round trip but unconsumed, with
 * an explicit written contract for whoever wired up `.mkz` bundles next:
 * construct a write-capable `ScriptView` ONLY inside the
 * `tier === "manual"` branch, gated on `permissions.bundleWrite`, and never
 * even attempt to construct one on the `tier !== "manual"` branch,
 * regardless of what a stored grant says. See "Worker 2's bundle/cache
 * wiring" below (on `grantedBundlePermissions`/`buildBundleCapability`) for
 * exactly how that contract is honored.
 */
import type { ExecutionTier, RunTrigger } from "@markii/runtime";
import { tierForTrigger } from "@markii/runtime";
import type { CacheProvider, NetGrants, NetProvider } from "@markii/lua";
import { createScriptView, type BundleManifest, type BundleStorage, type ScriptView } from "@markii/bundle";
import { createCacheProvider } from "./bundle";
import { NO_PERMISSIONS, type GrantedPermissions } from "./types";

export interface CapabilityInputs {
  trigger: RunTrigger;
  /** The grant to apply. Ignored entirely for a non-manual tier — see module doc. Pass `NO_PERMISSIONS` (or omit) when no grant exists. */
  permissions?: GrantedPermissions;
  /** The host's real network primitive. Omitted entirely, no script in this batch can reach the network regardless of tier or grant. */
  netProvider?: NetProvider;
  /** This note's opened `.mkz` bundle, if any (worker 2). Omitted entirely, no `bundle`/`cache` capability is ever constructed, for any tier — see this module's "worker 2's bundle/cache wiring" section below. */
  bundle?: { storage: BundleStorage; manifest: BundleManifest };
  /** Enabled packs' Lua modules, namespace -> module path -> source text (`host/packs.ts`'s `packModulesSnapshot`). Omitted or empty, no pack-namespaced `require` can resolve, at any tier — `require` never writes, so this is not tier- or grant-gated the way `bundleWrite` is. */
  packModules?: Record<string, Record<string, string>>;
}

/**
 * The subset of `@markii/lua`'s `RunScriptOptions` this module is
 * responsible for building. `code`/`doc` are supplied per-script by
 * `runDocumentScripts`; `wasmUri`/`limits`/`marshalLimits` are the
 * isolate's own construction-time concerns (see
 * `platform/browser/scriptIsolate.ts`), not this module's.
 *
 * `bundle`/`cache` are real, function-carrying objects here (this is the
 * host layer, not the browser Worker boundary): the browser adapter never
 * `postMessage`s them directly to the Worker that actually runs
 * `@markii/lua` — see `platform/browser/workerProtocol.ts`'s
 * `bundle-call`/`cache-call` RPC pair, the exact same pattern `net-call`
 * already established for `net`. `packModules` is plain, structured-
 * cloneable DATA (never a function), because `@markii/lua`'s own
 * `PackModuleResolver` is itself synchronous — the browser Worker builds
 * one locally from this map, with no RPC round trip needed at all.
 */
export interface CapabilityConfig {
  tier: ExecutionTier;
  net?: NetProvider;
  netGrants?: NetGrants;
  bundle?: ScriptView;
  cache?: CacheProvider;
  packModules?: Record<string, Record<string, string>>;
}

/**
 * Worker 2's bundle/cache wiring, following worker 1's written contract
 * above EXACTLY: `bundle` (a `ScriptView`, `@markii/bundle`) is built with
 * `createScriptView(storage, manifest, grantedBundlePermissions)`, where
 * the granted set is THIS module's own decision, never the manifest's —
 * it always includes `'read'` when a bundle is present at all (reading a
 * note's own bundle-scoped assets is not an exfiltration risk the way
 * `net` is; there is deliberately no `GrantedPermissions` flag for "may
 * read", unlike `bundleWrite`, because read was never meant to need one),
 * and it includes `'write:.cache/'` ONLY when the caller passes
 * `includeWrite: true` — which `buildCapabilityConfig` below only ever
 * does inside its `tier === "manual"` branch, gated on
 * `permissions.bundleWrite`. `createScriptView` itself then intersects
 * this against the bundle's OWN `manifest.permissions.bundle` (DEFECT 10:
 * declaring is not granting) — a manifest can only ever narrow what this
 * module offers, never expand it.
 *
 * The `tier !== "manual"` branch below never evaluates
 * `permissions.bundleWrite` at all when building ITS bundle view: it
 * always calls this with `includeWrite: false`, so the returned
 * `ScriptView`'s `write` is structurally incapable of succeeding
 * (`createScriptView` throws `ScriptCapabilityError` for any call outside
 * the granted set) — the means is never constructed, mirroring exactly
 * how `net`'s `post`/`patch` stripping already works in this module. This
 * is a THIRD independent reason a non-manual run cannot write to a bundle,
 * alongside `@markii/lua`'s own tier gate on `bundle.write` and
 * `@markii/bundle`'s own `isWriteAllowed` policy check.
 */
function grantedBundlePermissions(includeWrite: boolean): { bundle: ("read" | "write:.cache/")[] } {
  return { bundle: includeWrite ? ["read", "write:.cache/"] : ["read"] };
}

/**
 * `cache` (`./cache.ts`... see `./bundle.ts`'s `createCacheProvider`) is
 * wired independently of `permissions.bundleWrite` and of tier: a bundle's
 * `.cache/` is host-internal memoization, not the script-facing
 * `bundle.write` capability — see `./bundle.ts`'s module doc for the full
 * reasoning. Both `tier` branches below call this the same way.
 */
function buildBundleCapability(
  bundleInput: CapabilityInputs["bundle"],
  includeWrite: boolean,
): Pick<CapabilityConfig, "bundle"> {
  if (!bundleInput) return {};
  return { bundle: createScriptView(bundleInput.storage, bundleInput.manifest, grantedBundlePermissions(includeWrite)) };
}

/**
 * `tierForTrigger('manual') === 'manual'`; `'auto'` and `'scheduled'` both
 * map to `'auto'`. Re-derives the tier from `trigger` itself (rather than
 * trusting a caller-supplied tier) so there is exactly one place in this
 * codebase that decides what a trigger is allowed to do.
 */
export function buildCapabilityConfig(inputs: CapabilityInputs): CapabilityConfig {
  const tier = tierForTrigger(inputs.trigger);
  const netProvider = inputs.netProvider;
  const cache = inputs.bundle ? createCacheProvider(inputs.bundle.storage) : undefined;
  const packModules = inputs.packModules && Object.keys(inputs.packModules).length > 0 ? inputs.packModules : undefined;

  if (tier !== "manual") {
    // auto/scheduled: read-only, full stop. Even if a manual grant exists
    // for this exact note (its key would still match — a grant is content-
    // keyed, not tier-keyed), it is NEVER consulted here. Only a bare `get`
    // is ever wired up, and only when a NetProvider exists at all; `post`/
    // `patch` are never populated on this path, so there is no "grants that
    // happen to include them" for the library's own tier check to have to
    // catch as a second line of defense. `permissions.bundleWrite` is never
    // even read on this branch — `buildBundleCapability` is always called
    // with `includeWrite: false` — see this module's doc comment.
    const bundleCap = buildBundleCapability(inputs.bundle, false);
    if (!netProvider) return { tier, ...bundleCap, cache, packModules };
    return {
      tier,
      net: netProvider,
      // `post` is deliberately empty here (not merely tier-blocked by the
      // library) so this host-level config carries no post-capable hosts at
      // all for a non-manual run, regardless of what the manual grant (if
      // any) contains — see this module's doc comment.
      netGrants: { get: readAllowedGets(inputs.permissions), post: [] },
      ...bundleCap,
      cache,
      packModules,
    };
  }

  const permissions = inputs.permissions ?? NO_PERMISSIONS;
  const bundleCap = buildBundleCapability(inputs.bundle, permissions.bundleWrite);
  if (!netProvider) return { tier, ...bundleCap, cache, packModules };
  return {
    tier,
    net: netProvider,
    netGrants: {
      get: permissions.net.get,
      post: permissions.net.post,
    },
    ...bundleCap,
    cache,
    packModules,
  };
}

/**
 * Even under the read-only tier, a `get` allowlist is meaningful (reading is
 * not an effectful op) — but only hosts the note's OWN manual grant (if any
 * exists) already covers are exposed, never an unbounded allowlist. Absent
 * any grant, `auto`/`scheduled` scripts get no network access at all.
 */
function readAllowedGets(permissions: GrantedPermissions | undefined): readonly string[] {
  return permissions?.net.get ?? [];
}

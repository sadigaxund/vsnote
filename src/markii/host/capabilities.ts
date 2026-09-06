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
 * ## `GrantedPermissions.bundleWrite` is intentionally unread here
 *
 * This module builds ONLY the `net` half of a run's capabilities — bundle
 * access (`@markii/bundle`'s `ScriptView`, spec §11) is worker 2's to wire
 * up once `.mkz` bundles exist, and `CapabilityConfig` below deliberately
 * has no `bundle` field yet. `GrantedPermissions.bundleWrite` (`host/
 * types.ts`) already exists and is already threaded through the grant
 * request/decision/store round trip end to end (a worker-3 prompt can set
 * it, `GrantStore` persists it) - it is simply not yet CONSUMED, because
 * there is nothing to consume it into. This is a documented gap, not a
 * silent one: when worker 2 adds a `bundle?: ScriptView` field to
 * `CapabilityConfig`, it MUST follow the exact same shape this module
 * already establishes for `net` - construct a write-capable `ScriptView`
 * ONLY inside the `tier === "manual"` branch, gated on
 * `permissions.bundleWrite`, and never even attempt to construct one on the
 * `tier !== "manual"` branch above, regardless of what a stored grant says.
 * That mirrors "auto/scheduled never even gets handed the means to write,"
 * not merely "the library's tier check happens to refuse it" - the same
 * belt-and-suspenders reasoning `net`'s `post`/`patch` stripping already
 * uses here. Until that lands, an `auto`/`scheduled` run cannot write to a
 * bundle for the more basic reason that no `ScriptView` of ANY kind - read
 * or write - is ever constructed for it by this module today.
 */
import type { ExecutionTier, RunTrigger } from "@markii/runtime";
import { tierForTrigger } from "@markii/runtime";
import type { NetGrants, NetProvider } from "@markii/lua";
import { NO_PERMISSIONS, type GrantedPermissions } from "./types";

export interface CapabilityInputs {
  trigger: RunTrigger;
  /** The grant to apply. Ignored entirely for a non-manual tier — see module doc. Pass `NO_PERMISSIONS` (or omit) when no grant exists. */
  permissions?: GrantedPermissions;
  /** The host's real network primitive. Omitted entirely, no script in this batch can reach the network regardless of tier or grant. */
  netProvider?: NetProvider;
}

/** The subset of `@markii/lua`'s `RunScriptOptions` this module is responsible for building. `code`/`doc` are supplied per-script by `runDocumentScripts`; `wasmUri`/`limits`/`marshalLimits`/`bundle` are the isolate's own construction-time concerns (see `platform/browser/scriptIsolate.ts`), not this module's. */
export interface CapabilityConfig {
  tier: ExecutionTier;
  net?: NetProvider;
  netGrants?: NetGrants;
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

  if (tier !== "manual") {
    // auto/scheduled: read-only, full stop. Even if a manual grant exists
    // for this exact note (its key would still match — a grant is content-
    // keyed, not tier-keyed), it is NEVER consulted here. Only a bare `get`
    // is ever wired up, and only when a NetProvider exists at all; `post`/
    // `patch` are never populated on this path, so there is no "grants that
    // happen to include them" for the library's own tier check to have to
    // catch as a second line of defense.
    if (!netProvider) return { tier };
    return {
      tier,
      net: netProvider,
      // `post` is deliberately empty here (not merely tier-blocked by the
      // library) so this host-level config carries no post-capable hosts at
      // all for a non-manual run, regardless of what the manual grant (if
      // any) contains — see this module's doc comment.
      netGrants: { get: readAllowedGets(inputs.permissions), post: [] },
    };
  }

  const permissions = inputs.permissions ?? NO_PERMISSIONS;
  if (!netProvider) return { tier };
  return {
    tier,
    net: netProvider,
    netGrants: {
      get: permissions.net.get,
      post: permissions.net.post,
    },
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

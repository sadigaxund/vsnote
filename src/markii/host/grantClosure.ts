/**
 * Phase M3 — assembles a `@markii/runtime` `GrantClosure` from a note's own
 * script blocks plus (as of worker 2) its resolved bundle-local modules and
 * referenced pack modules, and hashes it via `computeGrantKey`. Pure,
 * host-level (no I/O): `@markii/runtime`'s `grant-key.ts` deliberately does
 * not import `@markii/core`'s `ScriptBlock`, so this module is the seam
 * that adapts one to the other.
 *
 * `computeGrantKey` hashes four sections (docs/security.md: "its inline
 * scripts, `src=` script files, required bundle-local modules, and the
 * versions of any pack modules it requires"):
 *
 * - `scripts` — the note's own inline/`src=` script blocks. Always
 *   populated (worker 1).
 * - `bundleModules` — bundle-relative path -> source text, for every
 *   `src=` target this note declares AND has a bundle to resolve it
 *   against. Populated as of worker 2 via `runScripts.ts`, which reads
 *   each `src=` block's target through the note's opened bundle (if any)
 *   before calling into this module. A `src=` block with no path (an
 *   inline block) contributes nothing here; a `src=` block whose bundle
 *   read fails (no bundle open, file missing) is simply omitted — its
 *   `src` path string still participates via the `scripts` section, so
 *   RENAMING a `src=` target still changes the key, but this build does
 *   not invent placeholder content for a file it could not read.
 * - `vaultModules` — VSNote has no vault-wide shared-Lua-module concept
 *   (nothing in this codebase registers one); this section is always
 *   empty. This is a real, deliberate scope boundary, not an oversight:
 *   see the M3 worker-2 handoff's findings.
 * - `packs` — namespace/version/modules for every ENABLED pack this note's
 *   scripts actually reference via a literal `require "namespace/..."`
 *   (`host/packs.ts`'s `referencedPackNamespaces`/`grantClosurePacksFor`).
 *   A dynamically-constructed require string this heuristic can't see
 *   would not be caught — documented in `host/packs.ts`'s own doc comment,
 *   not silently assumed complete.
 *
 * `buildGrantClosure` takes ONE options object (not a bare scripts array)
 * so a future field never needs a new positional parameter.
 */
import { computeGrantKey, type GrantClosure, type GrantClosurePack } from "@markii/runtime";
import type { ScriptBlock } from "@markii/core";

export interface GrantClosureInputs {
  scripts: readonly ScriptBlock[];
  /** Bundle-relative `src=` path -> resolved source text (`runScripts.ts` resolves these through the note's opened bundle, when one exists). Omitted or empty when no bundle is open, or no `src=` block resolved. */
  bundleModules?: Record<string, string>;
  /** Enabled-pack sections this note's scripts actually reference (`host/packs.ts`'s `grantClosurePacksFor`). Omitted or empty when no bundle/packs apply. */
  packs?: readonly GrantClosurePack[];
}

/** Builds the executable closure for a note's script blocks (+ resolved bundle/pack modules, see module doc), in document order. `vaultModules` is always `{}` — see module doc for why. */
export function buildGrantClosure(inputs: GrantClosureInputs): GrantClosure {
  return {
    scripts: inputs.scripts.map((s) => ({
      name: s.name,
      lang: s.lang,
      src: s.src,
      code: s.code,
    })),
    bundleModules: { ...(inputs.bundleModules ?? {}) },
    vaultModules: {},
    packs: [...(inputs.packs ?? [])],
  };
}

/** Convenience: hash a note's full executable closure to its grant key. */
export function computeNoteGrantKey(inputs: GrantClosureInputs): Promise<string> {
  return computeGrantKey(buildGrantClosure(inputs));
}

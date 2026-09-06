/**
 * Phase M3 — assembles a `@markii/runtime` `GrantClosure` from a note's own
 * script blocks, and hashes it via `computeGrantKey`. Pure, host-level
 * (no I/O): `@markii/runtime`'s `grant-key.ts` deliberately does not import
 * `@markii/core`'s `ScriptBlock`, so this module is the seam that adapts one
 * to the other.
 *
 * M3 scope note: `bundleModules`, `vaultModules`, and `packs` are the three
 * OTHER sections `computeGrantKey` hashes (docs/security.md: "its inline
 * scripts, `src=` script files, required bundle-local modules, and the
 * versions of any pack modules it requires"). Worker 1 has no bundle or pack
 * plumbing yet (that is worker 2's job), so this module hashes ONLY the
 * note's own inline script blocks today, with the other three sections
 * empty. This is intentionally not a silent gap: a `src=` long-script
 * reference or a `require`d bundle/pack module changing would NOT currently
 * invalidate a grant, because this closure never sees that code. Once
 * worker 2's bundle loader can resolve `src=`/`require` targets to source
 * text, `buildGrantClosure` must be extended to populate `bundleModules`/
 * `vaultModules`/`packs` from that resolution — tracked as finding 1 in
 * worker 1's handoff report; a `src=`-only script currently hashes the same
 * key regardless of what its referenced file contains.
 */
import { computeGrantKey, type GrantClosure } from "@markii/runtime";
import type { ScriptBlock } from "@markii/core";

/** Builds the (currently scripts-only, see module doc) executable closure for a note's script blocks, in document order. */
export function buildGrantClosure(scripts: readonly ScriptBlock[]): GrantClosure {
  return {
    scripts: scripts.map((s) => ({
      name: s.name,
      lang: s.lang,
      src: s.src,
      code: s.code,
    })),
    bundleModules: {},
    vaultModules: {},
    packs: [],
  };
}

/** Convenience: hash a note's scripts directly to its grant key. */
export function computeNoteGrantKey(scripts: readonly ScriptBlock[]): Promise<string> {
  return computeGrantKey(buildGrantClosure(scripts));
}

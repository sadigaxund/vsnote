/**
 * Singleton lightning-fs instance — the one virtual filesystem backing both
 * the app's file operations (`fs/operations.ts`) and isomorphic-git
 * (`git/`). Data lives in IndexedDB under `DB_NAME` and survives reloads;
 * `resetFilesystem()` wipes and re-initializes it in place (used by
 * "Reset demo vault").
 *
 * DEMO BUILDS (DESIGN-SPEC Amendments round 9 item 45) never touch this
 * database: `VSNOTE_DEMO_VAULT=1` swaps in a SEPARATE database constructed
 * with lightning-fs's `wipe: true`, which deletes it on every page load.
 * The demo is therefore a per-session sandbox — fully interactive (edits,
 * diffs, commits, the whole git-state showcase), but nothing survives a
 * reload and the user's real vault DB is structurally unreachable. That is
 * what replaced the old "Load demo vault" command, whose only purpose was
 * destroying the real vault to make room for demo content — a self-destruct
 * option has no business being a palette entry.
 */
import FS from "@isomorphic-git/lightning-fs";

// Renamed with the rest of the rebrand (DESIGN-SPEC item 34, user decision
// 2026-08-17). There is deliberately NO migration: lightning-fs opens a new,
// empty database under this name, so a vault created before the rename is not
// read anymore. The old `slate-vault-fs` database stays inert in the browser
// until the user clears site data. See CHANGELOG's Breaking section.
const DB_NAME_REAL = "vsnote-vault-fs";

/** Compile-time demo flag (vite `define` from VSNOTE_DEMO_VAULT — see
 * vite.config.ts / src/env.d.ts). Read directly here rather than via
 * fs/seed.ts to keep this module free of import cycles: client sits BELOW
 * operations/seed in the dependency graph. */
export const IS_DEMO_FS = __VSNOTE_DEMO_VAULT__;

export const DB_NAME = IS_DEMO_FS ? "vsnote-vault-demo-fs" : DB_NAME_REAL;

export const fs = new FS(DB_NAME, IS_DEMO_FS ? { wipe: true } : undefined);

/** The promisified fs surface — every operation module imports this. */
export const pfs = fs.promises;

/** Wipes the IndexedDB-backed filesystem and re-initializes it empty. In a
 * demo build this resets the EPHEMERAL sandbox database (which would be wiped
 * by the next page load anyway); in a normal build it destroys the real vault
 * behind its confirm dialog. */
export function resetFilesystem(): void {
  fs.init(DB_NAME, { wipe: true });
}

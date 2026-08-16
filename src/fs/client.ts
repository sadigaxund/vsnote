/**
 * Singleton lightning-fs instance — the one virtual filesystem backing both
 * the app's file operations (`fs/operations.ts`) and isomorphic-git
 * (`git/`). Data lives in IndexedDB under `DB_NAME` and survives reloads;
 * `resetFilesystem()` wipes and re-initializes it in place (used by
 * "Reset demo vault").
 */
import FS from "@isomorphic-git/lightning-fs";

// Renamed with the rest of the rebrand (DESIGN-SPEC item 34, user decision
// 2026-08-17). There is deliberately NO migration: lightning-fs opens a new,
// empty database under this name, so a vault created before the rename is not
// read anymore. The old `slate-vault-fs` database stays inert in the browser
// until the user clears site data. See CHANGELOG's Breaking section.
export const DB_NAME = "vsnote-vault-fs";

export const fs = new FS(DB_NAME);

/** The promisified fs surface — every operation module imports this. */
export const pfs = fs.promises;

/** Wipes the IndexedDB-backed filesystem and re-initializes it empty. */
export function resetFilesystem(): void {
  fs.init(DB_NAME, { wipe: true });
}

/**
 * Singleton lightning-fs instance — the one virtual filesystem backing both
 * the app's file operations (`fs/operations.ts`) and isomorphic-git
 * (`git/`). Data lives in IndexedDB under `DB_NAME` and survives reloads;
 * `resetFilesystem()` wipes and re-initializes it in place (used by
 * "Reset demo vault").
 */
import FS from "@isomorphic-git/lightning-fs";

export const DB_NAME = "slate-vault-fs";

export const fs = new FS(DB_NAME);

/** The promisified fs surface — every operation module imports this. */
export const pfs = fs.promises;

/** Wipes the IndexedDB-backed filesystem and re-initializes it empty. */
export function resetFilesystem(): void {
  fs.init(DB_NAME, { wipe: true });
}

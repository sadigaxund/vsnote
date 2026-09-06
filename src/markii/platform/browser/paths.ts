/**
 * Phase M3 — path encoding for the `/.markii/` logical folder, mirroring
 * `src/fs/drafts.ts`'s `/.drafts` convention exactly (a second logical
 * folder on the SAME lightning-fs instance, not a second IndexedDB
 * dependency — see that file's module doc for the original rationale, which
 * this restates rather than re-derives): a note's display path is
 * `encodeURIComponent`-ed into a single path segment, so a nested display
 * path (`notes/sub/dir/file.mk.md`) never becomes nested directories under
 * `/.markii/values/`, and a path containing characters that would otherwise
 * collide with lightning-fs's own path syntax (`/`, `..`) is neutralized by
 * the same escaping every other consumer of a note's display path already
 * gets from `encodeURIComponent`.
 *
 * Pure functions, no fs access — kept separate from `valuePersistence.ts`/
 * `grantStore.ts` so the encoding rule itself is directly unit-testable
 * (`tests/unit/markiiPersistencePaths.test.ts`) without touching lightning-fs
 * at all.
 */
const MARKII_DIR = "/.markii";
const VALUES_DIR = `${MARKII_DIR}/values`;
const GRANTS_FILE = `${MARKII_DIR}/grants.json`;

/** The `/.markii/values/` folder itself, for `ensureDir`. */
export function valuesDir(): string {
  return VALUES_DIR;
}

/** The per-note persisted-values file path for a note's display path. */
export function valueFsPath(displayPath: string): string {
  return `${VALUES_DIR}/${encodeURIComponent(displayPath)}.json`;
}

/** The single grants file path (one JSON file for every grant, see `grantStore.ts`). */
export function grantsFsPath(): string {
  return GRANTS_FILE;
}

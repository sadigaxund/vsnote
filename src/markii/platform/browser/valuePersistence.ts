/**
 * Phase M3 — the pure (no `src/fs/*` import) half of per-note value
 * persistence: given a `FileOps` (`fileOps.ts`), reads/writes the one
 * JSON-per-note-path convention under `/.markii/values/` (`paths.ts`). See
 * `fileOps.ts`'s doc comment for why this file is deliberately NOT wired to
 * the real lightning-fs client directly — that wiring lives in
 * `lightningFsOps.ts`, the one file this module's own unit tests never
 * import.
 *
 * See `src/markii/host/valuePersistence.ts` for the platform-agnostic
 * hydrate/degrade rules this feeds (stale-marking on hydrate, etc.) — that
 * module never touches a filesystem at all, this one only ever moves plain
 * JSON in and out of one.
 *
 * No debounce here (unlike `src/fs/drafts.ts`'s keystroke-driven
 * checkpoint): a `runScripts` call is already an explicit, infrequent,
 * user-or-schedule-triggered event, not a per-keystroke one, so writing the
 * snapshot immediately after a run is the right cost/benefit trade-off.
 */
import type { StoredValue } from "@markii/runtime";
import { readJsonFile, removeFileIfExists, writeJsonFile, type FileOps } from "./fileOps";
import { valueFsPath, valuesDir } from "./paths";

/** Reads a note's persisted value snapshot, or `undefined` if none has ever been written. */
export function loadPersistedValuesOver(
  ops: FileOps,
  displayPath: string,
): Promise<Record<string, StoredValue> | undefined> {
  return readJsonFile<Record<string, StoredValue>>(ops, valueFsPath(displayPath));
}

/** Writes a note's value snapshot, replacing whatever was there before. */
export function savePersistedValuesOver(
  ops: FileOps,
  displayPath: string,
  values: Record<string, StoredValue>,
): Promise<void> {
  return writeJsonFile(ops, valueFsPath(displayPath), values);
}

/** Removes a note's persisted values (e.g. the note itself was deleted). */
export function clearPersistedValuesOver(ops: FileOps, displayPath: string): Promise<void> {
  return removeFileIfExists(ops, valueFsPath(displayPath));
}

/** Exposed for tests/tooling that want the folder without reaching into `paths.ts` directly. */
export function markiiValuesDir(): string {
  return valuesDir();
}

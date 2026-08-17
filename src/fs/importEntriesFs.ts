/**
 * DESIGN-SPEC Amendments round 5 item 39 — the half of the OS-import feature
 * that actually touches the vault filesystem. Split out of
 * `importEntries.ts` so that module can stay pure.
 *
 * The split is load-bearing: `fs/operations.ts` pulls in `fs/client.ts`,
 * which instantiates lightning-fs at module scope and opens IndexedDB just
 * by being imported. `vitest.config.ts` documents the invariant that
 * `drafts.test.ts` is the only unit test with a real filesystem behind it,
 * and while the pure helpers lived in the same module as these two
 * functions, `importEntries.test.ts` quietly became a second one: on CI
 * every `drafts.test.ts` test then hung at its first filesystem call until
 * the 20s timeout (six failures, green locally). Nothing here is unit
 * tested directly; every path-and-naming DECISION these two rely on is
 * covered by `importEntries.test.ts` against the pure module.
 */
import { pathExists, writeFile } from "./operations";
import { displayToFsPath, fsToDisplayPath } from "./paths";
import { joinFsPath, planImportPaths, type FlattenedEntry } from "./importEntries";

/** Which of `entries`' intended target paths (relative, matching
 * `FlattenedEntry.relativePath`) already exist under `targetDisplayPath` —
 * empty means "no prompt needed, just import". */
export async function detectConflictingPaths(
  targetDisplayPath: string,
  entries: FlattenedEntry[],
): Promise<string[]> {
  const targetFsPath = displayToFsPath(targetDisplayPath);
  const conflicts: string[] = [];
  for (const entry of entries) {
    const fsPath = joinFsPath(targetFsPath, entry.relativePath);
    if (await pathExists(fsPath)) conflicts.push(entry.relativePath);
  }
  return conflicts;
}

/** Writes every entry into the vault under `targetDisplayPath`, resolving
 * conflicts per `mode`. Binary files land as-is (`ArrayBuffer` -> raw
 * `Uint8Array` write, no text decoding). Returns the created display paths. */
export async function importEntriesIntoVault(
  targetDisplayPath: string,
  entries: FlattenedEntry[],
  mode: "rename" | "replace",
): Promise<string[]> {
  const targetFsPath = displayToFsPath(targetDisplayPath);
  const existing = new Set<string>();
  for (const entry of entries) {
    const fsPath = joinFsPath(targetFsPath, entry.relativePath);
    if (await pathExists(fsPath)) existing.add(fsPath);
  }
  const plan = planImportPaths(targetFsPath, entries, existing, mode);
  const createdDisplayPaths: string[] = [];
  for (const item of plan) {
    const bytes = new Uint8Array(await item.entry.file.arrayBuffer());
    await writeFile(item.targetFsPath, bytes);
    createdDisplayPaths.push(fsToDisplayPath(item.targetFsPath));
  }
  return createdDisplayPaths;
}

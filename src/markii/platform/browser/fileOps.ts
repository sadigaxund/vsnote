/**
 * Phase M3 — the minimal file-operations seam `valuePersistence.ts` and
 * `grantStore.ts` are built against, instead of importing `src/fs/*`
 * directly.
 *
 * Why this indirection exists: `tests/unit/fsIsolation.test.ts` is a
 * repo-wide ratchet that forbids any NEW unit test file from transitively
 * importing `src/fs/client.ts` (it instantiates lightning-fs at module
 * scope; a second consumer alongside `drafts.test.ts` was found to hang the
 * whole suite on CI — see that guard's doc comment for the incident). This
 * module is the "pure half" split its own doc comment prescribes: a plain
 * TypeScript interface with no filesystem import at all, so
 * `valuePersistence.ts`/`grantStore.ts` can be exercised in a unit test
 * against an in-memory fake, while the ONE file that wires this interface
 * to the real lightning-fs client (`lightningFsOps.ts`) is never imported
 * by any test file.
 */
export interface FileOps {
  pathExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

/** Reads and JSON-parses `path` via `ops`, or returns `undefined` for a missing file, malformed JSON, or a non-object top level. Never throws. */
export async function readJsonFile<T>(ops: FileOps, path: string): Promise<T | undefined> {
  if (!(await ops.pathExists(path))) return undefined;
  try {
    const raw = await ops.readFile(path);
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Writes `value` as JSON to `path` via `ops`, replacing whatever was there. */
export async function writeJsonFile(ops: FileOps, path: string, value: unknown): Promise<void> {
  await ops.writeFile(path, JSON.stringify(value));
}

/** Removes `path` via `ops` if it exists; a no-op otherwise. */
export async function removeFileIfExists(ops: FileOps, path: string): Promise<void> {
  if (await ops.pathExists(path)) await ops.removeFile(path);
}

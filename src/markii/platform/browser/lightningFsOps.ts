/**
 * Phase M3 — the ONE file that wires `fileOps.ts`'s `FileOps` seam to the
 * real, shared lightning-fs instance (`src/fs/client.ts` /
 * `src/fs/operations.ts`), following `src/fs/drafts.ts`'s convention
 * exactly: routed through `writeFile`/`removeFile` (never a raw `pfs` call)
 * so every write gets the same forced `pfs.flush()` those apply, and
 * sharing the SAME physical IndexedDB database rather than adding a second
 * one.
 *
 * Deliberately isolated in its own module (see `fileOps.ts`'s doc comment):
 * this is the one place in `src/markii/platform/browser/` that reaches
 * `src/fs/client.ts`, and no unit test file imports it — `tests/unit/
 * fsIsolation.test.ts` enforces that only `drafts.test.ts` (plus a fixed,
 * shrinking legacy allowlist) may transitively reach that module, so
 * `valuePersistence.ts`/`grantStore.ts` are tested against a fake `FileOps`
 * instead (see their respective `tests/unit/markii*.test.ts` files) while
 * THIS file's thin real-fs glue is exercised the same way the rest of the
 * app exercises `src/fs/operations.ts`: implicitly, through real usage.
 */
import { pathExists, removeFile, writeFile } from "../../../fs/operations";
import { pfs } from "../../../fs/client";
import type { FileOps } from "./fileOps";

export const lightningFsOps: FileOps = {
  pathExists,
  writeFile,
  removeFile,
  async readFile(path) {
    return (await pfs.readFile(path, { encoding: "utf8" })) as string;
  },
};

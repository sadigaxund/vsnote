/**
 * Phase M3 — the pure (no `src/fs/*` import) half of the browser
 * `GrantStore` (`src/markii/host/types.ts`). One JSON file,
 * `/.markii/grants.json`, holding every grant this vault has ever recorded,
 * keyed by grant key. See `fileOps.ts`'s doc comment for why this takes a
 * `FileOps` rather than importing the real lightning-fs client directly —
 * `lightningFsOps.ts` is the one file that wiring lives in.
 *
 * A single file rather than one-per-grant: grants are small, few (one per
 * distinct script closure a user has actually run manually, not per note),
 * and worker 3's settings panel wants to list ALL of them at once anyway
 * (`list()`) — a single read/parse is simpler than a directory listing plus
 * N reads for that case, with no real downside at this scale.
 */
import { readJsonFile, removeFileIfExists, writeJsonFile, type FileOps } from "./fileOps";
import type { GrantRecord, GrantStore } from "../../host/types";
import { grantsFsPath } from "./paths";

type GrantFile = Record<string, GrantRecord>;

function byNewestFirst(a: GrantRecord, b: GrantRecord): number {
  return b.grantedAt - a.grantedAt;
}

/** Builds a `GrantStore` backed by `/.markii/grants.json`, read/written through `ops`. */
export function createGrantStoreOver(ops: FileOps): GrantStore {
  async function readAll(): Promise<GrantFile> {
    return (await readJsonFile<GrantFile>(ops, grantsFsPath())) ?? {};
  }

  async function writeAll(grants: GrantFile): Promise<void> {
    if (Object.keys(grants).length === 0) {
      await removeFileIfExists(ops, grantsFsPath());
      return;
    }
    await writeJsonFile(ops, grantsFsPath(), grants);
  }

  return {
    async get(key) {
      const all = await readAll();
      return all[key];
    },
    async set(record) {
      const all = await readAll();
      all[record.key] = record;
      await writeAll(all);
    },
    async revoke(key) {
      const all = await readAll();
      if (!(key in all)) return;
      delete all[key];
      await writeAll(all);
    },
    async listByPath(path) {
      const all = await readAll();
      return Object.values(all)
        .filter((g) => g.path === path)
        .sort(byNewestFirst);
    },
    async list() {
      const all = await readAll();
      return Object.values(all).sort(byNewestFirst);
    },
  };
}

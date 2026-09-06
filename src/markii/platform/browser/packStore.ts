/**
 * Phase M3 (worker 2) — persisted pack registry: one JSON file,
 * `/.markii/packs.json`, holding every pack this vault has ever enabled,
 * keyed by namespace, mirroring `grantStore.ts`'s convention EXACTLY (a
 * single file rather than one-per-pack, for the same reason: packs are few,
 * small once `webview.js`/`webview.css` are stripped — see `host/packs.ts`'s
 * module doc — and a settings panel wants to list all of them at once
 * anyway). Built over `FileOps` (`fileOps.ts`), not the real lightning-fs
 * client directly, for the same `tests/unit/fsIsolation.test.ts` reason
 * `grantStore.ts` is.
 *
 * `webview.js`/`webview.css` bytes are never stored here — `host/packs.ts`'s
 * `loadPackFromArchiveBytes` already discards them before an `EnabledPack`
 * exists; this module only ever persists what that function returns.
 *
 * ## The API surface worker 3's Packs settings panel builds on
 *
 * - `list(): Promise<EnabledPack[]>` — every pack this vault knows about
 *   (enabled AND disabled), newest-enabled first.
 * - `enable(bytes): Promise<PackEnableResult>` — opens a `.mkp` archive's
 *   raw bytes, validates it, and refuses with a `{ kind: "collision" }`
 *   error if a DIFFERENT record already occupies that namespace (enabled
 *   or disabled) — docs/packs.md: "Installing two packs with the same
 *   namespace is rejected at install time," applied here as "silently
 *   overwriting whatever already claims a namespace is never the default."
 *   `remove(namespace)` first, then `enable`, is the explicit way to
 *   replace/update an already-installed pack — there is no separate
 *   "update" verb, on purpose: one namespace, one explicit lifecycle,
 *   never an implicit last-one-wins overwrite. A validation failure (bad
 *   zip, bad manifest, missing entry) also comes back as
 *   `{ ok: false, error }` — see `PackEnableResult` — and nothing is
 *   written either way.
 * - `disable(namespace): Promise<void>` — flips `enabled` to `false` without
 *   deleting the record, so re-enabling needs no re-upload. A no-op for an
 *   unknown namespace.
 * - `remove(namespace): Promise<void>` — deletes the record outright. A
 *   no-op for an unknown namespace.
 */
import { loadPackFromArchiveBytes, type EnabledPack, type PackLoadFailure } from "../../host/packs";
import { readJsonFile, writeJsonFile, removeFileIfExists, type FileOps } from "./fileOps";
import { packsFsPath } from "./paths";

type PackFile = Record<string, EnabledPack>;

export type PackEnableResult =
  | { ok: true; pack: EnabledPack }
  | { ok: false; error: PackLoadFailure }
  | { ok: false; error: { kind: "collision"; namespace: string; message: string } };

export interface PackStore {
  list(): Promise<EnabledPack[]>;
  enable(bytes: Uint8Array): Promise<PackEnableResult>;
  disable(namespace: string): Promise<void>;
  /** Re-enables a previously `disable`d namespace with no re-upload needed. A no-op for an unknown namespace (worker 3: re-enabling an unknown pack should offer re-uploading instead). */
  reenable(namespace: string): Promise<void>;
  remove(namespace: string): Promise<void>;
}

function byNewestFirst(a: EnabledPack, b: EnabledPack): number {
  return b.enabledAt - a.enabledAt;
}

/** Builds a `PackStore` backed by `/.markii/packs.json`, read/written through `ops`. */
export function createPackStoreOver(ops: FileOps): PackStore {
  async function readAll(): Promise<PackFile> {
    return (await readJsonFile<PackFile>(ops, packsFsPath())) ?? {};
  }

  async function writeAll(packs: PackFile): Promise<void> {
    if (Object.keys(packs).length === 0) {
      await removeFileIfExists(ops, packsFsPath());
      return;
    }
    await writeJsonFile(ops, packsFsPath(), packs);
  }

  return {
    async list() {
      const all = await readAll();
      return Object.values(all).sort(byNewestFirst);
    },

    async enable(bytes) {
      const loaded = await loadPackFromArchiveBytes(bytes);
      if (!loaded.ok) return { ok: false, error: loaded.error };

      const all = await readAll();
      if (loaded.pack.namespace in all) {
        return {
          ok: false,
          error: {
            kind: "collision",
            namespace: loaded.pack.namespace,
            message: `a pack named "${loaded.pack.namespace}" is already installed; remove it first to replace it`,
          },
        };
      }

      all[loaded.pack.namespace] = loaded.pack;
      await writeAll(all);
      return { ok: true, pack: loaded.pack };
    },

    async disable(namespace) {
      const all = await readAll();
      const existing = all[namespace];
      if (!existing) return;
      all[namespace] = { ...existing, enabled: false };
      await writeAll(all);
    },

    async reenable(namespace) {
      const all = await readAll();
      const existing = all[namespace];
      if (!existing) return;
      all[namespace] = { ...existing, enabled: true };
      await writeAll(all);
    },

    async remove(namespace) {
      const all = await readAll();
      if (!(namespace in all)) return;
      delete all[namespace];
      await writeAll(all);
    },
  };
}

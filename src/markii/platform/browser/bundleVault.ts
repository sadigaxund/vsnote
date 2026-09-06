/**
 * Phase M3 (worker 2) — opens/persists a `.mkz` bundle's raw bytes against
 * the SAME shared lightning-fs vault every other file in this app lives on
 * (`src/fs/client.ts`/`operations.ts`), following `lightningFsOps.ts`'s
 * precedent: this is the ONE file under `platform/browser/` that reaches
 * `src/fs/*` for bundle bytes, so `tests/unit/fsIsolation.test.ts`'s ratchet
 * (no new unit test may transitively import `src/fs/client.ts`) is never at
 * risk from a bundle test — every bundle test exercises `host/bundle.ts`
 * (pure) against a `createMemoryBundleStorage()`/`createDefaultManifest()`
 * pair instead of a real vault file.
 *
 * ## `.mkz`, not `.mkbundle`
 *
 * `@markii/bundle`'s own README: "Bundle (`.mkz`) storage... The legacy
 * `.mkbundle` extension is still recognized for one more release; new
 * bundles are always written as `.mkz`." CLAUDE.md's "no backwards-
 * compatibility code" rule means this app never reads or writes
 * `.mkbundle` at all — `.mkz` is the only extension this module, or
 * anything built on it, ever produces or expects.
 *
 * ## Why the WHOLE bundle is read into memory, never streamed
 *
 * `@markii/bundle`'s zip form (`openZipBundle`/`exportZipBundle`) is a
 * `fflate`-backed, in-memory `BundleStorage` — there is no streaming zip
 * form in this package. A `.mkz`'s realistic size (a note's own scripts and
 * small assets, spec §11) makes "read the whole file, hold it as a
 * `Map` in memory for the life of one editor session" the right trade,
 * matching how `@markii/bundle`'s own zip-bomb guards
 * (`DEFAULT_MAX_ZIP_ENTRY_BYTES`/`DEFAULT_MAX_ZIP_TOTAL_BYTES`, 256MB each)
 * already bound the cost.
 */
import { readBinaryFile, writeFile } from "../../../fs/operations";
import {
  createDefaultManifest,
  exportZipBundle,
  openZipBundle,
  parseManifest,
  type BundleManifest,
  type BundleStorage,
} from "@markii/bundle";

/** A note's opened `.mkz` bundle: its in-memory zip storage plus its parsed manifest — exactly the shape `host/capabilities.ts`'s `CapabilityInputs.bundle` and `host/runScripts.ts`'s `RunScriptsDeps.bundle` want. */
export interface OpenedBundle {
  storage: BundleStorage;
  manifest: BundleManifest;
}

/** The bundle-relative path `manifest.json` conventionally lives at (spec §9). */
const MANIFEST_PATH = "manifest.json";

/**
 * Opens a `.mkz`'s raw bytes into an `OpenedBundle`. Never throws for a
 * missing or unparseable `manifest.json` inside an otherwise-valid zip: a
 * bundle with no manifest, or a corrupt one, opens with
 * `createDefaultManifest()` (no permissions granted, no packs declared) —
 * "an untrusted/no-grant note must still render fully" (spec §10) extends
 * naturally to "a bundle with a broken manifest still opens, with zero
 * capabilities, rather than refusing to open at all." DOES throw
 * `BundleZipError`/`BundlePathError` for a genuinely hostile or corrupt zip
 * (zip-slip, a decompression bomb, a CRC mismatch, a colliding entry) —
 * `openZipBundle`'s own contract — since there is no safe partial reading
 * of a zip whose central directory itself failed a security check.
 */
export async function openBundleFromBytes(bytes: Uint8Array): Promise<OpenedBundle> {
  const storage = openZipBundle(bytes);
  const manifestBytes = await storage.read(MANIFEST_PATH);
  if (manifestBytes === undefined) return { storage, manifest: createDefaultManifest() };

  const manifestJson = new TextDecoder().decode(manifestBytes);
  const parsed = parseManifest(manifestJson);
  return { storage, manifest: parsed.ok ? parsed.manifest : createDefaultManifest() };
}

/** Reads a `.mkz` file at `fsPath` (an absolute lightning-fs path, e.g. `/vault/notes/example.mkz`) and opens it. `undefined` if no such file exists — never throws for a missing file, matching this app's other "absent means nothing to show yet" conventions. */
export async function loadBundleFromVault(fsPath: string): Promise<OpenedBundle | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await readBinaryFile(fsPath);
  } catch {
    return undefined;
  }
  return openBundleFromBytes(bytes);
}

/** Serializes `storage` back to `.mkz` zip bytes and writes it to `fsPath`, through the same `writeFile` every other vault write uses (forced `pfs.flush()`, read-cache invalidation — see `fs/operations.ts`). */
export async function saveBundleToVault(fsPath: string, storage: BundleStorage): Promise<void> {
  const bytes = await exportZipBundle(storage);
  await writeFile(fsPath, bytes);
}

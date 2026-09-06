/**
 * Phase M3 — the browser platform adapter's public surface: concrete Port
 * implementations for `src/markii/host/types.ts`, built on this app's
 * existing lightning-fs vault (`src/fs/*`) and `window.fetch`/`Worker`.
 *
 * The `*Over(ops, ...)` factories/functions from `valuePersistence.ts`/
 * `grantStore.ts` are also re-exported for anyone (a future platform, a
 * test) that wants to supply its own `FileOps` — see `fileOps.ts`'s doc
 * comment for why the real-fs wiring (`lightningFsOps.ts`) is kept
 * separate.
 */
import { lightningFsOps } from "./lightningFsOps";
import { createGrantStoreOver } from "./grantStore";
import {
  clearPersistedValuesOver,
  loadPersistedValuesOver,
  savePersistedValuesOver,
} from "./valuePersistence";
import type { GrantStore } from "../../host/types";
import type { StoredValue } from "@markii/runtime";

export { createBrowserScriptIsolate, type BrowserScriptIsolateOptions } from "./scriptIsolate";
export { createBrowserNetProvider } from "./netProvider";
export { valueFsPath, valuesDir, grantsFsPath } from "./paths";
export { createGrantStoreOver } from "./grantStore";
export {
  loadPersistedValuesOver,
  savePersistedValuesOver,
  clearPersistedValuesOver,
  markiiValuesDir,
} from "./valuePersistence";
export type { FileOps } from "./fileOps";
export { lightningFsOps } from "./lightningFsOps";

/** The real, app-facing `GrantStore`, backed by the shared lightning-fs vault. */
export function createBrowserGrantStore(): GrantStore {
  return createGrantStoreOver(lightningFsOps);
}

/** The real, app-facing per-note value persistence, backed by the shared lightning-fs vault. */
export function loadPersistedValues(displayPath: string): Promise<Record<string, StoredValue> | undefined> {
  return loadPersistedValuesOver(lightningFsOps, displayPath);
}
export function savePersistedValues(displayPath: string, values: Record<string, StoredValue>): Promise<void> {
  return savePersistedValuesOver(lightningFsOps, displayPath, values);
}
export function clearPersistedValues(displayPath: string): Promise<void> {
  return clearPersistedValuesOver(lightningFsOps, displayPath);
}

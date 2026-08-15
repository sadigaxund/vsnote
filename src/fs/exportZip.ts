/**
 * "Export vault as .zip" (IMPLEMENTATION-PLAN.md Phase 5 durability bullet):
 * a one-click, fully client-side backup of the real vault contents — read
 * straight off the lightning-fs-backed filesystem `fs/operations.ts`
 * already exposes, zipped with `fflate` and downloaded via a Blob URL, no
 * server round-trip of any kind (CLAUDE.md rule 3).
 *
 * `fflate` is dynamically imported inside `exportVaultZip()`, not at module
 * top level, so it never enters the cold-boot bundle — this command is a
 * command-palette action a session may never invoke (same reasoning
 * `App.tsx` already applies to `CommandPaletteHost`/`SettingsDialog`/
 * `SearchPanel` via `React.lazy`; this is the non-component equivalent for
 * a plain library import).
 */
import { pfs } from "./client";
import { readTree, type RawTreeNode } from "./operations";
import { fsToDisplayPath, VAULT_DIR } from "./paths";

async function collectVaultFiles(): Promise<Record<string, Uint8Array>> {
  const tree = await readTree(VAULT_DIR);
  const files: Record<string, Uint8Array> = {};

  async function walk(nodes: RawTreeNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.type === "file") {
        const data = (await pfs.readFile(node.path)) as Uint8Array;
        // Zip entries keyed by display path ("vault/notes/architecture.md")
        // so the extracted archive's root folder is literally "vault/",
        // matching what the app itself calls the workspace.
        files[fsToDisplayPath(node.path)] = data;
      } else if (node.children) {
        await walk(node.children);
      }
    }
  }

  await walk(tree);
  return files;
}

export interface VaultZipResult {
  blob: Blob;
  fileCount: number;
}

export async function exportVaultZip(): Promise<VaultZipResult> {
  const files = await collectVaultFiles();
  const { zipSync } = await import("fflate");
  const zipped = zipSync(files, { level: 6 });
  // `zipped.buffer` may be a larger, reused ArrayBuffer than `zipped` itself
  // (Node/browser typed-array pooling) — slice to the exact byte range so
  // the Blob is exactly the zip, not the zip plus trailing garbage bytes.
  const exact = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  return { blob: new Blob([exact], { type: "application/zip" }), fileCount: Object.keys(files).length };
}

/** Triggers a browser download of `blob` named `filename` via a throwaway
 * anchor + object URL — the standard client-only download mechanism (no
 * `<a>` left in the DOM, URL revoked once the download has had time to
 * start). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `vault-slate-2026-08-15T14-30.zip`-style filename — sortable, no
 * characters that need escaping in a downloaded filename. */
export function vaultZipFilename(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  return `slate-vault-${iso}.zip`;
}

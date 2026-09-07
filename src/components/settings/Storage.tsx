/**
 * Settings -> Storage category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4).
 *
 * Storage onboarding (plan §1 item 4): "Restore from remote…" already
 * existed as a hidden command-palette entry (`App.tsx`'s
 * `handleRestoreRemoteConfirmed` / `restoreConfirmOpen`, built on
 * `src/git/restore.ts::restoreFromRemote` — that pipeline is reused
 * verbatim here, not reimplemented). This category now surfaces the SAME
 * flow as a prominent one-click offer at the top of Storage whenever it is
 * actually the right move: the backend is reachable, sync has been set up
 * (`gitSyncSetupComplete`), and the local vault is empty or holds only the
 * non-demo starter seed (`welcome.md` — see `fs/seed.ts::seedWelcomeVault`,
 * the ONLY file a fresh non-demo boot ever writes). Hidden in demo builds
 * exactly like the palette command it wraps (DESIGN-SPEC item 45: the
 * sandbox must never touch a real remote) — `isDemoVaultBuild()` gates both
 * identically.
 */
import { Alert, Badge, Button } from "my-you-eye";
import { SettingsRow } from "../local/SettingsRow";
import { isDemoVaultBuild } from "../../fs/seed";
import { useFsStore } from "../../stores/useFsStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useShareStore } from "../../share/useShareStore";
import type { StoragePersistenceStatus } from "../../fs/persistence";
import type { FileNode } from "../../types";
import type { SettingRow } from "./types";

export interface StorageRowsProps {
  persistence: StoragePersistenceStatus | undefined;
  onExportVault?: () => void;
  onRequestResetVault?: () => void;
  /** Opens the existing "Restore from remote?" confirm dialog (`App.tsx`) —
   * the same one the command palette's "Restore from remote…" entry opens. */
  onRestoreFromRemote?: () => void;
}

/** Stable empty-array reference for the `tree[0]?.children ?? EMPTY_CHILDREN`
 * fallback below — a literal `[]` there would allocate a NEW array on every
 * render, and since `useFsStore` (no `useShallow`) compares snapshots by
 * reference, that would make every render look like a store change to
 * `useSyncExternalStore`, which re-renders in response, which computes a new
 * `[]` again: React error #185 ("Maximum update depth exceeded"), reproduced
 * and fixed while screenshot-reviewing this pass. */
const EMPTY_CHILDREN: FileNode[] = [];

/** True when the vault has nothing worth protecting yet: no files, or only
 * the single `welcome.md` a fresh non-demo boot seeds. */
function isVaultEmptyOrStarterOnly(children: { name: string; type: "file" | "folder" }[]): boolean {
  if (children.length === 0) return true;
  return children.length === 1 && children[0].type === "file" && children[0].name === "welcome.md";
}

export function useStorageRows({ persistence, onExportVault, onRequestResetVault, onRestoreFromRemote }: StorageRowsProps): SettingRow[] {
  const reachability = useShareStore((s) => s.reachability);
  const gitSyncSetupComplete = useSettingsStore((s) => s.gitSyncSetupComplete);
  const rootChildren = useFsStore((s) => s.tree[0]?.children ?? EMPTY_CHILDREN);

  const showRestoreOffer =
    !isDemoVaultBuild() && reachability === "online" && gitSyncSetupComplete && isVaultEmptyOrStarterOnly(rootChildren);

  const rows: SettingRow[] = [];

  if (showRestoreOffer) {
    rows.push({
      id: "restore-from-remote-offer",
      label: "Restore from remote",
      keywords: "restore remote clone empty vault durable storage onboarding pull",
      content: (
        <SettingsRow label="Restore from remote" controlWidth="full">
          <Alert variant="note" size="sm" data-testid="storage-restore-offer">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="settings-hint" style={{ color: "var(--color-fg)" }}>
                This vault looks new and sync is set up. Pull everything already saved on the server instead of starting from scratch.
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                style={{ alignSelf: "flex-start" }}
                data-testid="storage-restore-from-remote"
                onClick={() => onRestoreFromRemote?.()}
              >
                Restore from remote
              </Button>
            </div>
          </Alert>
        </SettingsRow>
      ),
    });
  }

  rows.push({
    id: "persistence",
    label: "Persistence status",
    keywords: "storage persist indexeddb quota durability",
    content: (
      <SettingsRow label="Persistence status" hint="Whether the browser has granted this vault a persistent IndexedDB bucket." controlWidth="text">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-control-gap)" }}>
          {persistence === undefined ? (
            <span className="settings-hint" style={{ color: "var(--color-muted)" }}>Checking…</span>
          ) : (
            <Badge variant={persistence === "granted" ? "success" : persistence === "denied" ? "warning" : "neutral"} tone="soft">
              {persistence === "granted" ? "Persistent storage granted" : persistence === "denied" ? "Storage not persisted" : "Unsupported in this browser"}
            </Badge>
          )}
          {persistence === "denied" && (
            <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0 }}>
              The browser may evict this vault under disk pressure. Export a .zip backup regularly, or grant persistence when the browser asks.
            </p>
          )}
        </div>
      </SettingsRow>
    ),
  });

  rows.push({
    id: "export",
    label: "Export vault as .zip",
    keywords: "export download zip backup archive",
    content: (
      <SettingsRow label="Export vault" hint="Downloads every file in the vault, zipped, client-side." controlWidth="text">
        <Button type="button" variant="secondary" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => onExportVault?.()}>
          Export vault
        </Button>
      </SettingsRow>
    ),
  });

  // Round 6 item 21 — the reset row exists ONLY in demo builds. In a real
  // vault this button was a one-click self-destruct sitting next to
  // Export; non-demo users who truly want a wipe still have the command
  // palette's "Reset vault…" behind its confirm dialog.
  if (isDemoVaultBuild()) {
    rows.push({
      id: "reset",
      label: "Reset demo vault",
      keywords: "reset demo vault wipe restore reseed",
      content: (
        <SettingsRow label="Reset demo vault" hint="Wipes the in-browser filesystem and git history, then re-seeds the demo vault. Cannot be undone." controlWidth="text">
          <Button type="button" variant="danger" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => onRequestResetVault?.()}>
            Reset demo vault
          </Button>
        </SettingsRow>
      ),
    });
  }

  return rows;
}

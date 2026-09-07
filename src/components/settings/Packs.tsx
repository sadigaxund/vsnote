/**
 * Settings -> Packs category (Phase M3, worker 3, docs/PLAN-2026-09-05-
 * refresh.md §6). Two things live here:
 *
 * 1. Installed packs (`.mkp` archives, `useMarkiiStore`'s `packs`) — enable
 *    a new one from a file picker, disable/re-enable/remove an existing
 *    one, with a real reason surfaced for a collision or a load failure
 *    (`PackEnableResult`'s `error.kind`, via `packsLogic.ts`'s
 *    `describePackLoadFailure`), never a generic "failed."
 * 2. Per-note grants (`GrantStore.list()`, `useMarkiiStore`'s `grants`) —
 *    every grant this vault holds, grouped by the note path it was made
 *    for, with a revoke action per grant.
 *
 * A THIRD row — a "run scripts automatically" trigger preference — was
 * built and then removed in review: nothing in this app ever calls
 * `runScripts` with a non-manual trigger, so the switch changed no
 * behavior. See `useMarkiiStore.ts`'s module doc and
 * `docs/ARCHITECTURE.md`'s Phase M3 worker-3 section for the explicit
 * "not implemented yet" record — `runScripts.ts`'s read-only `auto`/
 * `scheduled` tier enforcement is unaffected and ready for whoever adds a
 * real scheduler.
 *
 * This file only exports `usePacksRows` (a hook) — every row's JSX is
 * built by a plain (lowercase, non-component) render function called from
 * inside that ONE hook, which is what calls every `useMarkiiStore`/
 * `useState`/`useRef` this category needs. Splitting each row into its own
 * exported component (an earlier draft did this) mixes a hook export with
 * component definitions in one file, which trips `react-refresh/only-
 * export-components` — `publishDialogLogic.ts`'s split already established
 * the fix this file follows: keep components and non-component logic in
 * separate files, never suppress the rule.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button } from "my-you-eye";
import { Package, RotateCcw, ShieldOff, Trash2, Upload } from "lucide-react";
import { SettingsRow } from "../local/SettingsRow";
import { useMarkiiStore } from "../../stores/useMarkiiStore";
import { describePackLoadFailure } from "./packsLogic";
import type { EnabledPack } from "../../markii/host/packs";
import type { GrantRecord } from "../../markii/host/types";
import type { PackEnableResult } from "../../markii/platform/browser";
import type { SettingRow } from "./types";

function renderInstalledPacksRow(args: {
  packs: EnabledPack[];
  enableError: string | null;
  /** The hidden file `<input>` plus its "Enable pack from file…" trigger,
   * pre-built by `usePacksRows` itself — this function never touches the
   * ref directly (only the hook that OWNS it does), which is what keeps
   * `react-hooks/refs` ("refs should only be read outside of render, an
   * earlier draft passed the `RefObject` itself into this plain render
   * function and got flagged) satisfied without a component split. */
  fileInputControl: ReactNode;
  onDisable: (namespace: string) => void;
  onReenable: (namespace: string) => void;
  onRemove: (namespace: string) => void;
}): ReactNode {
  const { packs, enableError, fileInputControl, onDisable, onReenable, onRemove } = args;
  return (
    <SettingsRow label="Installed packs" hint="Enable a .mkp pack archive to make its directives available in .mk.md notes." controlWidth="full">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {enableError && (
          <Alert variant="danger" size="sm" data-testid="pack-enable-error">
            {enableError}
          </Alert>
        )}
        {packs.length === 0 ? (
          <p className="settings-hint" style={{ color: "var(--color-muted)", margin: 0 }}>No packs installed yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-control-gap)" }}>
            {packs.map((pack) => (
              <div
                key={pack.namespace}
                data-testid={`pack-row-${pack.namespace}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--app-chrome-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Package size={14} aria-hidden />
                  <span className="settings-hint" style={{ fontFamily: "var(--font-mono)" }}>{pack.namespace}</span>
                  {pack.manifest.version && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>v{pack.manifest.version}</span>}
                  <Badge variant={pack.enabled ? "success" : "neutral"} tone="soft">
                    {pack.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {pack.enabled ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onDisable(pack.namespace)} data-testid={`pack-disable-${pack.namespace}`}>
                      <ShieldOff size={13} aria-hidden />
                      Disable
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onReenable(pack.namespace)} data-testid={`pack-enable-${pack.namespace}`}>
                      <RotateCcw size={13} aria-hidden />
                      Enable
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(pack.namespace)} data-testid={`pack-remove-${pack.namespace}`}>
                    <Trash2 size={13} aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {fileInputControl}
      </div>
    </SettingsRow>
  );
}

function renderGrantsRow(args: { grants: GrantRecord[]; onRevoke: (key: string) => void }): ReactNode {
  const { grants, onRevoke } = args;
  return (
    <SettingsRow label="Script permissions" hint="Every grant this vault has recorded, per note. Revoking one asks again next time that note runs." controlWidth="full">
      {grants.length === 0 ? (
        <p className="settings-hint" style={{ color: "var(--color-muted)", margin: 0 }}>No scripts have been granted permissions yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-control-gap)" }} data-testid="markii-grants-list">
          {grants.map((grant) => (
            <div
              key={grant.key}
              data-testid={`grant-row-${grant.key}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--app-chrome-border)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="settings-hint" style={{ fontFamily: "var(--font-mono)" }}>{grant.path}</span>
                <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                  {grant.permissions.net.get.length > 0 && `read: ${grant.permissions.net.get.join(", ")} `}
                  {grant.permissions.net.post.length > 0 && `send: ${grant.permissions.net.post.join(", ")} `}
                  {grant.permissions.bundleWrite && "bundle write "}
                  {grant.permissions.net.get.length === 0 && grant.permissions.net.post.length === 0 && !grant.permissions.bundleWrite && "no network or bundle access"}
                </span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onRevoke(grant.key)} data-testid={`grant-revoke-${grant.key}`}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingsRow>
  );
}

export function usePacksRows(): SettingRow[] {
  const packs = useMarkiiStore((s) => s.packs);
  const packsLoaded = useMarkiiStore((s) => s.packsLoaded);
  const refreshPacks = useMarkiiStore((s) => s.refreshPacks);
  const enablePack = useMarkiiStore((s) => s.enablePack);
  const disablePack = useMarkiiStore((s) => s.disablePack);
  const reenablePack = useMarkiiStore((s) => s.reenablePack);
  const removePack = useMarkiiStore((s) => s.removePack);
  const grants = useMarkiiStore((s) => s.grants);
  const grantsLoaded = useMarkiiStore((s) => s.grantsLoaded);
  const refreshGrants = useMarkiiStore((s) => s.refreshGrants);
  const revokeGrant = useMarkiiStore((s) => s.revokeGrant);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [enableError, setEnableError] = useState<string | null>(null);

  useEffect(() => {
    if (!packsLoaded) void refreshPacks();
  }, [packsLoaded, refreshPacks]);
  useEffect(() => {
    if (!grantsLoaded) void refreshGrants();
  }, [grantsLoaded, refreshGrants]);

  function handleFileChosen(file: File): void {
    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result: PackEnableResult = await enablePack(bytes);
      setEnableError(result.ok ? null : describePackLoadFailure(result.error));
    })();
  }

  // Built HERE (not inside `renderInstalledPacksRow`) — this hook is the
  // only place that owns `inputRef`, so it's the only place allowed to
  // read `.current` (in the button's `onClick`, an event handler, never
  // during render itself).
  const fileInputControl = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".mkp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFileChosen(file);
        }}
      />
      <Button type="button" variant="secondary" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => inputRef.current?.click()} data-testid="pack-enable-from-file">
        <Upload size={13} aria-hidden />
        Enable pack from file…
      </Button>
    </>
  );

  return [
    {
      id: "markii-packs-installed",
      label: "Installed packs",
      keywords: "markii pack mkp install enable disable remove component",
      content: renderInstalledPacksRow({
        packs,
        enableError,
        fileInputControl,
        onDisable: (ns) => void disablePack(ns),
        onReenable: (ns) => void reenablePack(ns),
        onRemove: (ns) => void removePack(ns),
      }),
    },
    {
      id: "markii-grants",
      label: "Script permissions",
      keywords: "markii grant permission revoke script net bundle write capability",
      content: renderGrantsRow({ grants, onRevoke: (key) => void revokeGrant(key) }),
    },
  ];
}

/**
 * EditorArea — the whole editor-group region (right of the sidebar, below
 * the title bar). Phase 6 replacement for what used to be a single inline
 * block in `App.tsx` (one tab bar + one header + one content view): now
 * renders the pane tree via the local `PaneGroup` (recursive resizable
 * grid), one `EditorPane` per leaf.
 *
 * Zen mode (DESIGN-SPEC Amendments item 4) renders a single `EditorPane`
 * for the FOCUSED pane instead of the tree — decided here per the Phase 6
 * brief's "decide and document how [zen] behaves with multiple panes":
 * zen shows only the one pane you were working in, full-bleed, exactly like
 * pre-Phase-6 single-pane zen; the other panes and the split grid itself
 * reappear on exit. The floating "filename · Esc to exit" pill lives in
 * `EditorPane` (it already knows that pane's active tab name).
 *
 * `multiPane` (DESIGN-SPEC Amendments round 3 item 18): computed here, once,
 * from `collectLeaves(tree).length > 1` and passed to every `EditorPane` —
 * the single source of truth for "does each pane get its own slim header,
 * or does the title bar carry it for the lone focused pane instead" (see
 * `EditorPane.tsx`'s module doc). `onEnterZen` no longer flows through this
 * component at all — DESIGN-SPEC Amendments round 3 item 18 moved the zen
 * button itself into the title bar (`App.tsx` calls `enterZenMode`
 * directly, not via any pane), so there's nothing left here to forward it
 * to.
 */
import { useState } from "react";
import { PaneGroup } from "./local/PaneGroup";
import { EditorPane } from "./EditorPane";
import { collectLeaves, useTabsStore } from "../stores/useTabsStore";
import type { StoragePersistenceStatus } from "../fs/persistence";

export interface EditorAreaProps {
  zenMode: boolean;
  onExitZen: () => void;
  onOpenLink: (paneId: string, href: string) => void;
  /** Threaded down to the Settings view (Phase 6.5c, DESIGN-SPEC Amendments
   * item 11's "Storage"/"Storage" category) — same three values `App.tsx`
   * already owns for the status bar's storage warning and the command
   * palette's export/reset actions, just also reachable from wherever the
   * Settings tab happens to be mounted. */
  storagePersistence?: StoragePersistenceStatus;
  onExportVault: () => void;
  onRequestResetVault: () => void;
}

// DESIGN-SPEC Amendments item 16: cursor position no longer flows through
// props here — `EditorPane` writes directly to `stores/useCursorStore.ts`.
// See that store's module doc for why (lifting it into App.tsx's state was
// the main cause of the typing-latency bug).
export function EditorArea({
  zenMode,
  onExitZen,
  onOpenLink,
  storagePersistence,
  onExportVault,
  onRequestResetVault,
}: EditorAreaProps) {
  const tree = useTabsStore((s) => s.tree);
  const activePaneId = useTabsStore((s) => s.activePaneId);
  const resizeBranch = useTabsStore((s) => s.resizeBranch);
  const equalizeBranch = useTabsStore((s) => s.equalizeBranch);
  const [zenPillHovered, setZenPillHovered] = useState(false);

  if (zenMode) {
    return (
      <EditorPane
        paneId={activePaneId}
        zen
        multiPane={false}
        zenPillHovered={zenPillHovered}
        onZenHoverChange={setZenPillHovered}
        onExitZen={onExitZen}
        onOpenLink={onOpenLink}
        storagePersistence={storagePersistence}
        onExportVault={onExportVault}
        onRequestResetVault={onRequestResetVault}
      />
    );
  }

  const multiPane = collectLeaves(tree).length > 1;

  return (
    <PaneGroup
      node={tree}
      onResize={resizeBranch}
      onEqualize={equalizeBranch}
      renderLeaf={(leaf) => (
        <EditorPane
          key={leaf.id}
          paneId={leaf.id}
          multiPane={multiPane}
          zenPillHovered={false}
          onZenHoverChange={() => {}}
          onExitZen={onExitZen}
          onOpenLink={onOpenLink}
          storagePersistence={storagePersistence}
          onExportVault={onExportVault}
          onRequestResetVault={onRequestResetVault}
        />
      )}
    />
  );
}

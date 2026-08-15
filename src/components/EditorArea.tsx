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
 */
import { useState } from "react";
import { PaneGroup } from "./local/PaneGroup";
import { EditorPane } from "./EditorPane";
import { useTabsStore } from "../stores/useTabsStore";
import type { StoragePersistenceStatus } from "../fs/persistence";

export interface EditorAreaProps {
  zenMode: boolean;
  onEnterZen: () => void;
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
  onEnterZen,
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
        zenPillHovered={zenPillHovered}
        onZenHoverChange={setZenPillHovered}
        onEnterZen={onEnterZen}
        onExitZen={onExitZen}
        onOpenLink={onOpenLink}
        storagePersistence={storagePersistence}
        onExportVault={onExportVault}
        onRequestResetVault={onRequestResetVault}
      />
    );
  }

  return (
    <PaneGroup
      node={tree}
      onResize={resizeBranch}
      onEqualize={equalizeBranch}
      renderLeaf={(leaf) => (
        <EditorPane
          key={leaf.id}
          paneId={leaf.id}
          zenPillHovered={false}
          onZenHoverChange={() => {}}
          onEnterZen={onEnterZen}
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

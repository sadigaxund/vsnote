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
import type { CursorPos } from "../editor/CodeMirrorEditor";

export interface EditorAreaProps {
  zenMode: boolean;
  onEnterZen: () => void;
  onExitZen: () => void;
  onCursorChange: (paneId: string, pos: CursorPos) => void;
  onOpenLink: (paneId: string, href: string) => void;
}

export function EditorArea({ zenMode, onEnterZen, onExitZen, onCursorChange, onOpenLink }: EditorAreaProps) {
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
        onCursorChange={onCursorChange}
        onOpenLink={onOpenLink}
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
          onCursorChange={onCursorChange}
          onOpenLink={onOpenLink}
        />
      )}
    />
  );
}

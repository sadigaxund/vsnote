/**
 * EditorPane — one pane's worth of chrome (tab strip + editor header +
 * content) and behavior, mounted once per leaf in the Phase 6 pane tree
 * (`stores/useTabsStore.ts`'s `PaneNode`). Everything that was previously a
 * single block of JSX in `App.tsx` bound to "the" active tab now lives here,
 * parameterized by `paneId` — App.tsx renders one of these per leaf (via
 * `EditorArea.tsx` + the local `PaneGroup`) instead of exactly one.
 *
 * Buffer loading and diff fetching (previously `App.tsx` effects keyed off
 * a single global `activeTab`) are now effects HERE, keyed off this pane's
 * own active tab — so two panes showing the same file both call
 * `useBufferStore.ensureLoaded`/`useGitStore.diffFor`, which are already
 * idempotent/cached per path, and both read the SAME buffer entry. That's
 * the mechanism behind "two panes, one file, edits in one appear in the
 * other": neither pane owns a private copy of the content.
 *
 * Also owns the Phase 6 drag-to-dock drop zone for this pane's content area
 * (DESIGN-SPEC Amendments item 8: "a live drop-zone preview highlights
 * exactly where the new pane will land") — `computeEdge` divides the pane
 * into a 25%-margin cross (left/right/top/bottom edge vs. a center 50%
 * "merge into this pane's tabs" zone), and `local/PaneGroup`'s
 * `DockOverlay` renders the live highlight while dragging.
 *
 * `zen` (DESIGN-SPEC Amendments item 4, multi-pane behavior decided here):
 * zen mode shows ONLY the focused pane, with its own tab bar/header hidden
 * too (same "just the content" as the pre-Phase-6 single-pane zen) — see
 * `EditorArea.tsx`, which renders a lone `<EditorPane zen .../>` for the
 * focused pane instead of the full `PaneGroup` tree while zen is active.
 */
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AppTabBar } from "./TabBar";
import { EditorHeader } from "./EditorHeader";
import { EditorContent } from "./EditorContent";
import { DockOverlay } from "./local/PaneGroup";
import type { TabDragPayload } from "./local/EditorTabBar";
import { findLeaf, useTabsStore } from "../stores/useTabsStore";
import { useBufferStore } from "../stores/useBufferStore";
import { useCursorStore } from "../stores/useCursorStore";
import { useGitStore } from "../stores/useGitStore";
import { EMPTY_DIFF } from "../git/diff";
import { modeAvailabilityFor } from "../filetypes/registry";
import { probeRender } from "../lib/renderProbe";
import type { DiffLayout, DockEdge, EditorMode, TabItem } from "../types";

export interface EditorPaneProps {
  paneId: string;
  /** Zen mode: hides this pane's own tab bar + header and shows the
   * floating exit pill instead (see module doc). */
  zen?: boolean;
  onEnterZen: () => void;
  onExitZen: () => void;
  zenPillHovered: boolean;
  onZenHoverChange: (hovered: boolean) => void;
  onOpenLink: (paneId: string, href: string) => void;
}

function computeEdge(e: React.DragEvent): DockEdge {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  const MARGIN = 0.25;
  if (x < MARGIN) return "left";
  if (x > 1 - MARGIN) return "right";
  if (y < MARGIN) return "top";
  if (y > 1 - MARGIN) return "bottom";
  return "center";
}

export function EditorPane({ paneId, zen, onEnterZen, onExitZen, zenPillHovered, onZenHoverChange, onOpenLink }: EditorPaneProps) {
  // DESIGN-SPEC Amendments item 16 (typing-latency bug) instrumentation —
  // see `lib/renderProbe.ts`'s doc.
  probeRender(`EditorPane:${paneId}`);

  const leaf = useTabsStore((s) => findLeaf(s.tree, paneId));
  const isFocused = useTabsStore((s) => s.activePaneId === paneId);
  const focusPane = useTabsStore((s) => s.focusPane);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setMode = useTabsStore((s) => s.setMode);
  const dockTab = useTabsStore((s) => s.dockTab);
  // Narrow, shallow-compared selector — DESIGN-SPEC Amendments item 16: the
  // previous `useBufferStore((s) => s.buffers)` subscribed to the ENTIRE
  // buffer map, so every pane's `EditorPane` re-rendered on every keystroke
  // typed into ANY open buffer (even one from a totally different pane),
  // just to read this pane's own tabs' `dirty` flags for the tab bar. Only
  // the {path: dirty} pairs for THIS pane's own tabs are read below, and
  // `useShallow` skips the re-render entirely once a buffer settles into
  // "dirty" (which happens on the FIRST keystroke and then never changes
  // again while typing continues) instead of re-rendering on every
  // subsequent one.
  const dirtyByPath = useBufferStore(
    useShallow((s) => Object.fromEntries((leaf?.tabs ?? []).map((t) => [t.path, s.buffers[t.path]?.dirty ?? false]))),
  );
  const statuses = useGitStore((s) => s.statuses);

  const activeTab = useMemo(() => leaf?.tabs.find((t) => t.path === leaf.activeTabId), [leaf]);

  // Cursor position is written straight to `useCursorStore` (a targeted,
  // per-pane subscription the status bar reads directly — see that store's
  // module doc) instead of bubbling up through a prop into `App.tsx`'s own
  // React state, which used to re-render the entire shell on every
  // keystroke, including in Rendered mode where the value isn't even
  // displayed.
  const handleCursorChange = (pos: { line: number; column: number }) => useCursorStore.getState().setCursor(paneId, pos);

  // These two effects are moved verbatim from pre-Phase-6 App.tsx (they used
  // to run once, globally, for the single active tab; now each EditorPane
  // runs them for its own pane's active tab against the same shared
  // useBufferStore/useGitStore caches). Deliberately scoped to `.path` (not
  // the whole `activeTab` object, which also carries `mode`/`preview`/etc.
  // that shouldn't re-trigger a fetch) — two of the three
  // `react-hooks/exhaustive-deps` warnings this codebase already accepted in
  // App.tsx before this phase, now here instead.
  useEffect(() => {
    if (activeTab) void useBufferStore.getState().ensureLoaded(activeTab.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path]);

  const gitRefreshGeneration = useGitStore((s) => s.refreshGeneration);
  // Depends on `refreshGeneration`, not just the path: a git refresh
  // triggered by an unrelated file op clears the whole diff cache, and the
  // active tab's path doesn't change in that case, so the path alone
  // wouldn't re-trigger this fetch and the chip would go stale/blank until
  // the user switched tabs and back.
  useEffect(() => {
    if (activeTab) void useGitStore.getState().diffFor(activeTab.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path, gitRefreshGeneration]);

  const activeDiff = useGitStore((s) => (activeTab ? (s.diffCache[activeTab.path] ?? EMPTY_DIFF) : EMPTY_DIFF));
  const activeBuffer = useBufferStore((s) => (activeTab ? s.buffers[activeTab.path] : undefined));

  const [dockPreview, setDockPreview] = useState<DockEdge | null>(null);
  // DESIGN-SPEC Amendments item 13: unified/split is a per-pane view
  // preference, not a per-tab one — deliberately not reset on `activeTab`
  // changes, so flipping between several diffs in the same pane keeps
  // whichever layout was last picked (previously `editor/DiffView.tsx`'s
  // own internal state reset to "split" on every file switch since that
  // component remounted per `path`; this is a small, intentional behavior
  // change alongside lifting the control up into `EditorHeader`).
  const [diffLayout, setDiffLayout] = useState<DiffLayout>("split");

  if (!leaf) return null;

  const tabItems: TabItem[] = leaf.tabs.map((t) => ({
    id: t.path,
    name: t.name,
    path: t.path,
    kind: t.kind,
    dirty: dirtyByPath[t.path] ?? false,
    preview: t.preview,
    status: statuses[t.path],
  }));

  const availableModes = modeAvailabilityFor(activeTab?.kind, activeDiff.added > 0 || activeDiff.removed > 0);

  function handleDropExternalTab(payload: TabDragPayload) {
    dockTab({ sourcePaneId: payload.paneId, targetPaneId: paneId, edge: "center", path: payload.path, name: payload.name, kind: payload.kind });
    focusPane(paneId);
  }

  function handleSplitTab(path: string, edge: Exclude<DockEdge, "center">) {
    const tab = leaf!.tabs.find((t) => t.path === path);
    if (!tab) return;
    dockTab({ sourcePaneId: paneId, targetPaneId: paneId, edge, path: tab.path, name: tab.name, kind: tab.kind });
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("application/x-slate-tab")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDockPreview(computeEdge(e));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDockPreview(null);
    const raw = e.dataTransfer.getData("application/x-slate-tab");
    if (!raw) return;
    let payload: TabDragPayload;
    try {
      payload = JSON.parse(raw) as TabDragPayload;
    } catch {
      return;
    }
    dockTab({ sourcePaneId: payload.paneId, targetPaneId: paneId, edge: computeEdge(e), path: payload.path, name: payload.name, kind: payload.kind });
    focusPane(paneId);
  }

  return (
    <div
      data-testid="editor-pane"
      data-pane-id={paneId}
      data-pane-focused={isFocused}
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, position: "relative", background: "var(--app-editor-bg)" }}
      onMouseDownCapture={() => {
        if (!isFocused) focusPane(paneId);
      }}
      onMouseEnter={() => zen && onZenHoverChange(true)}
      onMouseLeave={() => zen && onZenHoverChange(false)}
    >
      {!zen && (
        <>
          <AppTabBar
            paneId={paneId}
            tabs={tabItems}
            activeId={activeTab?.path}
            onSelect={(path) => setActiveTab(path, paneId)}
            onClose={(path) => closeTab(path, paneId)}
            onDropExternalTab={handleDropExternalTab}
            onSplitTab={handleSplitTab}
          />
          <EditorHeader
            breadcrumb={activeTab ? activeTab.path.split("/") : ["vault"]}
            diff={activeDiff}
            mode={activeTab?.mode ?? "source"}
            onModeChange={(mode: EditorMode) => activeTab && setMode(activeTab.path, mode, paneId)}
            availableModes={availableModes}
            diffLayout={diffLayout}
            onDiffLayoutChange={setDiffLayout}
            onEnterZen={() => {
              focusPane(paneId);
              onEnterZen();
            }}
          />
        </>
      )}
      <div
        data-pane-content={paneId}
        style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDockPreview(null)}
        onDrop={handleDrop}
      >
        <EditorContent
          paneId={paneId}
          hasTab={!!activeTab}
          path={activeTab?.path}
          kind={activeTab?.kind}
          mode={activeTab?.mode ?? "source"}
          content={activeBuffer?.content ?? ""}
          loaded={activeBuffer?.loaded ?? false}
          missing={activeBuffer?.missing ?? false}
          diff={activeDiff}
          onChange={(value) => {
            if (activeTab) useBufferStore.getState().setContent(activeTab.path, value);
          }}
          onCursorChange={handleCursorChange}
          onOpenLink={(href) => onOpenLink(paneId, href)}
          diffLayout={diffLayout}
        />
        {dockPreview && <DockOverlay edge={dockPreview} />}
      </div>

      {zen && (
        <div
          role="status"
          onClick={onExitZen}
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            background: "color-mix(in oklab, var(--app-titlebar-bg) 88%, transparent)",
            border: "1px solid var(--app-chrome-border)",
            color: "var(--color-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            cursor: "pointer",
            opacity: zenPillHovered ? 1 : 0,
            transition: "opacity 150ms ease",
            pointerEvents: zenPillHovered ? "auto" : "none",
          }}
        >
          <span style={{ color: "var(--color-fg)" }}>{activeTab?.name ?? "vault"}</span>
          <span>·</span>
          <span>Esc to exit</span>
        </div>
      )}
    </div>
  );
}

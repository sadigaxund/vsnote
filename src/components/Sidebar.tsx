/**
 * Explorer sidebar panel: header (label + action icons), filter input, file
 * tree. Composition over the library's `Button`/`Input`/`Tooltip`/
 * `ScrollArea`/`ConfirmDialog` plus the local `ExplorerTree`. File
 * operations are callback props (App.tsx owns the actual `useFsStore`
 * calls) — this component stays a pure view over its props, same as
 * Phase 1, so wiring lives in one place.
 */
import { Button, ConfirmDialog, Input, ScrollArea, Tooltip } from "my-you-eye";
import { FilePlus, FolderPlus, ListFilter, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ExplorerTree } from "./local/ExplorerTree";
import { ResizeHandle } from "./local/PaneGroup";
import { filterTree } from "../lib/filterTree";
import { MAX_SIDEBAR_WIDTH_FALLBACK, MIN_SIDEBAR_WIDTH } from "../stores/useSettingsStore";
import type { FileNode } from "../types";

export interface SidebarProps {
  tree: FileNode[];
  selectedId?: string;
  onSelect?: (node: FileNode, opts?: { pin?: boolean }) => void;
  renamingId?: string | null;
  onRenameCommit: (node: FileNode, newName: string) => void;
  onRenameCancel: () => void;
  onRequestRename: (node: FileNode) => void;
  onCreateFile: (parentPath?: string) => void;
  onCreateFolder: (parentPath?: string) => void;
  onConfirmDelete: (node: FileNode) => void;
  onCopyPath: (node: FileNode) => void;
  onMove: (sourcePath: string, newParentPath: string) => void;
  onRefresh: () => void;
  /** Persisted sidebar width (DESIGN-SPEC Amendments item 10) —
   * `useSettingsStore`'s `sidebarWidth`, so it survives a reload the same
   * way every other setting does. */
  width: number;
  onWidthChange: (width: number) => void;
}

export function Sidebar({
  tree,
  selectedId,
  onSelect,
  renamingId,
  onRenameCommit,
  onRenameCancel,
  onRequestRename,
  onCreateFile,
  onCreateFolder,
  onConfirmDelete,
  onCopyPath,
  onMove,
  onRefresh,
  width,
  onWidthChange,
}: SidebarProps) {
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);
  // Snapshot of the width this drag gesture started from — see
  // `local/PaneGroup.tsx`'s `ResizeHandle` doc: `onDrag` receives the
  // CUMULATIVE delta from gesture start, so the clamp math below needs a
  // fixed starting point, not the (changing mid-drag) `width` prop.
  const dragStartWidthRef = useRef(width);

  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  return (
    <div style={{ display: "flex", flexShrink: 0, minHeight: 0 }}>
      <aside
        data-testid="explorer-sidebar"
        style={{
          width,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--app-sidebar-bg)",
          borderRight: "1px solid var(--app-chrome-border)",
          minHeight: 0,
        }}
      >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "var(--app-chrome-sidebar-header-h)",
          padding: "0 12px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--color-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          EXPLORER
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <HeaderIconButton label="New file" icon={<FilePlus size={14} />} onClick={() => onCreateFile()} />
          <HeaderIconButton label="New folder" icon={<FolderPlus size={14} />} onClick={() => onCreateFolder()} />
          <HeaderIconButton label="Refresh explorer" icon={<RefreshCw size={14} />} onClick={onRefresh} />
          <HeaderIconButton label="Filter files" icon={<ListFilter size={14} />} />
        </div>
      </div>

      <div style={{ padding: "0 10px 8px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-muted)",
              pointerEvents: "none",
            }}
          />
          <Input
            size="sm"
            placeholder="Filter files"
            aria-label="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ paddingLeft: 26, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>
      </div>

      <ScrollArea className="flex-1" style={{ minHeight: 0 }}>
        <div style={{ paddingBottom: 12 }}>
          <ExplorerTree
            key={filter ? "filtered" : "full"}
            data={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            expandAll={!!filter}
            renamingId={renamingId}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onRequestRename={onRequestRename}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onDelete={setPendingDelete}
            onCopyPath={onCopyPath}
            onMove={onMove}
          />
        </div>
      </ScrollArea>
      </aside>

      {/* DESIGN-SPEC Amendments item 10: drag the file-tree's right edge to
          resize — reuses `local/PaneGroup.tsx`'s `ResizeHandle` (the same
          drag mechanics/visual affordance as a pane divider) instead of a
          second, hand-rolled drag implementation. */}
      <ResizeHandle
        direction="row"
        title="Drag to resize the explorer"
        aria-label="Resize explorer sidebar"
        data-testid="sidebar-resize-handle"
        onDragStart={() => {
          dragStartWidthRef.current = width;
        }}
        onDrag={(deltaPx) => {
          const maxWidth = typeof window !== "undefined" ? window.innerWidth * 0.5 : MAX_SIDEBAR_WIDTH_FALLBACK;
          const next = Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidthRef.current + deltaPx));
          onWidthChange(next);
        }}
      />

      <ConfirmDialog
        title={pendingDelete ? `Delete "${pendingDelete.name}"?` : "Delete?"}
        description={
          pendingDelete?.type === "folder"
            ? "This deletes the folder and everything inside it. This cannot be undone."
            : "This cannot be undone."
        }
        confirmLabel="Delete"
        destructive
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) onConfirmDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function HeaderIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        style={{ width: 22, height: 22, color: "var(--color-muted)" }}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

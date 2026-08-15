/**
 * Explorer sidebar panel: filter input + file tree, rendered inside the
 * shared `local/SidebarContainer` region shell (width/collapse/resize —
 * see that file's doc for why this moved out of here: Search/Source
 * Control needed the exact same shell, not a frozen 288px copy of their
 * own). Composition over the library's `Button`/`Input`/`Tooltip`/
 * `ScrollArea`/`ConfirmDialog` plus the local `ExplorerTree`/
 * `SidebarContainer`. File operations are callback props (App.tsx owns the
 * actual `useFsStore` calls) — this component stays a pure view over its
 * props, same as Phase 1, so wiring lives in one place.
 */
import { Button, ConfirmDialog, Input, ScrollArea, Tooltip } from "my-you-eye";
import { FilePlus, FolderPlus, ListFilter, RefreshCw, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ExplorerTree } from "./local/ExplorerTree";
import { SidebarContainer } from "./local/SidebarContainer";
import { filterTree } from "../lib/filterTree";
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
  /** Phase 10 (sharing) — Explorer row "Publish…" context menu item
   * (roadmap §1). Omitted (item hidden) rather than a no-op for folders —
   * see `local/ExplorerTree.tsx`'s row menu, which only renders it for
   * files. */
  onPublish?: (node: FileNode) => void;
  /** Persisted sidebar-REGION width (DESIGN-SPEC Amendments item 10, round
   * 3 item 20's course-correction) — `useSettingsStore`'s `sidebarWidth`,
   * shared with Search/Source Control/Extensions now, not Explorer-only. */
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
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
  onPublish,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);

  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  return (
    <>
      <SidebarContainer
        testId="explorer-sidebar"
        label="EXPLORER"
        headerActions={
          <>
            <HeaderIconButton label="New file" icon={<FilePlus size={14} />} onClick={() => onCreateFile()} />
            <HeaderIconButton label="New folder" icon={<FolderPlus size={14} />} onClick={() => onCreateFolder()} />
            <HeaderIconButton label="Refresh explorer" icon={<RefreshCw size={14} />} onClick={onRefresh} />
            <HeaderIconButton label="Filter files" icon={<ListFilter size={14} />} />
          </>
        }
        width={width}
        onWidthChange={onWidthChange}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      >
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
              onPublish={onPublish}
            />
          </div>
        </ScrollArea>
      </SidebarContainer>

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
    </>
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

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
import { useMemo, useState, type ReactNode } from "react";
import { ExplorerTree } from "./local/ExplorerTree";
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
}: SidebarProps) {
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);

  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  return (
    <aside
      style={{
        width: 288,
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
          padding: "10px 12px 8px",
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
    </aside>
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

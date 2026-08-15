/**
 * Explorer sidebar panel: header (label + action icons), filter input, file
 * tree. Composition over the library's `Button`/`Input`/`Tooltip`/
 * `ScrollArea` plus the local `ExplorerTree`.
 */
import { Button, Input, ScrollArea, Tooltip } from "my-you-eye";
import { FilePlus, FolderPlus, ListFilter, RefreshCw, Search } from "lucide-react";
import type { ReactNode } from "react";
import { ExplorerTree } from "./local/ExplorerTree";
import type { FileNode } from "../types";

export interface SidebarProps {
  tree: FileNode[];
  selectedId?: string;
  onSelect?: (node: FileNode) => void;
}

export function Sidebar({ tree, selectedId, onSelect }: SidebarProps) {
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
          <HeaderIconButton label="New file" icon={<FilePlus size={14} />} />
          <HeaderIconButton label="New folder" icon={<FolderPlus size={14} />} />
          <HeaderIconButton label="Refresh explorer" icon={<RefreshCw size={14} />} />
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
            style={{ paddingLeft: 26, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>
      </div>

      <ScrollArea className="flex-1" style={{ minHeight: 0 }}>
        <div style={{ paddingBottom: 12 }}>
          <ExplorerTree data={tree} selectedId={selectedId} onSelect={onSelect} />
        </div>
      </ScrollArea>
    </aside>
  );
}

function HeaderIconButton({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <Tooltip content={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        style={{ width: 22, height: 22, color: "var(--color-muted)" }}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

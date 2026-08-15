/**
 * ExplorerTree — VSCode-style file tree with git status decoration.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("TreeView inline rename + row
 * adornments", status `built-locally`, used in `src/components/Sidebar.tsx`).
 * The library's `TreeView`/`FileTree` were evaluated first (CLAUDE.md rule
 * 1) but can't express what DESIGN-SPEC §3 needs by composition alone:
 *   - `TreeNode.label` is `string`, not `ReactNode` — there is no way to
 *     tint a row's filename by git status (amber/violet/red) or strike
 *     through a deleted file's name.
 *   - "current" (the only row-highlight state) is internal keyboard-focus
 *     state with no `selectedId`/`onSelect` prop — a click on a leaf row
 *     isn't wired to anything, and there's no accent-left-edge affordance.
 *   - No per-row `className`/tone hook at all.
 * This component follows the library's structural + a11y conventions
 * (role="tree"/"treeitem"/"group", aria-expanded/aria-selected, chevron +
 * indent-guide layout) and consumes the same design tokens, so it reads as
 * part of the same system — it isn't a fork of TreeView's source, it's a
 * parallel implementation shaped for the one thing TreeView can't do here.
 */
import { useState, type KeyboardEvent } from "react";
import { FileIcon } from "./FileIcon";
import type { FileNode, GitStatus } from "../../types";

const STATUS_COLOR: Record<GitStatus, string> = {
  M: "var(--git-modified)",
  A: "var(--git-added)",
  D: "var(--git-deleted)",
  U: "var(--git-untracked)",
};

export interface ExplorerTreeProps {
  data: FileNode[];
  selectedId?: string;
  onSelect?: (node: FileNode) => void;
  className?: string;
}

export function ExplorerTree({
  data,
  selectedId,
  onSelect,
  className,
}: ExplorerTreeProps) {
  return (
    <ul role="tree" className={className} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {data.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selectedId?: string;
  onSelect?: (node: FileNode) => void;
}) {
  const isFolder = node.type === "folder";
  const [expanded, setExpanded] = useState(
    isFolder ? !node.collapsed && node.defaultExpanded !== false : false,
  );
  const selected = node.id === selectedId;
  const deleted = node.status === "D";

  const handleActivate = () => {
    if (isFolder) {
      setExpanded((e) => !e);
    } else {
      onSelect?.(node);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <li role={isFolder ? undefined : "none"} style={{ position: "relative" }}>
      <div
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        aria-selected={selected}
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        className="group/row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: 26,
          paddingLeft: 8 + depth * 16,
          paddingRight: 8,
          cursor: "pointer",
          position: "relative",
          borderRadius: "var(--radius-ui-sm)",
          background: selected ? "var(--color-surface-active)" : "transparent",
          outline: "none",
        }}
        onMouseEnter={(e) => {
          if (!selected) e.currentTarget.style.background = "var(--color-surface-hover)";
        }}
        onMouseLeave={(e) => {
          if (!selected) e.currentTarget.style.background = "transparent";
        }}
      >
        {selected && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
              background: "var(--color-primary)",
              borderRadius: "0 2px 2px 0",
            }}
          />
        )}
        {isFolder ? (
          <ChevronGlyph expanded={expanded} />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        <FileIcon kind={node.kind} open={expanded} size={14} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontFamily: "var(--font-sans)",
            color: node.status ? STATUS_COLOR[node.status] : "var(--color-fg)",
            textDecoration: deleted ? "line-through" : undefined,
            fontWeight: 400,
          }}
        >
          {node.name}
        </span>
        {node.status && (
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: STATUS_COLOR[node.status],
              width: 12,
              textAlign: "right",
            }}
          >
            {node.status}
          </span>
        )}
      </div>
      {isFolder && expanded && node.children && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ChevronGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      aria-hidden
      style={{
        flexShrink: 0,
        color: "var(--color-muted)",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 100ms ease",
      }}
    >
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

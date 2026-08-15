/**
 * CheckboxTree — a read-only (no rename/drag/create) file tree with a
 * per-row checkbox, tri-state on folders (checked / unchecked /
 * indeterminate, derived from descendant files, never stored itself).
 * Built for the Publish dialog's folder-share exclusion picker (roadmap
 * §5.1: "the publish dialog shows the subtree as a checkbox tree and the
 * owner excludes entries").
 *
 * Logged in `docs/COMPONENT-BACKLOG.md`. The library's `TreeView` was
 * checked first (CLAUDE.md rule 1) — same gap `ExplorerTree.tsx` already
 * documents (`TreeNode.label` is a bare `string`, no per-row leading
 * control slot at all) plus this component additionally needs tri-state
 * checkbox semantics `TreeView` has no concept of. Rather than fork
 * `ExplorerTree.tsx` (which carries rename/drag-drop/context-menu/git-status
 * machinery this picker never needs), this is a small parallel
 * implementation following the same row layout (chevron, 16px per-depth
 * indent, `FileIcon`) and design tokens, controlled from the outside: this
 * component owns ONLY expand/collapse UI state, never the checked set
 * (roadmap §5.1's "excluded entries are absent from the manifest" is a
 * PublishDialog-level concern — see `share/folderManifest.ts`).
 */
import { useState } from "react";
import { Checkbox } from "my-you-eye";
import { FileIcon } from "./FileIcon";
import type { FileKind } from "../../types";

export interface CheckboxTreeNode {
  /** The file/folder's relpath from the published subtree's root — doubles
   * as this component's row key AND the value `onToggle` reports. */
  id: string;
  name: string;
  type: "file" | "folder";
  kind?: FileKind;
  children?: CheckboxTreeNode[];
}

export interface CheckboxTreeProps {
  data: CheckboxTreeNode[];
  /** relpaths of every currently-INCLUDED node (files; a folder's state is
   * derived, never itself a member of this set). */
  checked: ReadonlySet<string>;
  onToggle: (node: CheckboxTreeNode, nextChecked: boolean) => void;
  className?: string;
}

type TriState = "checked" | "unchecked" | "indeterminate";

function folderState(node: CheckboxTreeNode, checked: ReadonlySet<string>): TriState {
  const files = collectFiles(node);
  if (files.length === 0) return "unchecked";
  const included = files.filter((f) => checked.has(f.id)).length;
  if (included === 0) return "unchecked";
  if (included === files.length) return "checked";
  return "indeterminate";
}

function collectFiles(node: CheckboxTreeNode): CheckboxTreeNode[] {
  if (node.type === "file") return [node];
  return (node.children ?? []).flatMap(collectFiles);
}

export function CheckboxTree({ data, checked, onToggle, className }: CheckboxTreeProps) {
  return (
    <ul role="tree" className={className} style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="checkbox-tree">
      {data.map((node) => (
        <CheckboxTreeRow key={node.id} node={node} depth={0} checked={checked} onToggle={onToggle} />
      ))}
    </ul>
  );
}

function CheckboxTreeRow({
  node,
  depth,
  checked,
  onToggle,
}: {
  node: CheckboxTreeNode;
  depth: number;
  checked: ReadonlySet<string>;
  onToggle: (node: CheckboxTreeNode, nextChecked: boolean) => void;
}) {
  const isFolder = node.type === "folder";
  const [expanded, setExpanded] = useState(true);
  const state: TriState = isFolder ? folderState(node, checked) : checked.has(node.id) ? "checked" : "unchecked";

  return (
    <li role={isFolder ? undefined : "none"}>
      <div
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        data-tree-path={node.id}
        data-checkbox-state={state}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: 26,
          paddingLeft: 4 + depth * 16,
          paddingRight: 4,
          borderRadius: "var(--radius-ui-sm)",
        }}
      >
        {isFolder ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => setExpanded((e) => !e)}
            style={{
              width: 12,
              height: 12,
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-muted)",
            }}
          >
            <svg viewBox="0 0 12 12" width={10} height={10} aria-hidden style={{ transform: expanded ? "rotate(90deg)" : "none" }}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        <Checkbox
          size="sm"
          checked={state === "checked" ? true : state === "indeterminate" ? "indeterminate" : false}
          onCheckedChange={(next) => onToggle(node, next === true)}
          aria-label={`Include ${node.name}`}
          data-testid={`checkbox-tree-toggle-${node.id}`}
        />
        <FileIcon kind={isFolder ? "folder" : (node.kind ?? "unknown")} name={node.name} open={expanded} size={13} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            fontFamily: "var(--font-sans)",
            opacity: state === "unchecked" ? 0.55 : 1,
          }}
        >
          {node.name}
        </span>
      </div>
      {isFolder && expanded && node.children && node.children.length > 0 && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <CheckboxTreeRow key={child.id} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

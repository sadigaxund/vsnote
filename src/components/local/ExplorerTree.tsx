/**
 * ExplorerTree — VSCode-style file tree with git status decoration, inline
 * rename, a right-click context menu, and drag & drop to move files.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("TreeView inline rename + row
 * adornments", status `built-locally`, used in `src/components/Sidebar.tsx`).
 * The library's `TreeView`/`FileTree` were evaluated first (CLAUDE.md rule
 * 1) but can't express what DESIGN-SPEC §3 + Amendments item 7 need by
 * composition alone:
 *   - `TreeNode.label` is `string`, not `ReactNode` — there is no way to
 *     tint a row's filename by git status (amber/violet/red) or strike
 *     through a deleted file's name.
 *   - "current" (the only row-highlight state) is internal keyboard-focus
 *     state with no `selectedId`/`onSelect` prop — a click on a leaf row
 *     isn't wired to anything, and there's no accent-left-edge affordance.
 *   - No per-row `className`/tone hook, no rename-in-place slot, no
 *     `draggable`/drop-target hook at all.
 * This component follows the library's structural + a11y conventions
 * (role="tree"/"treeitem"/"group", aria-expanded/aria-selected, chevron +
 * indent-guide layout) and consumes the same design tokens plus the local
 * `ContextMenu` primitive, so it reads as part of the same system — it
 * isn't a fork of TreeView's source, it's a parallel implementation shaped
 * for what TreeView can't do here.
 *
 * Drag & drop (DESIGN-SPEC Amendments item 7): dropping ONTO a folder row
 * moves the dragged node inside it (the row highlights and, after ~600ms
 * of continuous hover, auto-expands); dropping BETWEEN two rows targets
 * their shared parent folder (shown by a thin insertion line) — for a real
 * git-backed filesystem there is no persistent "position 3 of 7" the way a
 * virtual list has, so "between" and "onto the parent folder" are the same
 * move, just two ways to aim at it. Esc mid-drag cancels (flagged via a
 * ref, checked in `onDrop`, since the browser has already committed to the
 * native drag gesture by then). Dropping a folder into itself or one of
 * its own descendants is refused: the row shows a no-drop cursor and the
 * drop is a no-op rather than silently failing.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Input } from "my-you-eye";
import {
  Copy,
  Crosshair,
  FilePlus,
  FolderPlus,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { FileIcon } from "./FileIcon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu";
import { collectDescendantIds } from "../../stores/useFsStore";
import { STATUS_COLOR } from "../../lib/gitStatusColor";
import type { FileNode } from "../../types";

function parentOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(0, idx);
}

type DropMode = "into" | "before" | "after";
interface DropTarget {
  rowId: string;
  mode: DropMode;
  targetParentPath: string;
  invalid: boolean;
}

export interface ExplorerTreeProps {
  data: FileNode[];
  selectedId?: string;
  onSelect?: (node: FileNode, opts?: { pin?: boolean }) => void;
  /** Forces every folder open — used while a filter query is active so
   * matches nested in collapsed folders (e.g. `assets/`) stay visible. */
  expandAll?: boolean;
  renamingId?: string | null;
  onRenameCommit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRequestRename?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onMove?: (sourcePath: string, newParentPath: string) => void;
  /** Phase 10 (sharing) — file rows only (see the row menu below). */
  onPublish?: (node: FileNode) => void;
  className?: string;
}

export function ExplorerTree({
  data,
  selectedId,
  onSelect,
  expandAll,
  renamingId,
  onRenameCommit,
  onRenameCancel,
  onCreateFile,
  onCreateFolder,
  onRequestRename,
  onDelete,
  onCopyPath,
  onMove,
  onPublish,
  className,
}: ExplorerTreeProps) {
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [autoExpandPath, setAutoExpandPath] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const invalidTargets = useMemo(
    () => (dragPath ? collectDescendantIds(data, dragPath) : new Set<string>()),
    [data, dragPath],
  );

  useEffect(() => {
    if (!dragPath) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        cancelledRef.current = true;
        setDropTarget(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragPath]);

  useEffect(() => {
    if (!dropTarget || dropTarget.mode !== "into" || dropTarget.invalid) return;
    const id = dropTarget.rowId;
    const timer = setTimeout(() => setAutoExpandPath(id), 600);
    return () => clearTimeout(timer);
  }, [dropTarget]);

  function resetDrag() {
    setDragPath(null);
    setDropTarget(null);
    setAutoExpandPath(null);
  }

  function handleDragStart(node: FileNode) {
    cancelledRef.current = false;
    setDragPath(node.id);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, node: FileNode, isFolder: boolean) {
    if (!dragPath || dragPath === node.id) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    let mode: DropMode;
    if (isFolder && ratio > 0.25 && ratio < 0.75) {
      mode = "into";
    } else {
      mode = ratio <= 0.5 ? "before" : "after";
    }
    const targetParentPath = mode === "into" ? node.id : parentOfPath(node.id);
    const invalid = invalidTargets.has(targetParentPath);
    e.dataTransfer.dropEffect = invalid ? "none" : "move";
    setDropTarget({ rowId: node.id, mode, targetParentPath, invalid });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const target = dropTarget;
    const source = dragPath;
    resetDrag();
    if (cancelledRef.current || !source || !target || target.invalid) return;
    if (target.targetParentPath === parentOfPath(source)) return; // already there
    onMove?.(source, target.targetParentPath);
  }

  return (
    <ul role="tree" className={className} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {data.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          expandAll={expandAll}
          renamingId={renamingId}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRequestRename={onRequestRename}
          onDelete={onDelete}
          onCopyPath={onCopyPath}
          onPublish={onPublish}
          dragPath={dragPath}
          dropTarget={dropTarget}
          autoExpandPath={autoExpandPath}
          onDragStartNode={handleDragStart}
          onDragOverNode={handleDragOver}
          onDropNode={handleDrop}
          onDragEndNode={resetDrag}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: FileNode;
  depth: number;
  selectedId?: string;
  onSelect?: (node: FileNode, opts?: { pin?: boolean }) => void;
  expandAll?: boolean;
  renamingId?: string | null;
  onRenameCommit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRequestRename?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onPublish?: (node: FileNode) => void;
  dragPath: string | null;
  dropTarget: DropTarget | null;
  autoExpandPath: string | null;
  onDragStartNode: (node: FileNode) => void;
  onDragOverNode: (e: DragEvent<HTMLDivElement>, node: FileNode, isFolder: boolean) => void;
  onDropNode: (e: DragEvent<HTMLDivElement>) => void;
  onDragEndNode: () => void;
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  expandAll,
  renamingId,
  onRenameCommit,
  onRenameCancel,
  onCreateFile,
  onCreateFolder,
  onRequestRename,
  onDelete,
  onCopyPath,
  onPublish,
  dragPath,
  dropTarget,
  autoExpandPath,
  onDragStartNode,
  onDragOverNode,
  onDropNode,
  onDragEndNode,
}: TreeRowProps) {
  const isFolder = node.type === "folder";
  const [userExpanded, setUserExpanded] = useState(
    isFolder ? !node.collapsed && node.defaultExpanded !== false : false,
  );
  const expanded = expandAll || userExpanded || node.id === autoExpandPath;
  const selected = node.id === selectedId;
  const deleted = node.status === "D";
  const isRenaming = renamingId === node.id;
  const isDragging = dragPath === node.id;
  const isDropRow = dropTarget?.rowId === node.id;
  const [draftName, setDraftName] = useState(node.name);
  // Reset the draft to the current name each time a rename session starts —
  // adjusted during render (React's documented pattern for "state that
  // resets when a prop changes") rather than an effect, so entering rename
  // mode doesn't cost an extra render.
  const [renamingSnapshot, setRenamingSnapshot] = useState(isRenaming);
  if (isRenaming !== renamingSnapshot) {
    setRenamingSnapshot(isRenaming);
    if (isRenaming) setDraftName(node.name);
  }

  // Right-click → Rename never focused the inline `<Input>` (Phase 7 suite
  // finding). Root cause, confirmed with a temporary event-by-event console
  // trace rather than guessed from reading source alone: `App.tsx`'s
  // `handleRequestRename` is a synchronous `setRenamingId` call, so this
  // row's rename `<Input>` mounts (with `autoFocus`) in the SAME React
  // commit Radix's `ContextMenu` is still tearing itself down in — and
  // `@radix-ui/react-focus-scope`'s `FocusScope` (every Radix menu's
  // Content wraps one, `trapped: context.open`) actively traps focus
  // WHILE OPEN: a document-level `focusin` listener detects focus landing
  // on our `<Input>` (which lives in the sidebar tree, outside the trapped
  // menu container) and yanks it straight back into the still-mounted
  // (animating-out) menu — before our `<Input>`'s own `onFocus` ever fires,
  // confirmed by that trace: the "New File" flow (whose rename input mounts
  // well after the menu has fully closed, since `handleCreateFile` `await`s
  // `fs.createFile()` first) reliably logs one clean focus event, while
  // this same-tick Rename flow logs ZERO — the input's `autoFocus` call
  // never even briefly wins, it's out-competed by an active trap, not
  // merely raced by a delayed restore. (`onCloseAutoFocus` — Radix's
  // documented escape hatch for the *separate* "restore focus to the
  // trigger on unmount" step — is still set with `preventDefault()` below;
  // it's necessary but not sufficient on its own, since it can't be
  // called until the trap itself has already relaxed.)
  //
  // Fixed by not trying to win a single-shot race against an active focus
  // trap at all: the effect below re-asserts `.focus()` on every animation
  // frame — cheap, and self-terminating — until the input
  // actually holds `document.activeElement` (Radix's trap only contests
  // focus for the finite window its own close animation/effect teardown
  // takes; once that's done, our re-assertion is uncontested and sticks
  // immediately) or a ~500ms budget elapses (so a genuinely gone/removed
  // input, e.g. rename cancelled from elsewhere, can't loop forever).
  // Verified by right-clicking → Rename and typing immediately (no extra
  // click, no `.fill()` workaround) — see `tests/e2e/fs-git.spec.ts`'s
  // companion test.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isRenaming) return;
    let raf = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~500ms at 60fps
    function tick() {
      const el = inputRef.current;
      if (!el || document.activeElement === el || attempts >= MAX_ATTEMPTS) return;
      attempts++;
      el.focus();
      el.select();
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRenaming]);

  const handleActivate = (opts?: { pin?: boolean }) => {
    if (isFolder) {
      setUserExpanded((e) => !e);
    } else {
      onSelect?.(node, opts);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivate({ pin: e.key === "Enter" });
    }
  };

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== node.name) {
      onRenameCommit?.(node, trimmed);
    } else {
      onRenameCancel?.();
    }
  };

  const parentPath = isFolder ? node.id : parentOfPath(node.id);

  const row = (
    <div
      role="treeitem"
      aria-expanded={isFolder ? expanded : undefined}
      aria-selected={selected}
      data-tree-path={node.id}
      data-tree-kind={node.type}
      tabIndex={0}
      draggable={depth > 0 && !isRenaming}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStartNode(node);
      }}
      onDragOver={(e) => onDragOverNode(e, node, isFolder)}
      onDrop={onDropNode}
      onDragEnd={onDragEndNode}
      onClick={() => !isRenaming && handleActivate()}
      onDoubleClick={() => !isRenaming && handleActivate({ pin: true })}
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minHeight: "var(--app-chrome-tree-row-h)",
        // Density (DESIGN-SPEC Amendments item 11): base inline padding is
        // the `--app-density-row-pad-x` token, not a fixed `8px` — the
        // depth-based indent stays a plain px offset (indentation semantics,
        // not density).
        paddingLeft: `calc(var(--app-density-row-pad-x) + ${depth * 16}px)`,
        paddingRight: "var(--app-density-row-pad-x)",
        cursor: isDragging ? "grabbing" : "pointer",
        position: "relative",
        borderRadius: "var(--radius-ui-sm)",
        opacity: isDragging ? 0.5 : 1,
        background:
          isDropRow && dropTarget?.mode === "into"
            ? dropTarget.invalid
              ? "color-mix(in srgb, var(--color-danger) 16%, transparent)"
              : "color-mix(in srgb, var(--color-primary) 16%, transparent)"
            : selected
              ? "var(--color-surface-active)"
              : "transparent",
        outline:
          isDropRow && dropTarget?.mode === "into" && !dropTarget.invalid
            ? "1px solid var(--color-primary)"
            : "none",
        outlineOffset: -1,
      }}
      onMouseEnter={(e) => {
        if (!selected && !isDropRow) e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected && !isDropRow) e.currentTarget.style.background = "transparent";
      }}
    >
      {isDropRow && dropTarget?.mode === "before" && (
        <InsertionLine invalid={dropTarget.invalid} />
      )}
      {isDropRow && dropTarget?.mode === "after" && (
        <InsertionLine invalid={dropTarget.invalid} bottom />
      )}
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
      <FileIcon kind={node.kind} name={node.name} open={expanded} size={14} />
      {isRenaming ? (
        <Input
          size="sm"
          autoFocus
          ref={inputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onRenameCancel?.();
            }
          }}
          onBlur={commitRename}
          style={{ flex: 1, minWidth: 0, height: 22, fontSize: 13, fontFamily: "var(--font-sans)" }}
        />
      ) : (
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
      )}
      {!isRenaming && node.status && (
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
  );

  return (
    <li role={isFolder ? undefined : "none"} style={{ position: "relative" }}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={isRenaming}>
          {row}
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => onCreateFile?.(parentPath)}>
            <FilePlus size={13} /> New File
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFolder?.(parentPath)}>
            <FolderPlus size={13} /> New Folder
          </ContextMenuItem>
          {depth > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onRequestRename?.(node)}>
                <Pencil size={13} /> Rename
              </ContextMenuItem>
              <ContextMenuItem destructive onSelect={() => onDelete?.(node)}>
                <Trash2 size={13} /> Delete
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onSelect?.(node)}>
            <Crosshair size={13} /> Reveal in tree
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopyPath?.(node)}>
            <Copy size={13} /> Copy path
          </ContextMenuItem>
          {!isFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onPublish?.(node)}>
                <Share2 size={13} /> Publish…
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {isFolder && expanded && node.children && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandAll={expandAll}
              renamingId={renamingId}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRequestRename={onRequestRename}
              onDelete={onDelete}
              onCopyPath={onCopyPath}
              onPublish={onPublish}
              dragPath={dragPath}
              dropTarget={dropTarget}
              autoExpandPath={autoExpandPath}
              onDragStartNode={onDragStartNode}
              onDragOverNode={onDragOverNode}
              onDropNode={onDropNode}
              onDragEndNode={onDragEndNode}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function InsertionLine({ invalid, bottom }: { invalid: boolean; bottom?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        [bottom ? "bottom" : "top"]: -1,
        height: 2,
        borderRadius: 1,
        background: invalid ? "var(--color-danger)" : "var(--color-primary)",
        pointerEvents: "none",
      }}
    />
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

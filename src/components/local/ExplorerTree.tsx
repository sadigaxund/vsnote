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
 *
 * OS import (DESIGN-SPEC Amendments round 5 item 39): dragging files/folders
 * IN from the operating system reuses this exact same `dropTarget` state and
 * "into"/"before"/"after" affordances — a real internal drag always fires
 * our own row `onDragStart` first (setting `dragPath`), so an external OS
 * drag is simply whichever drop reaches `handleDragOver`/`handleDrop` with
 * `dragPath` still `null` but `e.dataTransfer.types` containing `"Files"`;
 * no second highlight style, no separate state machine. Per-item
 * `DataTransferItem.getAsFile()`/`.webkitGetAsEntry()` are only valid to
 * CALL synchronously within the native `drop` event's own task, so
 * `handleDrop` captures them (`captureDataTransferItems`) before its own
 * `resetDrag()`/any `await`, then flattens (`flattenCapturedItems`,
 * directory-recursive where the browser supports `webkitGetAsEntry`,
 * flat-file fallback otherwise) asynchronously afterward — same Esc/ref
 * cancellation flag as internal DnD applies here too. Ctrl+V paste (item
 * 39b) is unrelated to dragging but shares the same "target folder" concept
 * (the selected node if it's a folder, else its parent) and the same
 * `onImportEntries` prop — bound via `onPaste` on the tree root so it fires
 * whenever any row inside has keyboard focus, per spec's "with the tree
 * focused". Actual fs writes + conflict rename-or-replace happen in
 * `App.tsx` (`fs/importEntries.ts`), same split as `onMove`/`onDelete`/etc.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Input, Tooltip } from "my-you-eye";
import {
  Copy,
  Crosshair,
  FilePlus,
  FolderPlus,
  Link2,
  Pencil,
  Settings2,
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
import { computeShareIndicator, type ShareIndicatorInput } from "../../share/shareIndicators";
import { captureDataTransferItems, extractClipboardFiles, flattenCapturedItems, type FlattenedEntry } from "../../fs/importEntries";
import type { FileNode } from "../../types";

/** Tooltip text for the share indicator glyph — "link + policy + hits" per
 * roadmap §5.1. `own` distinguishes "Shared: ..." from "Inside a shared
 * folder: ..." (the muted variant still names the share it's inherited
 * from, it just isn't itself the share root). */
function shareIndicatorTooltip(share: ExplorerShareRow, own: boolean): string {
  const id = share.alias && share.alias.length > 0 ? share.alias : share.slug;
  const access = share.general_access === "link" ? "Anyone with the link" : "Restricted";
  const kindLabel = share.kind === "folder" ? "folder" : "file";
  const prefix = own ? `Shared ${kindLabel}` : `Inside a shared folder`;
  return `${prefix}: /share/${id} (${access}, ${share.hit_count} hit${share.hit_count === 1 ? "" : "s"})`;
}

function parentOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(0, idx);
}

/**
 * Phase 10.5 — the share-record shape `ExplorerTree` needs to render the
 * tree indicator (roadmap §5.1: link glyph right-aligned like the git
 * status letters, muted "inherited" variant on files inside a shared
 * folder, tooltip = link + policy + hits). A local structural type rather
 * than importing `share/api.ts`'s `ShareOut` directly — `App.tsx` passes
 * `ShareOut[]` straight through (it satisfies this shape), but this file
 * stays decoupled from the sharing module's full surface, same reasoning
 * as `share/shareIndicators.ts` itself.
 */
export interface ExplorerShareRow extends ShareIndicatorInput {
  slug: string;
  alias?: string | null;
  general_access: string;
  hit_count: number;
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
  /** DESIGN-SPEC Amendments round 4 item 30 — forces this one folder id
   * open regardless of its own collapsed/`userExpanded` state, same
   * mechanism as the existing drag-hover `autoExpandPath` below just
   * driven by "a new-file/folder draft was just created inside it" instead
   * of a drag gesture. `App.tsx` passes the draft's `parentPath` here so a
   * collapsed folder still reveals the draft row the moment "New file" is
   * chosen on it. */
  forceExpandId?: string | null;
  onRenameCommit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRequestRename?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onMove?: (sourcePath: string, newParentPath: string) => void;
  /** Phase 10 (sharing), extended Phase 10.5 to folders too — "Publish…"
   * on a not-yet-shared row (see the row menu below). */
  onPublish?: (node: FileNode) => void;
  /** Phase 10.5 — active shares, for the tree indicator glyph + its
   * context menu (copy link / manage). Omit or pass `[]` for a caller that
   * hasn't loaded the share list (e.g. Settings' "Sharing" category never
   * mounted) — the tree simply shows no indicators. */
  shares?: ExplorerShareRow[];
  onCopyShareLink?: (node: FileNode, share: ExplorerShareRow) => void;
  onManageShare?: (node: FileNode, share: ExplorerShareRow) => void;
  /** DESIGN-SPEC Amendments round 5 item 39 — OS file/folder drag-drop onto
   * a row, or Ctrl+V paste into the selected folder. `targetFolderPath` is
   * the display path of the folder the entries land in (the hovered folder
   * row / drop-target's parent for a drop; the selected node if it's a
   * folder, else its parent, for a paste); `entries` are already flattened
   * (nested OS folders preserved as `/`-joined relative paths). Omit to
   * disable both — the tree simply won't attach drop/paste handling for
   * external content when there's nothing to hand it to. */
  onImportEntries?: (targetFolderPath: string, entries: FlattenedEntry[]) => void;
  className?: string;
}

export function ExplorerTree({
  data,
  selectedId,
  onSelect,
  expandAll,
  renamingId,
  forceExpandId,
  onRenameCommit,
  onRenameCancel,
  onCreateFile,
  onCreateFolder,
  onRequestRename,
  onDelete,
  onCopyPath,
  onMove,
  onPublish,
  shares,
  onCopyShareLink,
  onManageShare,
  onImportEntries,
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

  // An external OS drag never fires our own row `onDragStart` (that only
  // happens for elements dragged FROM inside this DOM), so `dragPath` stays
  // null for it — the one reliable way to tell "internal reorder" and "OS
  // files incoming" apart from inside these shared handlers.
  function isExternalFileDrag(e: DragEvent<HTMLDivElement>): boolean {
    return !dragPath && Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, node: FileNode, isFolder: boolean) {
    const external = isExternalFileDrag(e);
    if (!dragPath && !external) return;
    if (dragPath === node.id) return;
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
    const invalid = dragPath ? invalidTargets.has(targetParentPath) : false;
    e.dataTransfer.dropEffect = invalid ? "none" : dragPath ? "move" : "copy";
    setDropTarget({ rowId: node.id, mode, targetParentPath, invalid });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const target = dropTarget;
    const source = dragPath;
    const external = isExternalFileDrag(e);
    // MUST capture synchronously, before `resetDrag()`/any `await` below —
    // see the module doc's "OS import" paragraph: the browser invalidates
    // `DataTransferItem.getAsFile()`/`.webkitGetAsEntry()` once this
    // event's own task finishes.
    const captured = external ? captureDataTransferItems(e.dataTransfer.items) : null;
    resetDrag();
    if (cancelledRef.current || !target) return;
    if (source) {
      if (target.invalid) return;
      if (target.targetParentPath === parentOfPath(source)) return; // already there
      onMove?.(source, target.targetParentPath);
      return;
    }
    if (!external || !captured || captured.length === 0) return;
    void flattenCapturedItems(captured).then((entries) => {
      if (entries.length > 0) onImportEntries?.(target.targetParentPath, entries);
    });
  }

  function findNodeById(nodes: FileNode[], id: string): FileNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNodeById(n.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Ctrl+V paste target: the selected node if it's a folder, else its
  // parent, else the vault root — same "resolve to a folder" rule
  // `App.tsx`'s `resolveCreateParent` already uses for "New file"/"New
  // folder", kept local here since the tree already has `data`/`selectedId`
  // in scope and this never needs to leave the component.
  function handlePaste(e: ClipboardEvent<HTMLUListElement>) {
    if (!onImportEntries) return;
    const entries = extractClipboardFiles(e.clipboardData);
    if (entries.length === 0) return;
    e.preventDefault();
    const selectedNode = selectedId ? findNodeById(data, selectedId) : null;
    const targetFolderPath = selectedNode
      ? selectedNode.type === "folder"
        ? selectedNode.id
        : parentOfPath(selectedNode.id)
      : (data[0]?.id ?? "vault");
    onImportEntries(targetFolderPath, entries);
  }

  return (
    <ul
      role="tree"
      className={className}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
      onPaste={handlePaste}
    >
      {data.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          expandAll={expandAll}
          renamingId={renamingId}
          forceExpandId={forceExpandId ?? null}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRequestRename={onRequestRename}
          onDelete={onDelete}
          onCopyPath={onCopyPath}
          onPublish={onPublish}
          shares={shares}
          onCopyShareLink={onCopyShareLink}
          onManageShare={onManageShare}
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
  forceExpandId: string | null;
  onRenameCommit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRequestRename?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onPublish?: (node: FileNode) => void;
  shares?: ExplorerShareRow[];
  onCopyShareLink?: (node: FileNode, share: ExplorerShareRow) => void;
  onManageShare?: (node: FileNode, share: ExplorerShareRow) => void;
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
  forceExpandId,
  onRenameCommit,
  onRenameCancel,
  onCreateFile,
  onCreateFolder,
  onRequestRename,
  onDelete,
  onCopyPath,
  onPublish,
  shares,
  onCopyShareLink,
  onManageShare,
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
  const expanded = expandAll || userExpanded || node.id === autoExpandPath || node.id === forceExpandId;
  const selected = node.id === selectedId;
  const deleted = node.status === "D";
  const isRenaming = renamingId === node.id;
  const isDragging = dragPath === node.id;
  const isDropRow = dropTarget?.rowId === node.id;
  const shareIndicator = useMemo(() => computeShareIndicator(shares ?? [], node.id), [shares, node.id]);
  const ownShare = shareIndicator.own[0];
  const inheritedShare = shareIndicator.inherited[0];
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
  // confirmed by that trace: this same-tick Rename flow logs ZERO focus
  // events — the input's `autoFocus` call never even briefly wins, it's
  // out-competed by an active trap, not merely raced by a delayed restore.
  // (At the time this was diagnosed, "New File" was NOT same-tick —
  // `handleCreateFile` used to `await fs.createFile()` before setting
  // `renamingId`, mounting its input well after the menu had fully closed,
  // so it logged one clean focus event and never hit this bug. DESIGN-SPEC
  // Amendments round 4 item 30 made `handleCreateFile` synchronous — no fs
  // write until a real name is committed, see `App.tsx`'s `insertDraftNode`
  // doc — so "New File" is now ALSO same-tick with the menu closing. That's
  // fine: the fix below doesn't care which flow triggered `isRenaming`, it
  // re-asserts focus for either one.) (`onCloseAutoFocus` — Radix's
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
      {!isRenaming && (ownShare || inheritedShare) && (
        <Tooltip content={shareIndicatorTooltip(ownShare ?? inheritedShare!, !!ownShare)} side="right">
          <span
            data-testid={ownShare ? `share-indicator-own-${node.id}` : `share-indicator-inherited-${node.id}`}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              // Right-aligned like the git status letter (DESIGN-SPEC
              // convention this row already follows) — own shares get the
              // full accent color, inherited ("this file lives inside a
              // shared FOLDER, not itself shared") gets the muted variant
              // per roadmap §5.1.
              color: ownShare ? "var(--color-primary)" : "var(--color-muted)",
              opacity: ownShare ? 1 : 0.7,
              width: 12,
            }}
          >
            <Link2 size={11} aria-hidden />
          </span>
        </Tooltip>
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
          <ContextMenuSeparator />
          {ownShare ? (
            <>
              <ContextMenuItem onSelect={() => onCopyShareLink?.(node, ownShare)}>
                <Link2 size={13} /> Copy link
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onManageShare?.(node, ownShare)}>
                <Settings2 size={13} /> Manage share…
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem onSelect={() => onPublish?.(node)}>
              <Share2 size={13} /> Publish…
            </ContextMenuItem>
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
              forceExpandId={forceExpandId}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRequestRename={onRequestRename}
              onDelete={onDelete}
              onCopyPath={onCopyPath}
              onPublish={onPublish}
              shares={shares}
              onCopyShareLink={onCopyShareLink}
              onManageShare={onManageShare}
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

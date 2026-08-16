/**
 * EditorTabBar — VSCode-style document tab strip.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("EditorTabBar / Tab", status
 * `built-locally`, used in `src/components/TabBar.tsx`). The library's
 * `Tabs` is content-switching nav (underline/pills/filing variants over a
 * fixed set of panels) — it has no per-tab close button, dirty-dot, preview
 * (italic) state, or git-color tint, and isn't meant to scroll/overflow the
 * way an open-document strip does. Built from `Button`/`DropdownMenu`
 * primitives + tokens for the overflow menu; the tab row itself is a plain
 * scrollable flex strip since `Tabs`' internals (Radix `Tabs.Root`) assume
 * a single active panel model that doesn't fit "closeable, reorderable
 * documents."
 *
 * Phase 6 (DESIGN-SPEC Amendments item 8, "grid split view"): every tab is
 * now `draggable` — dragstart puts `{path, paneId, name, kind}` on
 * `dataTransfer` under `application/x-vsnote-tab`, the payload
 * `EditorPane.tsx`'s drop-zone handlers (and this bar's own `onDrop`, for
 * dropping directly onto a tab strip = "merge into this pane") read back.
 * Each tab also gets a right-click `ContextMenu` (the local primitive,
 * already used by `ExplorerTree`) with "Split Left/Right/Up/Down" — the
 * spec's required non-drag affordance ("Also available as a button/menu on
 * the tab") — plus Close, so the whole split feature is reachable without
 * knowing the drag gesture exists.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "my-you-eye";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MoreHorizontal, Settings as SettingsIcon, X } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ContextMenu";
import { FileIcon } from "./FileIcon";
import type { DockEdge, TabItem } from "../../types";

export interface TabDragPayload {
  path: string;
  paneId: string;
  name: string;
  kind: TabItem["kind"];
}

export interface EditorTabBarProps {
  /** Which pane this bar belongs to (Phase 6) — carried in the drag payload
   * and used to distinguish "reorder within this bar" from "docked from
   * another pane." */
  paneId: string;
  tabs: TabItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  /** A tab was dropped directly on this bar (from any pane, including this
   * one) — always a "merge into this pane's tabs" action, never a split. */
  onDropExternalTab?: (payload: TabDragPayload) => void;
  /** Per-tab context-menu / discoverable split action — the spec's required
   * non-drag affordance. `edge` excludes "center" (that's just "select the
   * tab", not a split). */
  onSplitTab?: (path: string, edge: Exclude<DockEdge, "center">) => void;
}

export function EditorTabBar({ paneId, tabs, activeId, onSelect, onClose, onDropExternalTab, onSplitTab }: EditorTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Open editors"
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--app-titlebar-bg)",
        borderBottom: "1px solid var(--app-chrome-border)",
        minHeight: "var(--app-chrome-tabbar-h)",
      }}
    >
      <div
        style={{
          display: "flex",
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-vsnote-tab")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData("application/x-vsnote-tab");
          if (!raw) return;
          try {
            onDropExternalTab?.(JSON.parse(raw) as TabDragPayload);
          } catch {
            // Malformed payload (not one of ours) — ignore.
          }
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={active}
                  data-tab-path={tab.path}
                  data-pane-id={paneId}
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    const payload: TabDragPayload = { path: tab.path, paneId, name: tab.name, kind: tab.kind };
                    e.dataTransfer.setData("application/x-vsnote-tab", JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onSelect?.(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    // Density (DESIGN-SPEC Amendments item 11): see
                    // `theme.css`'s `--app-density-tab-pad-x` doc.
                    padding: "0 var(--app-density-tab-pad-x)",
                    minWidth: 120,
                    maxWidth: 220,
                    borderRight: "1px solid var(--app-chrome-border)",
                    background: active ? "var(--app-editor-bg)" : "transparent",
                    borderTop: active
                      ? "2px solid var(--color-primary)"
                      : "2px solid transparent",
                    cursor: "pointer",
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  {/* The Settings view tab (DESIGN-SPEC Amendments item 11)
                      isn't a real fs file — `FileIcon` resolves file/folder
                      *identity* icons (Material Icon Theme), which has no
                      meaningful entry for a virtual view; the gear is UI
                      chrome, so it comes from lucide (DESIGN-SPEC Amendments
                      item 1: "lucide-react stays for everything that isn't
                      file/folder identity ... gear"). */}
                  {tab.kind === "settings" ? (
                    <SettingsIcon size={14} color="var(--color-muted)" aria-hidden />
                  ) : (
                    <FileIcon kind={tab.kind} name={tab.name} size={14} />
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                      fontFamily: "var(--font-sans)",
                      fontStyle: tab.preview ? "italic" : "normal",
                      color: active ? "var(--color-fg)" : "var(--color-muted)",
                    }}
                  >
                    {tab.name}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {tab.dirty && (
                      <span
                        aria-hidden
                        data-testid="tab-dirty-dot"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "var(--git-modified)",
                          display: "inline-block",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`Close ${tab.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose?.(tab.id);
                      }}
                      style={{
                        flexShrink: 0,
                        width: 16,
                        height: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        background: active ? "var(--color-surface-active)" : "transparent",
                        color: "var(--color-muted)",
                        cursor: "pointer",
                        borderRadius: 999,
                        padding: 0,
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onSplitTab?.(tab.path, "left")}>
                  <ArrowLeft size={13} /> Split left
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onSplitTab?.(tab.path, "right")}>
                  <ArrowRight size={13} /> Split right
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onSplitTab?.(tab.path, "top")}>
                  <ArrowUp size={13} /> Split up
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onSplitTab?.(tab.path, "bottom")}>
                  <ArrowDown size={13} /> Split down
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onClose?.(tab.id)}>Close</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More tabs"
            style={{
              flexShrink: 0,
              width: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderLeft: "1px solid var(--app-chrome-border)",
              background: "transparent",
              color: "var(--color-muted)",
              cursor: "pointer",
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => tabs.forEach((t) => onClose?.(t.id))}>
            Close all tabs
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              tabs.filter((t) => t.id !== activeId).forEach((t) => onClose?.(t.id))
            }
          >
            Close others
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "my-you-eye";
import { MoreHorizontal, X } from "lucide-react";
import { FileIcon } from "./FileIcon";
import type { TabItem } from "../../types";

export interface EditorTabBarProps {
  tabs: TabItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
}

export function EditorTabBar({ tabs, activeId, onSelect, onClose }: EditorTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Open editors"
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--app-titlebar-bg)",
        borderBottom: "1px solid var(--app-chrome-border)",
        minHeight: 36,
      }}
    >
      <div
        style={{
          display: "flex",
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect?.(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
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
              <FileIcon kind={tab.kind} size={14} />
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

/**
 * StatusBar — slotted app-wide status strip with compact hoverable/
 * clickable segments (VSCode's bottom bar).
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("StatusBar", status
 * `built-locally`, used in `src/components/StatusBar.tsx`). No library
 * component covers a persistent two-sided slotted strip of small
 * interactive segments; `Toolbar` is a heavier leading/search/filters/
 * actions composite meant for page headers, not a 22px chrome bar. Each
 * `StatusBarItem` wraps the library's `Tooltip` for the "every segment is
 * hoverable" requirement (DESIGN-SPEC §5) instead of reinventing a tooltip.
 */
import { Tooltip } from "my-you-eye";
import type { ReactNode } from "react";

export interface StatusBarProps {
  left: ReactNode;
  right: ReactNode;
}

export function StatusBar({ left, right }: StatusBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--app-chrome-statusbar-h)",
        padding: "0 8px",
        background: "var(--app-titlebar-bg)",
        borderTop: "1px solid var(--app-chrome-border)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--color-muted)",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>{left}</div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>{right}</div>
    </div>
  );
}

export interface StatusBarItemProps {
  icon?: ReactNode;
  label: ReactNode;
  tooltip?: string;
  tone?: "default" | "success" | "danger" | "warning" | "primary";
  onClick?: () => void;
}

const TONE_COLOR: Record<NonNullable<StatusBarItemProps["tone"]>, string> = {
  default: "var(--color-muted)",
  success: "var(--git-added)",
  danger: "var(--git-deleted)",
  warning: "var(--git-modified)",
  primary: "var(--color-primary)",
};

export function StatusBarItem({ icon, label, tooltip, tone = "default", onClick }: StatusBarItemProps) {
  const content = (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        height: "100%",
        padding: "0 7px",
        border: "none",
        background: "transparent",
        color: TONE_COLOR[tone],
        cursor: onClick ? "pointer" : "default",
        borderRadius: "var(--radius-ui-sm)",
        fontFamily: "inherit",
        fontSize: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {label}
    </button>
  );
  return tooltip ? (
    <Tooltip content={tooltip} side="top">
      {content}
    </Tooltip>
  ) : (
    content
  );
}

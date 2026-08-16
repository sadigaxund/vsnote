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
 *
 * DESIGN-SPEC Amendments round 3 item 22(a): background is a
 * `TexturedSurface` composed behind the real content, same pattern as
 * `local/ActivityBar.tsx` (see that file's doc for the full reasoning) —
 * inert under VSNote, visible under `metallic`/`glass`/`comic`/`frosted`.
 */
import { Tooltip, TexturedSurface } from "my-you-eye";
import type { ReactNode } from "react";

export interface StatusBarProps {
  left: ReactNode;
  right: ReactNode;
}

export function StatusBar({ left, right }: StatusBarProps) {
  return (
    <div
      data-testid="app-statusbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--app-chrome-statusbar-h)",
        padding: "0 8px",
        // `position`/`isolation` exist for the `TexturedSurface` below:
        // it is an absolutely-positioned `z-index: -1` sibling, so this
        // element must be its containing block AND its own stacking
        // context — without `isolation: isolate` a negative z-index child
        // escapes behind the nearest ancestor stacking context (the shell
        // root) and stops compositing over this bar's own fill. Same
        // pattern as `local/TitleBar.tsx`.
        position: "relative",
        isolation: "isolate",
        borderTop: "1px solid var(--app-chrome-border)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--color-muted)",
      }}
    >
      {/* DESIGN-SPEC Amendments round 3 item 22(a): the bar's fill is
          painted BY this surface (hence no `background` above), so each
          library theme's own texture is drawn directly on the status bar
          instead of being relied upon to transmit through stacked
          translucent ancestors — see `src/theme.css`'s `.dark` block for
          the measurements that ruled the transmission approach out. Inert
          under VSNote, whose `--texture-*` values render nothing. */}
      <TexturedSurface
        aria-hidden
        radius="none"
        variant="surface"
        color="--app-titlebar-bg"
        layer="page"
        style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}
      />
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

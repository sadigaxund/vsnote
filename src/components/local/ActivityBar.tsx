/**
 * ActivityBar (IconRail) — VSCode-style vertical icon rail with an active
 * left-edge indicator and count badges.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("ActivityBar / IconRail", status
 * `built-locally`, used in `src/components/Shell.tsx`). The library has no
 * vertical icon-rail pattern (`Toolbar` is horizontal; `Tabs` is
 * content-switching, not a persistent nav rail with badges). Built from
 * `Button`/`Tooltip` primitives plus the shared design tokens — not a
 * fork, a composition the library doesn't offer pre-assembled.
 *
 * DESIGN-SPEC Amendments round 3 item 22(a): the rail's own background is
 * a `TexturedSurface` (`texture="theme"`) composed as an absolutely
 * positioned, `pointer-events: none`, `z-index: -1` sibling behind the real
 * icon content, filling the whole rail (`inset: 0`) — not a fork of the
 * component, and not applied via `as`/wrap-override (it can't be: the
 * `<nav>` element and its `aria-label`/`data-testid` stay exactly as they
 * were, `TexturedSurface` only supplies the paint layer behind them). It
 * reads `--texture-type`/`--texture-opacity-surface` off `data-theme`
 * itself, so it's automatically inert (opacity 0) for VSNote/`data-theme`
 * unset — see `src/theme.css`'s `.dark` block comment for the full
 * reasoning and the measured before/after numbers.
 */
import { Button, Tooltip, TexturedSurface } from "my-you-eye";
import type { ReactNode } from "react";

export interface ActivityBarItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
}

export interface ActivityBarProps {
  items: ActivityBarItem[];
  onSelect?: (id: string) => void;
  footer?: ActivityBarItem;
  onFooterSelect?: (id: string) => void;
}

export function ActivityBar({ items, onSelect, footer, onFooterSelect }: ActivityBarProps) {
  return (
    <nav
      aria-label="Activity Bar"
      data-testid="app-activitybar"
      style={{
        width: 48,
        flexShrink: 0,
        position: "relative",
        isolation: "isolate",
        borderRight: "1px solid var(--app-chrome-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <TexturedSurface
        aria-hidden
        radius="none"
        variant="surface"
        color="--app-chrome-bg"
        layer="page"
        style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}
      />
      {/* DESIGN-SPEC Amendments round 3 item 23 ("Density must be real"):
          icon spacing between rail items scales with `--app-density-icon-
          gap` instead of a fixed `4px`, the concrete "icon spacing" example
          density is supposed to visibly affect. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--app-density-icon-gap)" }}>
        {items.map((item) => (
          <RailButton key={item.id} item={item} onClick={() => onSelect?.(item.id)} />
        ))}
      </div>
      {footer && (
        <RailButton item={footer} onClick={() => onFooterSelect?.(footer.id)} />
      )}
    </nav>
  );
}

function RailButton({ item, onClick }: { item: ActivityBarItem; onClick: () => void }) {
  return (
    <Tooltip content={item.label} side="right">
      <div style={{ position: "relative", width: 48, display: "flex", justifyContent: "center" }}>
        {item.active && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 6,
              bottom: 6,
              width: 2,
              background: "var(--color-primary)",
              borderRadius: "0 2px 2px 0",
            }}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={item.label}
          aria-pressed={item.active}
          onClick={onClick}
          className="relative"
          style={{
            width: 32,
            height: 32,
            color: item.active ? "var(--color-fg)" : "var(--color-muted)",
          }}
        >
          {item.icon}
          {item.badge != null && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                bottom: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                padding: "0 3px",
                borderRadius: 999,
                background: "var(--color-primary)",
                color: "var(--color-primary-fg)",
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                lineHeight: "14px",
                textAlign: "center",
              }}
            >
              {item.badge}
            </span>
          )}
        </Button>
      </div>
    </Tooltip>
  );
}

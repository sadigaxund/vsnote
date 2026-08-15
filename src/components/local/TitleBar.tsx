/**
 * TitleBar — window chrome: app identity, a slot centered across the whole
 * bar width, trailing icon actions.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("TitleBar", status `built-locally`,
 * used in `src/components/TitleBar.tsx`). `Toolbar`'s `leading`/`actions`
 * slots only ever center relative to each other (its `search` slot sits
 * inside the `leading` flex group), not to the bar's own width — this
 * layout needs `center` to stay visually centered under the window
 * regardless of how wide `leading`/`actions` are, which needs its own grid.
 *
 * DESIGN-SPEC Amendments item 2: the macOS traffic-light dots are gone —
 * no placeholder, no spacer — the bar starts directly at the app glyph.
 */
import type { ReactNode } from "react";

export interface TitleBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  glyph?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
}

export function TitleBar({ title, subtitle, glyph, center, actions }: TitleBarProps) {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        height: "var(--app-chrome-titlebar-h)",
        padding: "0 12px",
        background: "var(--app-titlebar-bg)",
        borderBottom: "1px solid var(--app-chrome-border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {glyph}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-fg)",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--color-muted)",
              whiteSpace: "nowrap",
            }}
          >
            — {subtitle}
          </span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>{center}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
        {actions}
      </div>
    </header>
  );
}

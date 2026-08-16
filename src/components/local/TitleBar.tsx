/**
 * TitleBar — window chrome: app identity + breadcrumbs (left), trailing
 * icon actions (right).
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("TitleBar", status `built-locally`,
 * used in `src/components/TitleBar.tsx`). `Toolbar`'s `leading`/`actions`
 * slots only ever center relative to each other (its `search` slot sits
 * inside the `leading` flex group) — not what this bar needs.
 *
 * DESIGN-SPEC Amendments item 2: the macOS traffic-light dots are gone —
 * no placeholder, no spacer — the bar starts directly at the app glyph.
 *
 * DESIGN-SPEC Amendments round 3 item 18 ("Header consolidation") dropped
 * the old three-column `center` slot (previously a wide, centered global
 * search `Input`) — that affordance shrank to a compact icon + `⌘K` hint
 * folded into `actions` instead (`components/TitleBar.tsx`'s job, not this
 * shell's), so this component went back to a simpler two-zone flex layout:
 * left (glyph/title/subtitle/breadcrumb), right (actions). `breadcrumb` is
 * new — the focused pane's `vault / notes / architecture.md` trail, which
 * used to live in the now-conditional `EditorHeader` row; rendering it here
 * means the title bar itself doesn't grow any taller to fit it (same fixed
 * `--app-chrome-titlebar-h`), it just has one more inline element.
 *
 * DESIGN-SPEC Amendments round 3 item 22(a): background is a
 * `TexturedSurface` composed behind the real content, same pattern as
 * `local/ActivityBar.tsx` (see that file's doc for the full reasoning) —
 * inert under Slate, visible under `metallic`/`glass`/`comic`/`frosted`.
 */
import type { ReactNode } from "react";
import { TexturedSurface } from "my-you-eye";

export interface TitleBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  glyph?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}

export function TitleBar({ title, subtitle, glyph, breadcrumb, actions }: TitleBarProps) {
  return (
    <header
      data-testid="app-titlebar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--app-chrome-titlebar-h)",
        padding: "0 12px",
        position: "relative",
        isolation: "isolate",
        borderBottom: "1px solid var(--app-chrome-border)",
        flexShrink: 0,
        gap: 12,
      }}
    >
      <TexturedSurface
        aria-hidden
        radius="none"
        variant="surface"
        color="--app-titlebar-bg"
        layer="page"
        style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
        {glyph}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-fg)",
            whiteSpace: "nowrap",
            flexShrink: 0,
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
              flexShrink: 0,
            }}
          >
            · {subtitle}
          </span>
        )}
        {breadcrumb && (
          <>
            <span aria-hidden style={{ color: "var(--app-chrome-border)", flexShrink: 0 }}>
              │
            </span>
            <div style={{ minWidth: 0, overflow: "hidden" }}>{breadcrumb}</div>
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {actions}
      </div>
    </header>
  );
}

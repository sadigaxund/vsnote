/**
 * SidebarContainer — the shared LEFT-SIDEBAR REGION shell: the width box,
 * the collapse-to-zero state, the border, and the draggable resize/
 * grab-edge handle (`ResizeHandle`) — plus a standard header row (a small-
 * caps label + optional trailing action icons) every activity-bar view
 * gets for free.
 *
 * Factored out of `Sidebar.tsx` (Explorer) in a course-correction to
 * DESIGN-SPEC Amendments round 3 item 20 ("Sidebar collapse/expand"): the
 * FIRST pass at item 20 bound the resize/collapse affordance to the
 * Explorer PANEL component specifically, so `SearchPanel.tsx`/
 * `SourceControlPanel.tsx` each hardcoded their own frozen `width: 288`
 * copy of the old default and had no `ResizeHandle` at all — switching
 * from a resized Explorer to Search visibly snapped the layout back to
 * 288px, and Search/Source Control couldn't be dragged/collapsed. Width
 * and collapsed-ness are properties of the SIDEBAR REGION, not any one
 * view (real VSCode behavior too) — this component is that region, and
 * every view (`Sidebar.tsx`, `SearchPanel.tsx`, `SourceControlPanel.tsx`,
 * the new `ExtensionsPanel.tsx`) renders itself INSIDE one, all reading/
 * writing the SAME `useSettingsStore` `sidebarWidth`/`sidebarCollapsed`
 * pair via `App.tsx`'s props — so all four now share one persisted width
 * and one collapsed state, and all four are resizable/collapsible.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("SidebarContainer", status
 * `built-locally`) — the library has no "collapsible/resizable side-panel
 * region" primitive (checked `skills/components.json`: no `Sidebar`/
 * `Panel`/`Drawer`-as-persistent-region entry; `DrawerContent` is a
 * transient overlay, not a persistent layout region).
 */
import { useRef, type ReactNode } from "react";
import { TexturedSurface } from "my-you-eye";
import { ResizeHandle } from "./PaneGroup";
import { MAX_SIDEBAR_WIDTH_FALLBACK, MIN_SIDEBAR_WIDTH, SIDEBAR_COLLAPSE_THRESHOLD } from "../../stores/useSettingsStore";

export interface SidebarContainerProps {
  /** Distinguishes which view is currently mounted for tests/tooling —
   * each view passes its own historical testid (`explorer-sidebar`,
   * `search-panel`, `scm-panel`, `extensions-panel`) so existing
   * `data-testid`-scoped specs keep working unchanged even though the
   * shell rendering them is now shared. */
  testId: string;
  label: string;
  headerActions?: ReactNode;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}

export function SidebarContainer({
  testId,
  label,
  headerActions,
  width,
  onWidthChange,
  collapsed,
  onCollapsedChange,
  children,
}: SidebarContainerProps) {
  // Same "visual width, not the remembered restore-to width" discipline
  // `Sidebar.tsx` established for its own drag math before this refactor —
  // see `ResizeHandle`'s doc for why `onDrag`'s cumulative delta needs a
  // fixed, ACTUAL starting point.
  const effectiveWidth = collapsed ? 0 : width;
  const dragStartWidthRef = useRef(effectiveWidth);

  return (
    <div style={{ display: "flex", flexShrink: 0, minHeight: 0 }}>
      <aside
        data-testid={testId}
        data-collapsed={collapsed}
        style={{
          width: effectiveWidth,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          // See the `TexturedSurface` below: this region paints its own
          // fill + the active theme's texture, so it needs to be both the
          // containing block and its own stacking context.
          position: "relative",
          isolation: "isolate",
          borderRight: collapsed ? "none" : "1px solid var(--app-chrome-border)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* DESIGN-SPEC Amendments round 3 item 22(a): the sidebar's fill is
            painted BY this surface (hence no `background` above) so each
            library theme's own texture is drawn directly on it rather than
            relied upon to transmit through stacked translucent ancestors —
            see `src/theme.css`'s `.dark` block for the measurements that
            ruled that approach out. Inert under VSNote. */}
        <TexturedSurface
          aria-hidden
          radius="none"
          variant="surface"
          color="--sidebar-bg"
          layer="page"
          style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}
        />
        <div
          data-testid="sidebar-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "var(--app-chrome-sidebar-header-h)",
            padding: "0 12px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--color-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {label}
          </span>
          {headerActions && <div style={{ display: "flex", alignItems: "center", gap: 2 }}>{headerActions}</div>}
        </div>
        {children}
      </aside>

      {/* DESIGN-SPEC Amendments round 3 item 20: drag this edge to resize —
          stays mounted and draggable even while `collapsed` (the "thin grab
          edge" that restores a sensible width), regardless of which view is
          currently showing. */}
      <ResizeHandle
        direction="row"
        title="Drag to resize the sidebar"
        aria-label="Resize sidebar"
        data-testid="sidebar-resize-handle"
        onDragStart={() => {
          dragStartWidthRef.current = effectiveWidth;
        }}
        onDrag={(deltaPx) => {
          const maxWidth = typeof window !== "undefined" ? window.innerWidth * 0.5 : MAX_SIDEBAR_WIDTH_FALLBACK;
          const next = dragStartWidthRef.current + deltaPx;
          if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
            onCollapsedChange(true);
            return;
          }
          onCollapsedChange(false);
          onWidthChange(Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, next)));
        }}
      />
    </div>
  );
}

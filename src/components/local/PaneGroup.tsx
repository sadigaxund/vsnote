/**
 * PaneGroup — recursive resizable split-pane grid (DESIGN-SPEC Amendments
 * item 8 / Phase 6 "grid split view"). Logged in
 * docs/COMPONENT-BACKLOG.md as `SplitPane`/`ResizablePanels`, status
 * `built-locally`. The library has no split-pane primitive at all (checked
 * `skills/components.json`'s full catalog: no `Panel`/`Split*`/`Resizable*`
 * entry) — this renders a `PaneNode` tree (`stores/useTabsStore.ts`: a leaf
 * is an actual tab strip, a branch is a `direction` + ordered children +
 * parallel `sizes` fractions) as nested flex rows/columns with a draggable
 * `PaneDivider` between every pair of siblings.
 *
 * `DockOverlay` (same file — small enough not to warrant its own backlog
 * row) is the "live drop-zone preview" half of the spec's drag-tab-to-edge
 * docking gesture: a translucent tinted rect `EditorPane.tsx` renders over
 * whichever pane the user is currently dragging a tab across, sized/
 * positioned to the edge (or center, for "merge into this pane's tabs")
 * the cursor is currently over.
 */
import { useRef, useState } from "react";
import type { PaneNode } from "../../stores/useTabsStore";
import type { DockEdge } from "../../types";

export interface PaneGroupProps {
  node: PaneNode;
  renderLeaf: (leaf: Extract<PaneNode, { type: "leaf" }>) => React.ReactNode;
  onResize: (branchId: string, sizes: number[]) => void;
  onEqualize: (branchId: string) => void;
}

export function PaneGroup({ node, renderLeaf, onResize, onEqualize }: PaneGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === "leaf") return <>{renderLeaf(node)}</>;

  const isRow = node.direction === "row";

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: isRow ? "row" : "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {node.children.map((child, i) => (
        <div key={child.id} style={{ display: "contents" }}>
          <div
            style={{
              flexBasis: `${node.sizes[i] * 100}%`,
              flexGrow: 0,
              flexShrink: 0,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              overflow: "hidden",
            }}
          >
            <PaneGroup node={child} renderLeaf={renderLeaf} onResize={onResize} onEqualize={onEqualize} />
          </div>
          {i < node.children.length - 1 && (
            <PaneDivider
              containerRef={containerRef}
              direction={node.direction}
              sizes={node.sizes}
              index={i}
              branchId={node.id}
              onResize={onResize}
              onEqualize={onEqualize}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const MIN_FRACTION = 0.12;

interface PaneDividerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  direction: "row" | "column";
  sizes: number[];
  index: number;
  branchId: string;
  onResize: (branchId: string, sizes: number[]) => void;
  onEqualize: (branchId: string) => void;
}

function PaneDivider({ containerRef, direction, sizes, index, branchId, onResize, onEqualize }: PaneDividerProps) {
  const [hovered, setHovered] = useState(false);
  const isRow = direction === "row";

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const size = isRow ? rect.width : rect.height;
    if (size <= 0) return;
    const startPos = isRow ? e.clientX : e.clientY;
    const a0 = sizes[index];
    const b0 = sizes[index + 1];
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const pos = isRow ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / size;
      let a = a0 + delta;
      let b = a0 + b0 - a;
      if (a < MIN_FRACTION) {
        a = MIN_FRACTION;
        b = a0 + b0 - a;
      }
      if (b < MIN_FRACTION) {
        b = MIN_FRACTION;
        a = a0 + b0 - b;
      }
      const next = sizes.slice();
      next[index] = a;
      next[index + 1] = b;
      onResize(branchId, next);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      data-branch-id={branchId}
      data-divider-index={index}
      title="Drag to resize · double-click to equalize"
      onPointerDown={handlePointerDown}
      onDoubleClick={() => onEqualize(branchId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        position: "relative",
        cursor: isRow ? "col-resize" : "row-resize",
        zIndex: 3,
        ...(isRow ? { width: 6, marginLeft: -3, marginRight: -3 } : { height: 6, marginTop: -3, marginBottom: -3 }),
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          pointerEvents: "none",
          background: hovered ? "var(--color-primary)" : "var(--app-chrome-border)",
          transition: "background 100ms ease",
          ...(isRow
            ? { left: "50%", top: 0, bottom: 0, width: 1, transform: "translateX(-0.5px)" }
            : { top: "50%", left: 0, right: 0, height: 1, transform: "translateY(-0.5px)" }),
        }}
      />
    </div>
  );
}

export interface DockOverlayProps {
  edge: DockEdge;
}

export function DockOverlay({ edge }: DockOverlayProps) {
  const rectStyle: React.CSSProperties = (() => {
    switch (edge) {
      case "left":
        return { left: 0, top: 0, width: "50%", height: "100%" };
      case "right":
        return { right: 0, top: 0, width: "50%", height: "100%" };
      case "top":
        return { left: 0, top: 0, width: "100%", height: "50%" };
      case "bottom":
        return { left: 0, bottom: 0, width: "100%", height: "50%" };
      default:
        return { inset: "12%" };
    }
  })();
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        ...rectStyle,
        background: "color-mix(in oklab, var(--color-primary) 20%, transparent)",
        border: "2px solid var(--color-primary)",
        borderRadius: 4,
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}

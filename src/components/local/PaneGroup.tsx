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
 *
 * `ResizeHandle` (same file, exported) is `PaneDivider`'s pointer-drag
 * mechanics — capture-on-pointerdown, live cumulative delta on move,
 * hover-tinted 1px line over a wide invisible hit-area, release on
 * pointerup — pulled out from underneath `PaneDivider` so DESIGN-SPEC
 * Amendments item 10 ("resizable sidebar ... reuse the PaneDivider
 * affordance") has one real drag primitive to reuse instead of a second,
 * parallel pointer-event implementation. `PaneDivider` below is now a thin
 * wrapper: it owns the two-sibling-`sizes`-array math (`onDragStart`
 * snapshots the two neighboring fractions once per drag, `onDrag` receives
 * the cumulative px delta from that snapshot and redistributes it between
 * them), `ResizeHandle` owns nothing about panes at all — `Sidebar.tsx`
 * uses the exact same component for a single width value with its own
 * min/max clamp, no pane-tree knowledge required.
 */
import { useRef, useState } from "react";
import type { PaneNode } from "../../stores/useTabsStore";
import type { DockEdge } from "../../types";

export interface ResizeHandleProps {
  /** Matches `PaneBranch.direction`: "row" = siblings arranged left-to-right
   * (a vertical bar, `col-resize`, horizontal dragging); "column" = stacked
   * top-to-bottom (a horizontal bar, `row-resize`, vertical dragging). */
  direction: "row" | "column";
  /** Fired once, synchronously, on pointerdown — before any `onDrag` call —
   * so a caller can snapshot whatever state its delta math needs to stay
   * fixed for the whole gesture (matches the pre-extraction `PaneDivider`'s
   * own `a0`/`b0` capture). */
  onDragStart?: () => void;
  /** Fired on every pointermove with the CUMULATIVE px delta from the
   * gesture's start position (not an incremental per-frame delta) — the
   * same "capture once, apply the running total" shape the original
   * `PaneDivider` used, which avoids compounding rounding/clamping drift
   * across many small moves. */
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  onDoubleClick?: () => void;
  title?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  /** Keyboard contract (COMPONENT-BACKLOG §2.2, mined from shadcn's
   * Resizable a11y checklist + WIG's gestures-need-keyboard-alternatives):
   * when provided, the handle becomes a FOCUSABLE separator with
   * `aria-valuenow/min/max`, arrow-key stepping (Shift = coarse), Home/End
   * clamping to the extremes, and Enter/Space as the primary action
   * (equalize the neighboring pair / restore default width). Values are in
   * the CONSUMER'S units — fractions for `PaneDivider`, px for
   * `SidebarContainer` — so this primitive stays pane-tree-agnostic. */
  keyboard?: {
    valueNow: number;
    valueMin: number;
    valueMax: number;
    step: number;
    coarseStep: number;
    onStep: (dir: -1 | 1, coarse: boolean) => void;
    onEdge?: (edge: "min" | "max") => void;
    onActivate?: () => void;
  };
}

export function ResizeHandle({
  direction,
  onDragStart,
  onDrag,
  onDragEnd,
  onDoubleClick,
  title,
  "aria-label": ariaLabel,
  "data-testid": testId,
  keyboard,
}: ResizeHandleProps) {
  const [hovered, setHovered] = useState(false);
  const isRow = direction === "row";

  /** Arrow semantics mirror the pointer: for a vertical bar (row direction),
   * Right = handle moves right = first sibling grows (+1). Shift = coarse. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!keyboard) return;
    const coarse = e.shiftKey;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        keyboard.onStep(-1, coarse);
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        keyboard.onStep(1, coarse);
        break;
      case "Home":
        e.preventDefault();
        keyboard.onEdge?.("min");
        break;
      case "End":
        e.preventDefault();
        keyboard.onEdge?.("max");
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        keyboard.onActivate?.();
        break;
      default:
        break;
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    onDragStart?.();
    const startPos = isRow ? e.clientX : e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const pos = isRow ? ev.clientX : ev.clientY;
      onDrag(pos - startPos);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onDragEnd?.();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      aria-label={ariaLabel}
      aria-valuenow={keyboard?.valueNow}
      aria-valuemin={keyboard?.valueMin}
      aria-valuemax={keyboard?.valueMax}
      tabIndex={keyboard ? 0 : undefined}
      onKeyDown={keyboard ? handleKeyDown : undefined}
      data-testid={testId}
      title={title}
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
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
          transition: "background var(--motion-duration-quick) ease",
          ...(isRow
            ? { left: "50%", top: 0, bottom: 0, width: 1, transform: "translateX(-0.5px)" }
            : { top: "50%", left: 0, right: 0, height: 1, transform: "translateY(-0.5px)" }),
        }}
      />
    </div>
  );
}

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
  const isRow = direction === "row";
  // Snapshot of the two neighboring fractions + container size, taken once
  // per drag gesture (`onDragStart`) — see `ResizeHandle`'s doc for why the
  // per-move callback needs a fixed starting point rather than the (mutating
  // mid-drag) `sizes` prop.
  const startRef = useRef({ a0: 0, b0: 0, size: 0 });

  return (
    <ResizeHandle
      direction={direction}
      title="Drag to resize · double-click to equalize · arrow keys step"
      data-testid={`pane-divider-${branchId}-${index}`}
      keyboard={{
        valueNow: Math.round(sizes[index] * 100),
        valueMin: Math.round(MIN_FRACTION * 100),
        valueMax: 100 - Math.round(MIN_FRACTION * 100),
        step: 0.02,
        coarseStep: 0.08,
        onStep: (dir, coarse) => {
          const total = sizes[index] + sizes[index + 1];
          let a = sizes[index] + dir * (coarse ? 0.08 : 0.02);
          let b = total - a;
          if (a < MIN_FRACTION) {
            a = MIN_FRACTION;
            b = total - a;
          }
          if (b < MIN_FRACTION) {
            b = MIN_FRACTION;
            a = total - b;
          }
          const next = sizes.slice();
          next[index] = a;
          next[index + 1] = b;
          onResize(branchId, next);
        },
        onEdge: (edge) => {
          const total = sizes[index] + sizes[index + 1];
          const next = sizes.slice();
          if (edge === "min") {
            next[index] = MIN_FRACTION;
            next[index + 1] = total - MIN_FRACTION;
          } else {
            next[index] = total - MIN_FRACTION;
            next[index + 1] = MIN_FRACTION;
          }
          onResize(branchId, next);
        },
        onActivate: () => onEqualize(branchId),
      }}
      onDragStart={() => {
        const rect = containerRef.current?.getBoundingClientRect();
        startRef.current = {
          a0: sizes[index],
          b0: sizes[index + 1],
          size: rect ? (isRow ? rect.width : rect.height) : 0,
        };
      }}
      onDrag={(deltaPx) => {
        const { a0, b0, size } = startRef.current;
        if (size <= 0) return;
        const delta = deltaPx / size;
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
      }}
      onDoubleClick={() => onEqualize(branchId)}
    />
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

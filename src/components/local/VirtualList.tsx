/**
 * VirtualList — generic fixed-row-height windowed list.
 *
 * Logged in `docs/COMPONENT-BACKLOG.md` (row 25, "Resizable/VirtualList"):
 * the library has no windowed-list primitive at all (checked
 * `skills/components.json` — no `Virtual*`/`Windowed*` entry, confirmed
 * with `npx my-you-eye list`), and mounting one DOM node per row doesn't
 * scale to a real FS-backed vault with hundreds or thousands of notes —
 * exactly the case that row's "not needed until the vault is FS-backed
 * with real scale" note was waiting on (Phase 17 Milestone D).
 * `components/local/ExplorerTree.tsx` is the first consumer, routed
 * through it only once its own flattened row count crosses
 * `lib/treeFlatten.ts`'s `VIRTUALIZE_ROW_THRESHOLD` — see that file's doc
 * for why a threshold exists instead of always virtualizing.
 *
 * Composes the library's own `ScrollArea` for the scrolling region itself
 * (CLAUDE.md rule 1 — never hand-roll a styled scrollable div) and adds
 * only the windowing on top: an inner spacer sized to
 * `items.length * rowHeight` so the scrollbar thumb/track always reflect
 * the FULL row count (never just what's mounted), with the current
 * window's rows absolutely positioned at `index * rowHeight` inside it.
 * The windowing math itself is pure and lives in `lib/virtualization.ts`
 * so it's unit-testable without a DOM.
 *
 * Row height is a required prop, not a magic number baked in here: a
 * caller reads it off its own layout tokens (`ExplorerTree` reads
 * `--app-chrome-tree-row-h`, which varies by density theme) rather than
 * this file guessing a pixel value that would drift out of sync.
 */
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { ScrollArea } from "my-you-eye";
import { computeVirtualWindow, DEFAULT_OVERSCAN } from "../../lib/virtualization";

export interface VirtualListProps<T> {
  /** The full (unwindowed) row list — only a slice around the visible
   * viewport is ever mounted. */
  items: readonly T[];
  /** Fixed height, in px, every row is assumed to render at. Fixed-height
   * virtualization needs no measurement pass, which is why this is a
   * required prop rather than something inferred at runtime. */
  rowHeight: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
  style?: CSSProperties;
  role?: string;
  "aria-label"?: string;
  /** Passed straight through to the scrolling root — lets a consumer (or
   * an e2e spec) target the actual scrollable element directly. */
  "data-testid"?: string;
  /** Passed straight through to the scrolling root — `ExplorerTree`'s
   * Ctrl+V paste-to-import fires on whichever ancestor of the focused row
   * has a listener, same mechanism the non-virtualized `<ul>` root uses. */
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
}

export function VirtualList<T>({
  items,
  rowHeight,
  overscan = DEFAULT_OVERSCAN,
  renderRow,
  getKey,
  className,
  style,
  role,
  ...rest
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Scroll coalescing (§6.1.3): latest value lives in the ref (always
  // current for the next frame), state flips at most once per rAF.
  const scrollTopRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { startIndex, endIndex } = computeVirtualWindow(scrollTop, viewportHeight, rowHeight, items.length, overscan);
  const totalHeight = items.length * rowHeight;
  const windowed = items.slice(startIndex, endIndex);

  return (
    <ScrollArea
      ref={containerRef}
      className={className}
      style={{ height: "100%", ...style }}
      role={role}
      onScroll={(e) => {
        // TODO §6.1.3 (vercel-labs rerender-transitions): coalesce scroll
        // updates to one render per frame instead of one per scroll event.
        // The raw value lands in a ref immediately (always current), the
        // state that drives windowing flips inside rAF.
        scrollTopRef.current = e.currentTarget.scrollTop;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setScrollTop(scrollTopRef.current);
        });
      }}
      {...rest}
    >
      <div style={{ position: "relative", height: totalHeight }}>
        {windowed.map((item, i) => {
          const index = startIndex + i;
          return (
            <div key={getKey(item, index)} style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0, height: rowHeight }}>
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

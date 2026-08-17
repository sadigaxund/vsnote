/**
 * Pure fixed-row-height windowing math for `components/local/VirtualList.
 * tsx`. Deliberately knows nothing about trees (that's `lib/treeFlatten.
 * ts`'s job) or the DOM — just "N rows of a known height, a scroll
 * position, a viewport" — so vitest's default `node` environment can test
 * it directly, and so any future virtualized list (a flat search-results
 * list, a big table) can reuse it without pulling in tree semantics.
 */

/** Extra rows windowed in above/below the visible viewport so a fast
 * scroll or a keyboard focus move doesn't show a blank flash before the
 * next paint. */
export const DEFAULT_OVERSCAN = 8;

export interface VirtualWindow {
  /** Inclusive first index to render. */
  startIndex: number;
  /** Exclusive end index (i.e. render `[startIndex, endIndex)`). */
  endIndex: number;
}

/**
 * Given a scroll position and viewport height (both px) over `totalRows`
 * rows of `rowHeight` each, returns the `[startIndex, endIndex)` slice
 * that should actually be mounted, padded by `overscan` rows on each side
 * and clamped to `[0, totalRows]`.
 */
export function computeVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan: number = DEFAULT_OVERSCAN,
): VirtualWindow {
  if (totalRows <= 0 || rowHeight <= 0) return { startIndex: 0, endIndex: 0 };
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalRows, lastVisible + overscan);
  return { startIndex, endIndex };
}

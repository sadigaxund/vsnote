/**
 * Pure proportional-scroll math for the side-by-side Preview pane (R3-11).
 * "Scroll-synced by proportional position" (the task brief) means: whatever
 * fraction of the way DOWN one pane's scrollable content you've scrolled,
 * the other pane is scrolled to that same fraction — NOT a line-for-line or
 * pixel-for-pixel mapping (the two panes render totally different DOM: raw
 * source text on one side, a rendered `.mk-doc` tree on the other, with no
 * shared coordinate system to map exactly).
 *
 * Kept dependency-free of any DOM type (`Element`/`HTMLElement`) so it can
 * be unit-tested with plain numbers — `MarkdownPreviewPane.tsx` is the only
 * caller, reading `{scrollTop, scrollHeight, clientHeight}` off two real
 * elements (the CM6 `.cm-scroller` on one side, the preview's own scroll
 * container on the other) and feeding them through these two functions.
 */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** How far down `box` has been scrolled, as a fraction in [0, 1]. A box that
 * can't scroll at all (content fits, or a zero-height measurement before
 * layout settles) is defined as `0` — "not scrolled" is the only sensible
 * reading when there's no scroll range to divide by. */
export function scrollFraction(box: ScrollBox): number {
  const max = box.scrollHeight - box.clientHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, box.scrollTop / max));
}

/** The `scrollTop` that puts a box of the given (target) dimensions at
 * `fraction` of the way down — the inverse of `scrollFraction`, used to
 * apply a fraction READ from one pane onto the OTHER pane's own (different)
 * scroll range. Clamped to the target's own real range regardless of what
 * `fraction` is handed (defensive: a caller-computed fraction is already
 * clamped to [0,1] by `scrollFraction`, but this function's own contract
 * shouldn't depend on that). */
export function scrollTopForFraction(fraction: number, target: Omit<ScrollBox, "scrollTop">): number {
  const max = target.scrollHeight - target.clientHeight;
  if (max <= 0) return 0;
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  return clampedFraction * max;
}

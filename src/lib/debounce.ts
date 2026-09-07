/**
 * A tiny trailing-edge debounce, extracted as a pure/testable unit for
 * `MarkdownPreviewPane.tsx`'s ~150ms "re-render the static preview after the
 * user stops typing" behavior (R3-11). Deliberately NOT `lodash.debounce`
 * (or any dependency) — the whole thing is eight lines; see CLAUDE.md rule 3's
 * general bias against adding a package for something this small.
 *
 * `cancel()` matters for the calling component's unmount/path-change cleanup:
 * without it, a debounce fired just before a tab switch could still write a
 * stale render into a since-unmounted (or since-repurposed, given
 * `EditorPane`'s per-path component instances are NOT keyed/remounted here)
 * state setter.
 */
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel: () => void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = ((...args: Args) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  }) as Debounced<Args>;

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return debounced;
}

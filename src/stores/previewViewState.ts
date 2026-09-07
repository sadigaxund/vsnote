/**
 * The pure half of R3-11's per-tab Preview-pane view state.
 *
 * `useTabsStore`'s `togglePreview` is a one-line map over a pane's tabs,
 * but the store itself transitively imports `fs/client.ts`, which
 * instantiates lightning-fs on import and is therefore off limits to the
 * unit suite (`tests/unit/fsIsolation.test.ts`). Keeping the reducer here,
 * free of every import but a type, is what lets the behaviour be tested
 * directly instead of only through an end-to-end run.
 */
/** The only fields this reducer needs. Structural, and deliberately NOT an
 * import of `OpenTab` from `useTabsStore`: the isolation guard walks a
 * test's whole import graph, so even a type-only edge back to the store
 * would drag `fs/client.ts` into it again. */
export interface PreviewTogglableTab {
  readonly path: string;
  readonly previewOpen?: boolean;
}

/** Flips `previewOpen` on the tab at `path`, leaving every other tab and the array's order untouched. Returns the same array instance when nothing matches, so a caller can skip a state update. */
export function togglePreviewInTabs<T extends PreviewTogglableTab>(tabs: readonly T[], path: string): readonly T[] {
  if (!tabs.some((tab) => tab.path === path)) return tabs;
  return tabs.map((tab) => (tab.path === path ? { ...tab, previewOpen: !tab.previewOpen } : tab));
}

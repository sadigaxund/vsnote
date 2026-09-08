/**
 * R5-9b — the Markii extension page's "Render components in the Preview
 * pane" row (`useMarkiiExtensionSettingsStore.renderComponentsInPreview`).
 *
 * Component packs never render real components anywhere in this app (see
 * `packPlaceholderLogic.ts`'s module doc: no JS sandbox exists, so a pack's
 * component is always a labelled, unrendered placeholder — "not rendered").
 * That means this toggle can never honestly promise "your pack's real UI
 * shows up here" — nothing this app does could ever make that true. What IS
 * a real, honest difference `MarkdownPreviewPane.tsx` can make: whether a
 * pack directive in the Preview pane is recognized as a KNOWN pack
 * component at all. On, it renders `render.tsx`'s labelled
 * `PackComponentPlaceholder` ("pack/component — not rendered"). Off, the
 * pane is given no pack registry for that note at all, so the same
 * directive falls through to `@markii/react`'s generic, unlabelled
 * `.mk-unknown` "unknown directive" box — the Preview pane behaves as if it
 * had never heard of that pack, exactly what "don't render pack components
 * here" should mean for a surface that can only ever show a placeholder
 * either way.
 *
 * Pure and tiny on purpose so it's testable without mounting the React
 * component around it (`tests/unit/previewPacksLogic.test.ts`) — the
 * decision itself, not the JSX that consumes it, is what a removed-wiring
 * regression would actually break.
 */
export function packsForPreview<T>(renderComponentsInPreview: boolean, enabledPacks: readonly T[]): readonly T[] {
  return renderComponentsInPreview ? enabledPacks : [];
}

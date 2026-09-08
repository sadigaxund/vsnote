/**
 * The Markii extension page's virtual tab identity (R5-9), same pattern
 * and reasoning as `lib/settingsTab.ts`/`lib/sharedTab.ts` — split out so
 * `App.tsx` can reference the path/kind that opens the tab without a
 * static import of `components/ExtensionPage.tsx` itself (which stays
 * behind `EditorContent.tsx`'s existing `React.lazy` boundary).
 *
 * Not a real fs path — see `settingsTab.ts`'s doc for why an unprefixed
 * segment can never collide with a real vault file.
 *
 * One constant pair today (`extension/markii`, the only extension that
 * exists) rather than a generic `EXTENSION_TAB_PATH(id)` — see
 * `docs/ARCHITECTURE.md`'s new "extension model" section for the shape a
 * second extension's tab identity would take (almost certainly a small
 * function here instead of a lone constant, once there's a second value to
 * generalize FROM).
 */
export const MARKII_EXTENSION_TAB_PATH = "extension/markii";
export const MARKII_EXTENSION_TAB_NAME = "Markii";

/**
 * The Shared view's virtual tab identity (docs/PLAN-2026-09-05-refresh.md
 * §2) — same pattern and reasoning as `lib/settingsTab.ts`, split out so
 * `App.tsx` can reference the path/kind that opens the tab without a
 * static import of `components/SharedView.tsx` itself (which stays behind
 * `EditorContent.tsx`'s existing `React.lazy` boundary).
 *
 * Not a real fs path — see `settingsTab.ts`'s doc for why an unprefixed
 * segment can never collide with a real vault file.
 */
export const SHARED_TAB_PATH = "shared";
export const SHARED_TAB_NAME = "Shared";

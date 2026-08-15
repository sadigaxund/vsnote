/**
 * The Settings view's virtual tab identity (Phase 6.5c, DESIGN-SPEC
 * Amendments item 11: "Open Settings as a TAB in the editor area"). A tiny,
 * dependency-free module deliberately split out of `components/SettingsView.tsx`
 * so `App.tsx` can reference the path/kind that opens the tab WITHOUT a
 * static import of that component itself — `SettingsView` pulls in
 * `Select`/`Slider`/`Switch`/`RadioGroup`/`DataList`/etc. and several fs/git
 * modules, all of which stay lazy (`EditorContent.tsx`'s existing
 * `React.lazy` pattern for every Rendered-mode renderer) exactly because
 * nothing outside that lazy boundary imports it directly.
 *
 * Not a real fs path — `vault/`-prefixed paths are the only ones any
 * `fs/`/`git/` call ever receives (see `fs/paths.ts`), so a single,
 * unprefixed segment can never collide with a real vault file and is a
 * visible tell (in `data-tab-path`, breadcrumbs, etc.) that this tab is a
 * view, not a document.
 */
export const SETTINGS_TAB_PATH = "settings";
export const SETTINGS_TAB_NAME = "Settings";

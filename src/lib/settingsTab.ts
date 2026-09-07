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

/**
 * Ctrl+, / Cmd+, ("open Settings and focus its search field") — the global
 * shortcut handler (`App.tsx`) opens/focuses the Settings tab and then
 * calls `requestSettingsSearchFocus()`; `SettingsView.tsx` is the only
 * consumer of `consumePendingSettingsSearchFocus`/the event below. A plain
 * module-level flag + a `window` `CustomEvent` (not a store) because this
 * is a one-shot imperative request ("focus this field now"), not state
 * anything renders from — and it has to work whether `SettingsView` is
 * already mounted (event listener fires) or is about to lazy-mount for the
 * first time (the flag is read once on mount, since the event obviously
 * fires before a not-yet-mounted component could ever add a listener for
 * it).
 */
export const SETTINGS_FOCUS_SEARCH_EVENT = "vsnote:settings-focus-search";
let pendingSettingsSearchFocus = false;

export function requestSettingsSearchFocus(): void {
  pendingSettingsSearchFocus = true;
  window.dispatchEvent(new CustomEvent(SETTINGS_FOCUS_SEARCH_EVENT));
}

/** Reads and clears the pending-focus flag — call once, on mount. */
export function consumePendingSettingsSearchFocus(): boolean {
  const had = pendingSettingsSearchFocus;
  pendingSettingsSearchFocus = false;
  return had;
}

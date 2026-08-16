/**
 * User settings, persisted to localStorage. The Settings dialog that edits
 * these is Phase 5a (DESIGN-SPEC "Misc / settings"); the store exists since
 * Phase 3, with sensible defaults matching the current shell, so Phase 5a
 * only had to build UI over it rather than invent the shape.
 *
 * `theme`/`accent` are DOM side effects, not just data — `applyDomSettings`
 * (this module) pushes them onto `<html>` per `src/theme.css`'s "Phase 5a"
 * block and `skills/SKILL.md`'s documented mechanism
 * (`document.documentElement.dataset.theme` / inline `--color-primary`).
 * `main.tsx` calls `applyDomSettings(useSettingsStore.getState())` once
 * before the first render (so boot never flashes unstyled/default-themed
 * chrome) and subscribes for every later change (Settings dialog edits,
 * command-palette "Toggle theme").
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultDeviceName } from "../git/commitTemplate";
import type { EditorMode, FileKind } from "../types";

export const THEME_OPTIONS = [
  "dark",
  "default",
  "neon",
  "contrast",
  "glass",
  "comic",
  "brutal",
  "stark",
  "frosted",
  "metallic",
] as const;

export type AppTheme = (typeof THEME_OPTIONS)[number];

/** The store's own `editorFontSize` default, exported so any *other*
 * surface that reads this setting (`editor/LivePreviewEditor.tsx`'s
 * rendered-typography scaling) can treat it as "no adjustment" without
 * duplicating the literal `13` in two files. */
export const DEFAULT_EDITOR_FONT_SIZE = 13;

/** DESIGN-SPEC Amendments round 3 item 23 ("Density must be real"): three
 * real tiers now, not two — `"default"` is the pixel-sampled baseline
 * every phase before this one hardcoded unconditionally (see
 * `theme.css`'s density block), `"compact"`/`"comfortable"` scale every
 * chrome band, row/tab padding, and icon gap down/up from it. Before this
 * phase the store's only two values were `"comfortable"` (the actual
 * DEFAULT, despite its name — it rendered exactly today's `"default"`
 * pixels) and `"compact"`; `migrate` below carries a persisted
 * `"comfortable"` forward to `"default"` so an existing session's
 * literal-string value keeps meaning "the pixels I've always seen" instead
 * of silently becoming the NEW, genuinely-larger `"comfortable"` tier. */
export type UiDensity = "compact" | "default" | "comfortable";

/** Phase 6.5c (DESIGN-SPEC Amendments item 11, "Rendered view" category) —
 * every default matches the exact hardcoded value the pre-6.5c static
 * `EditorView.theme()` blocks used (`editor/theme.ts`'s `.cm-scroller`
 * `lineHeight: "1.6"`, `editor/livepreview/theme.ts`'s `.cm-content`
 * `maxWidth: "54ch"` / `padding: "56px 32px 160px"` / `.cm-scroller`
 * `lineHeight: "1.8"`), so an unconfigured fresh boot stays pixel-identical
 * to every phase before this one — the same discipline
 * `DEFAULT_EDITOR_FONT_SIZE`/`renderedFontSize` already established. Those
 * two theme files no longer hardcode these properties at all (single
 * source now: the settings-driven CM6 `Compartment`s in
 * `editor/baseExtensions.ts`/`editor/LivePreviewEditor.tsx`), so there's no
 * "two `EditorView.theme()` calls fight over the same property" precedence
 * question to resolve (ARCHITECTURE.md's Deviations note on
 * `fontSizeCompartment`'s `Prec.highest` requirement doesn't recur here). */
export const DEFAULT_EDITOR_LINE_SPACING = 1.6;
export const DEFAULT_RENDERED_CONTENT_WIDTH_CH = 54;
/** DESIGN-SPEC Amendments round 4 item 25: the content-max-width slider's
 * TOP position no longer clamps to a ch value at all — it removes the
 * `max-width` cap entirely so the reading column spans the whole editor
 * area. Persisted as this sentinel (not a real ch value; the slider's
 * actual range is 40-100) so `renderedContentWidth` stays a plain `number`
 * end-to-end — no new "mode" field, no union type, `LivePreviewEditor.tsx`
 * just checks for this one value and emits `maxWidth: "none"` instead of a
 * `ch` string. */
export const RENDERED_CONTENT_WIDTH_FULL = -1;
export const DEFAULT_RENDERED_MARGIN_PX = 32;
export const DEFAULT_RENDERED_LINE_SPACING = 1.8;
export const DEFAULT_SIDEBAR_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 180;
/** DESIGN-SPEC Amendments round 3 item 20: dragging the sidebar's right
 * edge below this snaps it to a fully collapsed (zero-width) state instead
 * of leaving a "half-dead sliver" partway between 0 and `MIN_SIDEBAR_WIDTH`
 * — there is no reachable width between 0 and `MIN_SIDEBAR_WIDTH` at all. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 120;
/** Sensible max — DESIGN-SPEC Amendments item 10 says "~50vw"; applied at
 * drag time (`Sidebar.tsx`) against the live viewport width, this is just
 * the fallback used the one time a width needs clamping before any viewport
 * measurement exists (SSR-less here, but keeps the type honest). */
export const MAX_SIDEBAR_WIDTH_FALLBACK = 640;

interface SettingsState {
  theme: AppTheme;
  accent: string;
  editorFontSize: number;
  tabSize: number;
  wordWrap: boolean;
  /** Default mode to lock a file type to when "reading view" is on. */
  readingViewDefaultMode: Partial<Record<FileKind, EditorMode>>;

  /** Appearance category — UI density (DESIGN-SPEC Amendments item 11).
   * Drives `[data-ui-density]` on `<html>` (`applyDomSettings` below),
   * consumed by `theme.css`'s `--app-density-*` tokens (tree row / tab
   * horizontal padding — NOT the amendment-3 chrome-height tokens, which
   * stay fixed regardless of density). */
  uiDensity: UiDensity;

  /** Editor category — Source/Diff CM6 line height (a plain multiplier,
   * matching `.cm-scroller`'s CSS `line-height` unit). */
  editorLineSpacing: number;

  /** Rendered view category — live-preview content column width (ch),
   * left/right margin (px), and line height (multiplier). */
  renderedContentWidth: number;
  renderedMargin: number;
  renderedLineSpacing: number;

  /** Explorer sidebar width in px (DESIGN-SPEC Amendments item 10) — the
   * width to RESTORE to when expanded; unaffected by `sidebarCollapsed`
   * (collapsing never zeroes this out, so re-expanding lands back at
   * whatever the user last dragged it to). */
  sidebarWidth: number;

  /** DESIGN-SPEC Amendments round 3 item 20 ("Sidebar collapse/expand") —
   * whether the currently-active side panel (Explorer/Search/Source
   * Control) is collapsed to zero width. Persisted alongside
   * `sidebarWidth` via the same `persist` mechanism so a collapsed sidebar
   * stays collapsed across a reload. */
  sidebarCollapsed: boolean;

  /** Git & Sync category (Phase 11 — real sync). `gitAuthToken` has no
   * sensible default (a Phase 9 API token, scoped `write` for push —
   * mintable from this same Settings view's "Sharing" category once signed
   * in, or via `POST /api/auth/tokens`); read directly by
   * `src/git/remote.ts`'s real push/pull/fetch (via `useGitStore`). HTTPS +
   * token only, deliberately no SSH-key field: browsers can't speak raw
   * TCP/SSH. There is no `gitRemoteUrl` setting anymore (Phase 10.5a,
   * roadmap §5.4): the sync remote is implicitly `<origin>/git/vault.git` —
   * see `git/remote.ts`'s `computeGitRemoteUrl`. A pre-Phase-10.5a session's
   * persisted `gitRemoteUrl` value (if any) is simply ignored: it's not
   * part of this interface anymore, so zustand's `persist` rehydration
   * leaves it as an inert, unread key on the persisted blob rather than
   * erroring or overwriting anything real. */
  gitAuthToken: string;

  /** Phase 11 (real sync, roadmap §5.3) — "Default commit message"
   * template. Rendered by `git/commitTemplate.ts::renderCommitTemplate`
   * (`{device}`/`{timestamp}`/`{date}`/`{time}`/`{files}`/`{branch}`;
   * unknown `{vars}` pass through literally, never error) to prefill the
   * Source Control commit box (`SourceControlPanel.tsx`, editable
   * per-commit) and to compose one-click Sync's auto-commit AND merge
   * commit messages (`useGitStore.ts`'s `syncNow`, `git/sync.ts`'s
   * `runSync`/`resolveConflictAndPush`). */
  gitCommitTemplate: string;
  /** The `{device}` template variable's own SETTING — auto-defaulted from
   * the UA at store-init time (`defaultDeviceName()`, since browsers can't
   * read a real hostname — roadmap §5.3's own reasoning) and user-editable
   * from then on, exactly like every other persisted setting here. */
  gitDeviceName: string;

  setTheme: (theme: AppTheme) => void;
  /** Cycles to the next theme in `THEME_OPTIONS` — the command palette's
   * "Toggle theme" command (DESIGN-SPEC "Misc / settings": "toggle mode,
   * theme, sync, new file…"). */
  cycleTheme: () => void;
  setAccent: (accent: string) => void;
  setEditorFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setReadingViewDefaultMode: (kind: FileKind, mode: EditorMode | undefined) => void;
  setUiDensity: (density: UiDensity) => void;
  setEditorLineSpacing: (spacing: number) => void;
  setRenderedContentWidth: (widthCh: number) => void;
  setRenderedMargin: (marginPx: number) => void;
  setRenderedLineSpacing: (spacing: number) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setGitAuthToken: (token: string) => void;
  setGitCommitTemplate: (template: string) => void;
  setGitDeviceName: (name: string) => void;
}

/** Roadmap §5.3's exact default template string. Exported so
 * `SettingsView.tsx`'s "Reset to default" affordance (if it ever wants
 * one) and tests both reference the same literal rather than duplicating
 * it. */
export const DEFAULT_GIT_COMMIT_TEMPLATE = "Synced from {device}: {timestamp}";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      accent: "#27d2c5",
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      tabSize: 2,
      wordWrap: true,
      readingViewDefaultMode: {},
      uiDensity: "default",
      editorLineSpacing: DEFAULT_EDITOR_LINE_SPACING,
      renderedContentWidth: DEFAULT_RENDERED_CONTENT_WIDTH_CH,
      renderedMargin: DEFAULT_RENDERED_MARGIN_PX,
      renderedLineSpacing: DEFAULT_RENDERED_LINE_SPACING,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarCollapsed: false,
      gitAuthToken: "",
      gitCommitTemplate: DEFAULT_GIT_COMMIT_TEMPLATE,
      gitDeviceName: defaultDeviceName(),
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => {
        const idx = THEME_OPTIONS.indexOf(get().theme);
        set({ theme: THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length] });
      },
      setAccent: (accent) => set({ accent }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setTabSize: (tabSize) => set({ tabSize }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
      setReadingViewDefaultMode: (kind, mode) =>
        set((state) => {
          const next = { ...state.readingViewDefaultMode };
          if (mode) next[kind] = mode;
          else delete next[kind];
          return { readingViewDefaultMode: next };
        }),
      setUiDensity: (uiDensity) => set({ uiDensity }),
      setEditorLineSpacing: (editorLineSpacing) => set({ editorLineSpacing }),
      setRenderedContentWidth: (renderedContentWidth) => set({ renderedContentWidth }),
      setRenderedMargin: (renderedMargin) => set({ renderedMargin }),
      setRenderedLineSpacing: (renderedLineSpacing) => set({ renderedLineSpacing }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setGitAuthToken: (gitAuthToken) => set({ gitAuthToken }),
      setGitCommitTemplate: (gitCommitTemplate) => set({ gitCommitTemplate }),
      setGitDeviceName: (gitDeviceName) => set({ gitDeviceName }),
    }),
    {
      // Renamed with the rest of the rebrand (DESIGN-SPEC item 34, user
      // decision 2026-08-17) — no migration: a pre-rename session's settings
      // are not read anymore and every value falls back to its default.
      name: "vsnote-settings",
      // v1 (Phase 8, DESIGN-SPEC Amendments round 3 item 23): a persisted
      // pre-Phase-8 session's `uiDensity: "comfortable"` meant "the
      // pixel-sampled baseline" (the only non-compact value that ever
      // existed), not the NEW, genuinely-roomier `"comfortable"` tier this
      // phase introduces — remap it to `"default"` so an existing user's
      // session keeps rendering the exact same pixels they had before this
      // upgrade rather than silently jumping to a taller chrome. Every
      // other persisted field is untouched (zustand's `persist` merges the
      // migrated partial over the store's own defaults for anything this
      // function doesn't return).
      //
      // v3 (Phase 10.5a, single-origin refactor, roadmap §5.4): removes
      // `gitRemoteUrl` and `shareBackendUrl` from this store entirely —
      // both are now implicit/relative to `window.location.origin` (see
      // `share/api.ts` and `git/remote.ts::computeGitRemoteUrl`), so there
      // is no longer a Settings field to persist either into. A returning
      // user's old persisted value for either key would otherwise just sit
      // there as inert, unread data forever (harmless — neither key is part
      // of `SettingsState` anymore, so nothing in the app ever reads it
      // back), but this migration deletes them outright for a clean
      // persisted blob rather than leaving stale fields around. This is a
      // pure cleanup step (deleting fields the current shape never reads),
      // not a functional migration like v1/v2 below, so it applies
      // unconditionally for `version < 3`, not gated on the old value.
      version: 3,
      migrate: (persisted, version) => {
        let state = persisted as (Partial<SettingsState> & { gitRemoteUrl?: string; shareBackendUrl?: string }) | undefined;
        if (version < 1 && state?.uiDensity === "comfortable") {
          state = { ...state, uiDensity: "default" };
        }
        if (version < 3 && state) {
          state = { ...state };
          delete state.gitRemoteUrl;
          delete state.shareBackendUrl;
        }
        return state;
      },
    },
  ),
);

/** Pushes `theme`/`accent`/`uiDensity` onto `<html>` — see this module's
 * header doc. `theme === "dark"` deliberately clears `data-theme` rather
 * than setting it to the literal string "dark": either matches
 * `theme.css`'s "VSNote default theme" selector (`:not([data-theme]),
 * [data-theme="dark"]`), but clearing it is the more honest boot-equivalent
 * state (no attribute is exactly what `index.html` ships before any
 * settings code has ever run). `uiDensity === "comfortable"` similarly
 * clears `data-ui-density` rather than writing the literal default, for the
 * same reason. */
export function applyDomSettings(state: Pick<SettingsState, "theme" | "accent" | "uiDensity">): void {
  const root = document.documentElement;
  if (state.theme === "dark") delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  root.style.setProperty("--color-primary", state.accent);
  root.style.setProperty("--color-ring", state.accent);
  // DESIGN-SPEC Amendments round 3 item 23: three real tiers now —
  // `"default"` clears the attribute (matching the bare `:root` block in
  // theme.css, the pixel-sampled baseline every phase before this one
  // hardcoded), `"compact"`/`"comfortable"` write the attribute their own
  // `:root[data-ui-density="..."]` block keys off.
  if (state.uiDensity === "default") delete root.dataset.uiDensity;
  else root.dataset.uiDensity = state.uiDensity;
}

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

export type SlateTheme = (typeof THEME_OPTIONS)[number];

/** The store's own `editorFontSize` default, exported so any *other*
 * surface that reads this setting (`editor/LivePreviewEditor.tsx`'s
 * rendered-typography scaling) can treat it as "no adjustment" without
 * duplicating the literal `13` in two files. */
export const DEFAULT_EDITOR_FONT_SIZE = 13;

export type UiDensity = "comfortable" | "compact";

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
export const DEFAULT_RENDERED_MARGIN_PX = 32;
export const DEFAULT_RENDERED_LINE_SPACING = 1.8;
export const DEFAULT_SIDEBAR_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 180;
/** Sensible max — DESIGN-SPEC Amendments item 10 says "~50vw"; applied at
 * drag time (`Sidebar.tsx`) against the live viewport width, this is just
 * the fallback used the one time a width needs clamping before any viewport
 * measurement exists (SSR-less here, but keeps the type honest). */
export const MAX_SIDEBAR_WIDTH_FALLBACK = 640;

interface SettingsState {
  theme: SlateTheme;
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

  /** Explorer sidebar width in px (DESIGN-SPEC Amendments item 10). */
  sidebarWidth: number;

  /** Git & Sync category — "Remote sync — coming soon" placeholders
   * (DESIGN-SPEC Amendments item 11): stored so the fields aren't stateless
   * dead controls, but the inputs themselves render `disabled` and nothing
   * reads these for real sync (no v2 backend yet — see
   * docs/ROADMAP-SHARING-AUTH.md). HTTPS + token only, deliberately no
   * SSH-key field: browsers can't speak raw TCP/SSH. */
  gitRemoteUrl: string;
  gitAuthToken: string;

  setTheme: (theme: SlateTheme) => void;
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
  setGitRemoteUrl: (url: string) => void;
  setGitAuthToken: (token: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      accent: "#27d2c5",
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      tabSize: 2,
      wordWrap: true,
      readingViewDefaultMode: {},
      uiDensity: "comfortable",
      editorLineSpacing: DEFAULT_EDITOR_LINE_SPACING,
      renderedContentWidth: DEFAULT_RENDERED_CONTENT_WIDTH_CH,
      renderedMargin: DEFAULT_RENDERED_MARGIN_PX,
      renderedLineSpacing: DEFAULT_RENDERED_LINE_SPACING,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      gitRemoteUrl: "",
      gitAuthToken: "",
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
      setGitRemoteUrl: (gitRemoteUrl) => set({ gitRemoteUrl }),
      setGitAuthToken: (gitAuthToken) => set({ gitAuthToken }),
    }),
    { name: "slate-settings" },
  ),
);

/** Pushes `theme`/`accent`/`uiDensity` onto `<html>` — see this module's
 * header doc. `theme === "dark"` deliberately clears `data-theme` rather
 * than setting it to the literal string "dark": either matches
 * `theme.css`'s "Slate default theme" selector (`:not([data-theme]),
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
  if (state.uiDensity === "compact") root.dataset.uiDensity = "compact";
  else delete root.dataset.uiDensity;
}

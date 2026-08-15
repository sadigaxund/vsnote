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

interface SettingsState {
  theme: SlateTheme;
  accent: string;
  editorFontSize: number;
  tabSize: number;
  wordWrap: boolean;
  /** Default mode to lock a file type to when "reading view" is on. */
  readingViewDefaultMode: Partial<Record<FileKind, EditorMode>>;
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
    }),
    { name: "slate-settings" },
  ),
);

/** Pushes `theme`/`accent` onto `<html>` — see this module's header doc.
 * `theme === "dark"` deliberately clears `data-theme` rather than setting
 * it to the literal string "dark": either matches `theme.css`'s "Slate
 * default theme" selector (`:not([data-theme]), [data-theme="dark"]`), but
 * clearing it is the more honest boot-equivalent state (no attribute is
 * exactly what `index.html` ships before any settings code has ever run). */
export function applyDomSettings(state: Pick<SettingsState, "theme" | "accent">): void {
  const root = document.documentElement;
  if (state.theme === "dark") delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  root.style.setProperty("--color-primary", state.accent);
  root.style.setProperty("--color-ring", state.accent);
}

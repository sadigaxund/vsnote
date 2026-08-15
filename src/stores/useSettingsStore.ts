/**
 * User settings, persisted to localStorage. The Settings dialog that edits
 * these is Phase 5 (DESIGN-SPEC "Misc / settings"); the store exists now,
 * with sensible defaults matching the current shell, so Phase 5 only has
 * to build UI over it rather than invent the shape.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorMode } from "../types";

interface SettingsState {
  theme: "default" | "dark" | "neon" | "contrast" | "glass" | "comic" | "brutal" | "stark" | "frosted" | "metallic";
  accent: string;
  editorFontSize: number;
  tabSize: number;
  wordWrap: boolean;
  /** Default mode to lock a file type to when "reading view" is on. */
  readingViewDefaultMode: Partial<Record<string, EditorMode>>;
  setTheme: (theme: SettingsState["theme"]) => void;
  setAccent: (accent: string) => void;
  setEditorFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      accent: "#27d2c5",
      editorFontSize: 13,
      tabSize: 2,
      wordWrap: true,
      readingViewDefaultMode: {},
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setTabSize: (tabSize) => set({ tabSize }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
    }),
    { name: "slate-settings" },
  ),
);

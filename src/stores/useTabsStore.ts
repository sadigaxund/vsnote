/**
 * Tab *view* state — which files are open, in what order, which is active,
 * each tab's mode and preview/pinned flags. Deliberately namespaced under
 * `panes: Record<paneId, PaneState>` rather than one flat tab list, per the
 * Phase 6 design note in DESIGN-SPEC's Amendments item 8: a future grid
 * split view needs one independent tab strip per pane. Phase 2 has exactly
 * one pane (`"root"`), but the shape doesn't hardcode that — Phase 6 adds
 * more entries to `panes` without a migration.
 *
 * Content itself (buffer/draft/dirty) is NOT here — see `useBufferStore`,
 * shared across every pane that has a given path open.
 *
 * Persisted to localStorage (DESIGN-SPEC Amendments item 6: "open tabs +
 * order + active tab + per-tab mode + pinned/preview state" survive
 * reload).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorMode, FileKind } from "../types";

export interface OpenTab {
  /** Display path — doubles as the tab id. */
  path: string;
  name: string;
  kind: FileKind;
  mode: EditorMode;
  /** Single-click preview tab (replaced by the next preview open). */
  preview: boolean;
  /** Double-click/edit pinned it — survives the next preview open. */
  pinned: boolean;
}

export interface PaneState {
  id: string;
  tabs: OpenTab[];
  activeTabId?: string;
}

const ROOT_PANE_ID = "root";

function defaultModeFor(kind: FileKind): EditorMode {
  return kind === "md" ? "rendered" : "source";
}

function emptyPane(id: string): PaneState {
  return { id, tabs: [], activeTabId: undefined };
}

interface OpenFileInput {
  path: string;
  name: string;
  kind: FileKind;
}

interface TabsStoreState {
  panes: Record<string, PaneState>;
  activePaneId: string;

  /** Opens `file` in the active pane. `pin: true` = double-click/edit
   * (permanent tab); otherwise it's a single-click preview tab that the
   * next preview open replaces. */
  openFile: (file: OpenFileInput, opts?: { pin?: boolean }) => void;
  pinTab: (path: string, paneId?: string) => void;
  closeTab: (path: string, paneId?: string) => void;
  setActiveTab: (path: string, paneId?: string) => void;
  setMode: (path: string, mode: EditorMode, paneId?: string) => void;
  reorderTab: (fromIndex: number, toIndex: number, paneId?: string) => void;
  /** Remaps every open tab whose path is `oldPrefix` or starts with
   * `oldPrefix/` to the equivalent path under `newPrefix` — used after a
   * file/folder rename or drag-move so open tabs follow the file. */
  renamePrefix: (oldPrefix: string, newPrefix: string) => void;
  /** Closes every tab whose path is `prefix` or starts with `prefix/` —
   * used after a delete. */
  closeByPrefix: (prefix: string) => void;
  activePane: () => PaneState;
}

function remapPath(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return newPrefix + path.slice(oldPrefix.length);
  return path;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export const useTabsStore = create<TabsStoreState>()(
  persist(
    (set, get) => ({
      panes: { [ROOT_PANE_ID]: emptyPane(ROOT_PANE_ID) },
      activePaneId: ROOT_PANE_ID,

      activePane: () => get().panes[get().activePaneId] ?? emptyPane(ROOT_PANE_ID),

      openFile: (file, opts) => {
        const paneId = get().activePaneId;
        set((state) => {
          const pane = state.panes[paneId] ?? emptyPane(paneId);
          const pin = !!opts?.pin;
          const existing = pane.tabs.find((t) => t.path === file.path);
          let tabs: OpenTab[];
          if (existing) {
            tabs = pin
              ? pane.tabs.map((t) => (t.path === file.path ? { ...t, preview: false, pinned: true } : t))
              : pane.tabs;
          } else {
            const newTab: OpenTab = {
              path: file.path,
              name: file.name,
              kind: file.kind,
              mode: defaultModeFor(file.kind),
              preview: !pin,
              pinned: pin,
            };
            // A preview tab replaces any existing preview tab (VSCode
            // single-preview-slot behavior); pinned opens just append.
            const base = pin ? pane.tabs : pane.tabs.filter((t) => !t.preview);
            tabs = [...base, newTab];
          }
          return {
            panes: { ...state.panes, [paneId]: { ...pane, tabs, activeTabId: file.path } },
          };
        });
      },

      pinTab: (path, paneId) => {
        const id = paneId ?? get().activePaneId;
        set((state) => {
          const pane = state.panes[id];
          if (!pane) return state;
          return {
            panes: {
              ...state.panes,
              [id]: {
                ...pane,
                tabs: pane.tabs.map((t) => (t.path === path ? { ...t, preview: false, pinned: true } : t)),
              },
            },
          };
        });
      },

      closeTab: (path, paneId) => {
        const id = paneId ?? get().activePaneId;
        set((state) => {
          const pane = state.panes[id];
          if (!pane) return state;
          const closingIndex = pane.tabs.findIndex((t) => t.path === path);
          const tabs = pane.tabs.filter((t) => t.path !== path);
          let activeTabId = pane.activeTabId;
          if (activeTabId === path) {
            const neighbor = tabs[closingIndex] ?? tabs[closingIndex - 1];
            activeTabId = neighbor?.path;
          }
          return { panes: { ...state.panes, [id]: { ...pane, tabs, activeTabId } } };
        });
      },

      setActiveTab: (path, paneId) => {
        const id = paneId ?? get().activePaneId;
        set((state) => {
          const pane = state.panes[id];
          if (!pane) return state;
          return { panes: { ...state.panes, [id]: { ...pane, activeTabId: path } } };
        });
      },

      setMode: (path, mode, paneId) => {
        const id = paneId ?? get().activePaneId;
        set((state) => {
          const pane = state.panes[id];
          if (!pane) return state;
          return {
            panes: {
              ...state.panes,
              [id]: { ...pane, tabs: pane.tabs.map((t) => (t.path === path ? { ...t, mode } : t)) },
            },
          };
        });
      },

      reorderTab: (fromIndex, toIndex, paneId) => {
        const id = paneId ?? get().activePaneId;
        set((state) => {
          const pane = state.panes[id];
          if (!pane) return state;
          const tabs = pane.tabs.slice();
          const [moved] = tabs.splice(fromIndex, 1);
          if (!moved) return state;
          tabs.splice(toIndex, 0, moved);
          return { panes: { ...state.panes, [id]: { ...pane, tabs } } };
        });
      },

      renamePrefix: (oldPrefix, newPrefix) => {
        set((state) => {
          const panes: Record<string, PaneState> = {};
          for (const [id, pane] of Object.entries(state.panes)) {
            panes[id] = {
              ...pane,
              tabs: pane.tabs.map((t) =>
                matchesPrefix(t.path, oldPrefix)
                  ? { ...t, path: remapPath(t.path, oldPrefix, newPrefix), name: remapPath(t.path, oldPrefix, newPrefix).split("/").pop()! }
                  : t,
              ),
              activeTabId:
                pane.activeTabId && matchesPrefix(pane.activeTabId, oldPrefix)
                  ? remapPath(pane.activeTabId, oldPrefix, newPrefix)
                  : pane.activeTabId,
            };
          }
          return { panes };
        });
      },

      closeByPrefix: (prefix) => {
        set((state) => {
          const panes: Record<string, PaneState> = {};
          for (const [id, pane] of Object.entries(state.panes)) {
            const tabs = pane.tabs.filter((t) => !matchesPrefix(t.path, prefix));
            const activeTabId =
              pane.activeTabId && matchesPrefix(pane.activeTabId, prefix) ? tabs[tabs.length - 1]?.path : pane.activeTabId;
            panes[id] = { ...pane, tabs, activeTabId };
          }
          return { panes };
        });
      },
    }),
    { name: "slate-tabs" },
  ),
);

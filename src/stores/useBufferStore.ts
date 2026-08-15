/**
 * The content model — one buffer per file path, shared by every view of
 * that file. Deliberately split out of `useTabsStore` (which owns *view*
 * state: which tabs are open, in what order, which is active, per-tab
 * mode) per the Phase 6 design note in DESIGN-SPEC's Amendments item 8: a
 * future grid split view can open the same file in two panes at once, and
 * both panes must read/write the SAME draft rather than owning independent
 * copies that could diverge. Phase 2 only ever has one pane, but nothing
 * here assumes that.
 *
 * A buffer's `content` is the live editable value (what the crude textarea
 * binds to this phase, CodeMirror in Phase 3); `dirty` is true whenever it
 * differs from the last-saved-to-fs content. Every edit is checkpointed to
 * IndexedDB via `fs/drafts.ts` (debounced ~300ms) so a reload never loses
 * unsaved work — see DESIGN-SPEC Amendments item 6.
 */
import { create } from "zustand";
import { pathExists, readTextFile, writeFile } from "../fs/operations";
import { clearDraft, loadDraft, scheduleDraftSave } from "../fs/drafts";
import { displayToFsPath } from "../fs/paths";

export interface BufferState {
  /** Display path, e.g. `vault/notes/architecture.md`. */
  path: string;
  /** Current editable content. */
  content: string;
  /** Last content written to fs (or loaded from fs if never edited). */
  savedContent: string;
  dirty: boolean;
  /** True once the initial fs (+ draft override) load has completed. */
  loaded: boolean;
  /** The file no longer exists on disk (e.g. git-deleted working tree). */
  missing: boolean;
}

interface BufferStoreState {
  buffers: Record<string, BufferState>;
  /** Ensures a buffer exists for `path`, loading fs content (and any
   * pending draft checkpoint, which wins over the on-disk content) at most
   * once per path. Safe to call repeatedly (e.g. every tab open). */
  ensureLoaded: (path: string) => Promise<void>;
  /** Updates live content, marks dirty, and schedules a draft checkpoint. */
  setContent: (path: string, content: string) => void;
  /** Writes the buffer to fs, clears dirty + the draft checkpoint. */
  save: (path: string) => Promise<void>;
  /** Reverts unsaved edits back to the last-saved fs content. */
  discard: (path: string) => void;
  /** Drops a path's entry entirely (e.g. after a delete). */
  forget: (path: string) => void;
  /** Renames a buffer's key in place (used by the fs move/rename op). */
  rekey: (fromPath: string, toPath: string) => void;
  /** Rekeys every buffer at or under `oldPrefix` (a folder rename/move
   * carries its descendants' open buffers with it). */
  rekeyPrefix: (oldPrefix: string, newPrefix: string) => void;
  /** Drops every buffer at or under `prefix` (e.g. after deleting a folder). */
  forgetPrefix: (prefix: string) => void;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function remapPath(path: string, oldPrefix: string, newPrefix: string): string {
  return path === oldPrefix ? newPrefix : newPrefix + path.slice(oldPrefix.length);
}

export const useBufferStore = create<BufferStoreState>((set, get) => ({
  buffers: {},

  ensureLoaded: async (path) => {
    if (get().buffers[path]?.loaded) return;
    const fsPath = displayToFsPath(path);
    const exists = await pathExists(fsPath);
    const savedContent = exists ? await readTextFile(fsPath) : "";
    const draft = await loadDraft(path);
    const hasDraft = draft !== undefined && draft !== savedContent;
    set((state) => ({
      buffers: {
        ...state.buffers,
        [path]: {
          path,
          content: hasDraft ? draft : savedContent,
          savedContent,
          dirty: hasDraft,
          loaded: true,
          missing: !exists,
        },
      },
    }));
  },

  setContent: (path, content) => {
    set((state) => {
      const existing = state.buffers[path];
      const savedContent = existing?.savedContent ?? "";
      const dirty = content !== savedContent;
      return {
        buffers: {
          ...state.buffers,
          [path]: {
            path,
            content,
            savedContent,
            dirty,
            loaded: true,
            missing: existing?.missing ?? false,
          },
        },
      };
    });
    scheduleDraftSave(path, content);
  },

  save: async (path) => {
    const buffer = get().buffers[path];
    if (!buffer) return;
    await writeFile(displayToFsPath(path), buffer.content);
    await clearDraft(path);
    set((state) => ({
      buffers: {
        ...state.buffers,
        [path]: { ...buffer, savedContent: buffer.content, dirty: false, missing: false },
      },
    }));
  },

  discard: (path) => {
    const buffer = get().buffers[path];
    if (!buffer) return;
    void clearDraft(path);
    set((state) => ({
      buffers: {
        ...state.buffers,
        [path]: { ...buffer, content: buffer.savedContent, dirty: false },
      },
    }));
  },

  forget: (path) => {
    void clearDraft(path);
    set((state) => {
      const next = { ...state.buffers };
      delete next[path];
      return { buffers: next };
    });
  },

  rekey: (fromPath, toPath) => {
    set((state) => {
      const existing = state.buffers[fromPath];
      if (!existing) return state;
      const next = { ...state.buffers };
      delete next[fromPath];
      next[toPath] = { ...existing, path: toPath };
      return { buffers: next };
    });
  },

  rekeyPrefix: (oldPrefix, newPrefix) => {
    set((state) => {
      const next: Record<string, BufferState> = {};
      for (const [path, buf] of Object.entries(state.buffers)) {
        if (matchesPrefix(path, oldPrefix)) {
          const remapped = remapPath(path, oldPrefix, newPrefix);
          next[remapped] = { ...buf, path: remapped };
        } else {
          next[path] = buf;
        }
      }
      return { buffers: next };
    });
  },

  forgetPrefix: (prefix) => {
    set((state) => {
      const next: Record<string, BufferState> = {};
      for (const [path, buf] of Object.entries(state.buffers)) {
        if (matchesPrefix(path, prefix)) {
          void clearDraft(path);
        } else {
          next[path] = buf;
        }
      }
      return { buffers: next };
    });
  },
}));

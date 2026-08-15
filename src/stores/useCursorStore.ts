/**
 * Per-pane cursor (Ln/Col) position — DESIGN-SPEC Amendments item 16
 * (typing-latency bug) fix. This is a HIGH-FREQUENCY value: every keystroke
 * and every selection change in a CM6 view fires an update, including in
 * Rendered mode (the live-preview editor is a real CM6 `EditorView` too —
 * see `editor/LivePreviewEditor.tsx`'s `updateListener`).
 *
 * Before this fix, the position was lifted into `App.tsx`'s own `useState`
 * (`cursorByPane`) and threaded down through `EditorArea`/`EditorPane`'s
 * `onCursorChange` prop — so every keystroke, in every mode including
 * Rendered (where the value isn't even displayed — the status bar only
 * shows it for Source/Diff, see `StatusBar.tsx`), called `setState` on
 * `App`, which re-rendered the ENTIRE shell (Sidebar's file tree,
 * ActivityBar, every mounted `EditorPane`, the tab bars, everything) once
 * per keystroke. Confirmed via a render-count probe (`lib/renderProbe.ts`)
 * before this fix: `App`'s render count tracked 1:1 with keystrokes typed
 * in a 1k-line Rendered-mode document — see ARCHITECTURE.md's Deviations
 * entry for the exact before/after numbers.
 *
 * Fix: cursor position lives in its own tiny store, written to directly by
 * `EditorPane` (which already knows its own `paneId`, no prop drilling
 * needed) instead of bubbling up through a callback prop into `App`. The
 * status bar (`StatusBar.tsx`) subscribes to exactly `byPane[activePaneId]`
 * — a targeted selector — so only that one small component re-renders when
 * the caret moves; `App` and everything else never sees it. `setCursor`
 * also short-circuits when the position is unchanged (e.g. a docChanged
 * event that didn't move the head, or repeated updates while a pane isn't
 * focused) so zustand's identity check doesn't even have a new object to
 * compare on every call.
 */
import { create } from "zustand";
import type { CursorPos } from "../editor/CodeMirrorEditor";

interface CursorStoreState {
  byPane: Record<string, CursorPos>;
  setCursor: (paneId: string, pos: CursorPos) => void;
}

export const useCursorStore = create<CursorStoreState>((set, get) => ({
  byPane: {},
  setCursor: (paneId, pos) => {
    const prev = get().byPane[paneId];
    if (prev && prev.line === pos.line && prev.column === pos.column) return;
    set((state) => ({ byPane: { ...state.byPane, [paneId]: pos } }));
  },
}));

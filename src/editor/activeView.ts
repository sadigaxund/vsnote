/**
 * Tracks whichever CM6 `EditorView` is currently mounted on screen, so
 * App.tsx's single global keydown handler (DESIGN-SPEC Amendments item 5)
 * can reach it without prop-drilling a view reference through
 * EditorContent/Sidebar/etc. This phase's shell has exactly one CM6 view
 * mounted at a time (Source mode's `CodeMirrorEditor`, or one pane of
 * Diff mode's `MergeView`/unified view) — Phase 6's multi-pane grid can
 * extend this to "the view in the focused pane" without changing the call
 * site in App.tsx.
 */
import type { EditorView } from "@codemirror/view";

let activeView: EditorView | null = null;

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view;
}

export function getActiveEditorView(): EditorView | null {
  return activeView;
}

/**
 * DESIGN-SPEC Amendments item 5's ⌘F slice: opens OUR CM6 search panel —
 * never the browser's find bar — in whichever Source/Diff editor is
 * currently mounted. A no-op (still returns `false`) when no CM6 view is
 * registered (Rendered mode, or no tab open); App.tsx still calls
 * `preventDefault()` unconditionally so the browser's own find bar never
 * flashes open first.
 *
 * Dynamically imports `@codemirror/search` rather than importing it at the
 * top of App.tsx, so the global keydown handler (wired up at first paint)
 * never pulls any CM6 code into the app's main bundle just to own this one
 * shortcut. By the time a user can press ⌘F against a *registered* view,
 * that view's own module has already statically imported
 * `@codemirror/search` to build its `search()` extension (`baseExtensions.ts`),
 * so this import is a cache hit, not a new network request.
 */
export async function openSearchInActiveView(): Promise<boolean> {
  const view = activeView;
  if (!view) return false;
  const { openSearchPanel } = await import("@codemirror/search");
  openSearchPanel(view);
  view.focus();
  return true;
}

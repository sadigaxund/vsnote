/**
 * Tracks whichever CM6 `EditorView` is currently mounted in each pane, so
 * App.tsx's single global keydown handler (DESIGN-SPEC Amendments item 5)
 * can reach "the" active one without prop-drilling a view reference through
 * EditorContent/EditorPane/etc.
 *
 * Phase 6 (grid split view, DESIGN-SPEC Amendments item 8) can have several
 * CM6 views mounted simultaneously — one per pane, sometimes more than one
 * showing the *same* file in different modes. `⌘F` / Ln·Col in the status
 * bar must resolve to the FOCUSED pane's view, not an arbitrary one, so this
 * module keeps a `Map<paneId, EditorView>` instead of one global reference
 * and reads `useTabsStore`'s `activePaneId` (which doubles as "the focused
 * pane" — see that store's module doc) to resolve the default. Every CM6
 * mount site (`CodeMirrorEditor`, `DiffView`, `LivePreviewEditor`) now takes
 * a `paneId` prop and registers/unregisters itself under that key.
 */
import type { EditorView } from "@codemirror/view";
import { useTabsStore } from "../stores/useTabsStore";

const viewsByPane = new Map<string, EditorView>();

export function setActiveEditorView(paneId: string, view: EditorView | null): void {
  if (view) viewsByPane.set(paneId, view);
  else viewsByPane.delete(paneId);
}

/** Defaults to the focused pane (`useTabsStore`'s `activePaneId`) when
 * `paneId` is omitted — the common case for a global shortcut. */
export function getActiveEditorView(paneId?: string): EditorView | null {
  const id = paneId ?? useTabsStore.getState().activePaneId;
  return viewsByPane.get(id) ?? null;
}

/**
 * DESIGN-SPEC Amendments item 5's ⌘F slice: opens OUR CM6 search panel —
 * never the browser's find bar — in the focused pane's Source/Diff editor.
 * A no-op (still returns `false`) when that pane has no CM6 view registered
 * (Rendered mode, or no tab open); App.tsx still calls `preventDefault()`
 * unconditionally so the browser's own find bar never flashes open first.
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
  const view = getActiveEditorView();
  if (!view) return false;
  const { openSearchPanel } = await import("@codemirror/search");
  openSearchPanel(view);
  view.focus();
  return true;
}

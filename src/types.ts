/**
 * Shared domain types for the Slate shell.
 *
 * Phase 1 renders these from hardcoded demo data (see `src/data/`), but every
 * component in `src/components/` consumes them as props rather than baking
 * literals into JSX, so Phase 2 can swap the data source for zustand stores
 * (`useFsStore`, `useGitStore`, `useTabsStore`, ...) without touching layout.
 */

/** Git status letter vocabulary used across the tree, tabs, and status bar. */
export type GitStatus = "M" | "A" | "D" | "U";

export type FileKind =
  | "md"
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "json"
  | "css"
  | "html"
  | "csv"
  | "image"
  | "folder"
  | "unknown"
  /** Phase 6.5c (DESIGN-SPEC Amendments item 11): the Settings VIEW, opened
   * as a tab like any file per `useTabsStore.ts`'s existing "content keyed
   * by FILE (well, by `path`), view state per PANE" shape — not a real fs
   * node (never appears in the Explorer tree, never routed through
   * `useFsStore.inferFileKind`). `SettingsView.tsx`'s `SETTINGS_TAB_PATH`
   * is the one path that ever carries this kind. */
  | "settings";

export interface FileNode {
  id: string;
  name: string;
  kind: FileKind;
  /** Absolute-ish path from the vault root, used for breadcrumbs / tabs. */
  path: string;
  type: "file" | "folder";
  status?: GitStatus;
  children?: FileNode[];
  /** Static demo shell: whether the folder starts expanded. */
  defaultExpanded?: boolean;
  /** Whether the folder starts collapsed (e.g. `assets/`). */
  collapsed?: boolean;
}

export type EditorMode = "rendered" | "source" | "diff";

/** Diff mode's presentation toggle (DESIGN-SPEC Amendments item 13) — lifted
 * out of `editor/DiffView.tsx` into pane-level state (`EditorPane.tsx`) so
 * `EditorHeader`'s icon-only `SegmentedControl` can sit next to the
 * Rendered/Source/Diff mode toggle instead of DiffView's own ad-hoc row. */
export type DiffLayout = "split" | "unified";

/** Phase 6 grid split view (DESIGN-SPEC Amendments item 8): which edge of a
 * pane a dragged tab is being docked toward — "center" means "merge into
 * this pane's tab strip" rather than create a new sibling pane. */
export type DockEdge = "top" | "bottom" | "left" | "right" | "center";

export interface TabItem {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
  /** Unsaved local edits. */
  dirty?: boolean;
  /** Single-click preview tab (italicized, replaced on next preview open). */
  preview?: boolean;
  /** Tints the tab label with the file's git status color. */
  status?: GitStatus;
  active?: boolean;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface GitSummary {
  branch: string;
  /** Real ahead/behind, from actual refs (Phase 11 — see
   * `useGitStore`/`git/remote.ts`'s docs) — never a simulated counter. */
  ahead: number;
  behind: number;
  /** Epoch ms of the last successful sync, or `null` if this vault has
   * never synced with a remote yet — `StatusBar.tsx` formats + ticks this
   * into "synced Xm ago" / "not synced yet" itself (see `useGitStore`'s
   * doc). */
  lastSyncedAt: number | null;
  /** Which sync operation (if any) is in flight — drives the status bar's
   * syncing spinner. `"sync"` covers the whole one-button pipeline
   * (`useGitStore.ts`'s `syncNow`/`resolveConflict`, Phase 11's roadmap
   * §5.2 auto-merge). */
  syncing: false | "push" | "pull" | "fetch" | "sync";
  /** The most recent sync failure's message, or `null` — see
   * `useGitStore`'s doc. `StatusBar.tsx` surfaces this via its sync
   * segment's tooltip/tone instead of a spinner once a sync has failed. */
  syncError: string | null;
  diff: DiffStat;
  untracked: number;
  changedCount: number;
}

export interface CursorPosition {
  line: number;
  column: number;
}

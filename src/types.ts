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
  | "unknown";

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
  ahead: number;
  behind: number;
  syncedLabel: string;
  diff: DiffStat;
  untracked: number;
  changedCount: number;
}

export interface CursorPosition {
  line: number;
  column: number;
}

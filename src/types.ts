/**
 * Shared domain types for the VSNote shell.
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
  /** Markii extension (docs/PLAN-2026-09-05-refresh.md §6 Phase M1) — a
   * `.mk.md` file: markdown plus the directive grammar with completion/
   * hover/insert-component wired in Source mode, and a static (debounced)
   * Preview instead of plain `.md`'s CM6 live-preview Rendered mode. A
   * DOUBLE extension — `lib/fileTree.ts::inferFileKind` checks the full
   * `.mk.md` suffix before falling through to the single-extension switch
   * below, so `.mk.md` wins over the generic `.md` case. */
  | "mkmd"
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "json"
  | "css"
  | "html"
  | "csv"
  | "image"
  /** R3-9: any file whose extension isn't one of the hand-written kinds
   * above but IS covered by `@codemirror/language-data` (CM6's own
   * language packages plus its legacy `StreamLanguage` modes) — python,
   * go, rust, shell, yaml, toml, sql, java, c/c++, ruby, php, xml, ini,
   * `Dockerfile`, and everything else that ships in that package.
   * `lib/fileTree.ts::inferFileKind` assigns this as its default case
   * (replacing the old silent "unknown" fallthrough) for any file that
   * isn't one of the other explicit kinds; `filetypes/registry.ts`'s
   * single `code` entry gives it the SAME `baseModes`/`renderer: "code"`
   * shape as the hand-written code kinds (`ts`/`tsx`/`js`/`jsx`/`css`)
   * above — the difference is which language actually loads, resolved
   * per-FILE (by filename, via `LanguageDescription.matchFilename`) rather
   * than per-kind, since one `FileKind` here covers arbitrarily many
   * languages. A file whose extension `language-data` doesn't recognize
   * either still gets this kind (Rendered/Source/Diff stay available) but
   * resolves to no CM6 language — the same plain-text degrade `csv`/an
   * unrecognized fence language already gets. */
  | "code"
  | "folder"
  | "unknown"
  /** Phase 6.5c (DESIGN-SPEC Amendments item 11): the Settings VIEW, opened
   * as a tab like any file per `useTabsStore.ts`'s existing "content keyed
   * by FILE (well, by `path`), view state per PANE" shape — not a real fs
   * node (never appears in the Explorer tree, never routed through
   * `useFsStore.inferFileKind`). `SettingsView.tsx`'s `SETTINGS_TAB_PATH`
   * is the one path that ever carries this kind. */
  | "settings"
  /** docs/PLAN-2026-09-05-refresh.md §2 — the Shared VIEW (share list,
   * edit policy, revoke), opened as a full-width tab exactly like
   * "settings" above, for the same reason: a table with source/link/
   * access/links/hits/last-accessed/actions columns needs real width, and
   * a Settings-style tab already gets it (see `SharedView.tsx`'s header
   * doc for why a sidebar panel was tried first and rejected).
   * `lib/sharedTab.ts`'s `SHARED_TAB_PATH` is the one path that ever
   * carries this kind. */
  | "shared";

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
   * into "last pushed Xm ago" / "never pushed" itself (see `useGitStore`'s
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

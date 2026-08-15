/**
 * Git status letter -> tint. Shared by `components/local/ExplorerTree.tsx`
 * and `components/SourceControlPanel.tsx` (the changed-file lists in both
 * use the identical M/A/D/U vocabulary/coloring) — a plain data module
 * rather than exporting it from `ExplorerTree.tsx` itself, so that
 * component-only file stays clean for React Fast Refresh (a file mixing a
 * component export with a plain-value export loses fast-refresh boundary
 * detection).
 */
import type { GitStatus } from "../types";

export const STATUS_COLOR: Record<GitStatus, string> = {
  M: "var(--git-modified)",
  A: "var(--git-added)",
  D: "var(--git-deleted)",
  U: "var(--git-untracked)",
};

/**
 * Hardcoded demo vault + tabs + git summary matching `app-preview.png` and
 * DESIGN-SPEC §3. Phase 2 replaces this module with live reads from the
 * virtual FS + git services; every consumer downstream takes this shape as
 * props, so swapping the source is a one-file change.
 */
import type { DiffStat, FileNode, GitSummary, TabItem } from "../types";

export const demoVault: FileNode[] = [
  {
    id: "vault",
    name: "vault",
    kind: "folder",
    type: "folder",
    path: "vault",
    defaultExpanded: true,
    children: [
      {
        id: "vault/notes",
        name: "notes",
        kind: "folder",
        type: "folder",
        path: "vault/notes",
        defaultExpanded: true,
        children: [
          {
            id: "vault/notes/architecture.md",
            name: "architecture.md",
            kind: "md",
            type: "file",
            path: "vault/notes/architecture.md",
            status: "M",
          },
          {
            id: "vault/notes/daily-2026-08-14.md",
            name: "daily-2026-08-14.md",
            kind: "md",
            type: "file",
            path: "vault/notes/daily-2026-08-14.md",
            status: "U",
          },
          {
            id: "vault/notes/reading-list.md",
            name: "reading-list.md",
            kind: "md",
            type: "file",
            path: "vault/notes/reading-list.md",
          },
        ],
      },
      {
        id: "vault/src",
        name: "src",
        kind: "folder",
        type: "folder",
        path: "vault/src",
        defaultExpanded: true,
        children: [
          {
            id: "vault/src/indexer.ts",
            name: "indexer.ts",
            kind: "ts",
            type: "file",
            path: "vault/src/indexer.ts",
            status: "M",
          },
          {
            id: "vault/src/GraphView.tsx",
            name: "GraphView.tsx",
            kind: "tsx",
            type: "file",
            path: "vault/src/GraphView.tsx",
            status: "A",
          },
          {
            id: "vault/src/theme.css",
            name: "theme.css",
            kind: "css",
            type: "file",
            path: "vault/src/theme.css",
          },
          {
            id: "vault/src/legacy-parser.ts",
            name: "legacy-parser.ts",
            kind: "ts",
            type: "file",
            path: "vault/src/legacy-parser.ts",
            status: "D",
          },
        ],
      },
      {
        id: "vault/assets",
        name: "assets",
        kind: "folder",
        type: "folder",
        path: "vault/assets",
        collapsed: true,
        children: [
          {
            id: "vault/assets/cover.png",
            name: "cover.png",
            kind: "image",
            type: "file",
            path: "vault/assets/cover.png",
          },
        ],
      },
      {
        id: "vault/metrics.csv",
        name: "metrics.csv",
        kind: "csv",
        type: "file",
        path: "vault/metrics.csv",
        status: "M",
      },
      {
        id: "vault/vault.config.json",
        name: "vault.config.json",
        kind: "json",
        type: "file",
        path: "vault/vault.config.json",
      },
    ],
  },
];

export const demoTabs: TabItem[] = [
  {
    id: "vault/notes/architecture.md",
    name: "architecture.md",
    path: "vault/notes/architecture.md",
    kind: "md",
    dirty: true,
    status: "M",
    active: true,
  },
  {
    id: "vault/src/indexer.ts",
    name: "indexer.ts",
    path: "vault/src/indexer.ts",
    kind: "ts",
    dirty: true,
    status: "M",
  },
  {
    id: "vault/vault.config.json",
    name: "vault.config.json",
    path: "vault/vault.config.json",
    kind: "json",
  },
  {
    id: "vault/metrics.csv",
    name: "metrics.csv",
    path: "vault/metrics.csv",
    kind: "csv",
    dirty: true,
    status: "M",
  },
  {
    id: "vault/assets/cover.png",
    name: "cover.png",
    path: "vault/assets/cover.png",
    kind: "image",
    preview: true,
  },
];

export const demoDiffStat: DiffStat = { added: 12, removed: 5 };

export const demoGitSummary: GitSummary = {
  branch: "feat/incremental-index",
  ahead: 3,
  behind: 1,
  syncedLabel: "synced 2m ago",
  diff: demoDiffStat,
  untracked: 1,
  changedCount: 6,
};

export const activeBreadcrumb = ["vault", "notes", "architecture.md"];

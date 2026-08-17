/**
 * Tree snapshot + file operations, live over `fs/operations.ts`. Holds the
 * raw filesystem shape only — git status decoration is merged in by
 * `useDecoratedTree` (`stores/useDecoratedTree.ts`) so this store stays
 * fs-only per ARCHITECTURE.md's module boundaries.
 */
import { create } from "zustand";
import {
  ensureDir,
  pathExists,
  readTree,
  removePath,
  renamePath,
  writeFile,
  type RawTreeNode,
} from "../fs/operations";
import {
  VAULT_DIR,
  VAULT_LABEL,
  displayToFsPath,
  dirname as fsDirname,
  fsToDisplayPath,
  joinPath,
} from "../fs/paths";
// DESIGN-SPEC Amendments round 5 item 41(c) — DISPLAY-name mapping only
// (chosen over a real FS-root rename: see `useSettingsStore.ts`'s
// `vaultDisplayName` doc). `VAULT_LABEL` stays the real `id`/`path` for
// every node below (all path resolution, drag/drop, git-status keys, etc.
// are completely untouched); only this root node's rendered `name` reads
// the setting, so `ExplorerTree.tsx` (which renders `node.name` as text but
// keys every operation off `node.id`) shows the custom label for free with
// no change to that file.
import { useSettingsStore } from "./useSettingsStore";
import { resolveVaultDisplayLabel } from "../lib/vaultLabel";
import type { FileNode } from "../types";

/**
 * Deliberate, non-alphabetical sibling order matching DESIGN-SPEC §3 /
 * app-preview.png exactly (`notes`, `src`, `assets`, then the loose root
 * files) — this is a curated demo order, not derived from name or mtime.
 * Paths not listed here (anything created during the session) sort after
 * every mapped sibling, alphabetically among themselves — new items land
 * at the end of their group, which is the readable default.
 */
const CANONICAL_ORDER = [
  "vault/notes",
  "vault/src",
  "vault/assets",
  "vault/metrics.csv",
  "vault/vault.config.json",
  // DESIGN-SPEC Amendments round 3 item 21's two new demo files — appended
  // after every path the base spec's tree order already covers, so they
  // land at the end of their respective groups (root loose files / notes/)
  // rather than disturbing the screenshot-matched order above them.
  "vault/demo.html",
  "vault/notes/architecture.md",
  "vault/notes/daily-2026-08-14.md",
  "vault/notes/reading-list.md",
  "vault/notes/markdown-kitchen-sink.md",
  "vault/src/indexer.ts",
  "vault/src/GraphView.tsx",
  "vault/src/theme.css",
  "vault/src/legacy-parser.ts",
  "vault/assets/cover.png",
];
// `inferFileKind`/`collectDescendantIds` moved to `lib/fileTree.ts`
// (round 6 item 10 — the share reader reuses ExplorerTree, which must
// not pull this store/lightning-fs into the /share/ chunk); re-exported
// here so existing import sites keep working.
export { collectDescendantIds, inferFileKind } from "../lib/fileTree";
import { collectDescendantIds, inferFileKind } from "../lib/fileTree";

const ORDER_INDEX = new Map(CANONICAL_ORDER.map((p, i) => [p, i]));

/** Folders that start collapsed, matching app-preview.png (DESIGN-SPEC §3:
 * "vault/assets/ (collapsed; contains cover.png)") — every other folder
 * defaults open. A curated default, same spirit as `CANONICAL_ORDER`. */
const COLLAPSED_BY_DEFAULT = new Set(["vault/assets"]);

function toFileNode(raw: RawTreeNode): FileNode {
  const displayPath = fsToDisplayPath(raw.path);
  const isFolder = raw.type === "dir";
  const children = raw.children?.map(toFileNode);
  if (children) sortChildren(children);
  return {
    id: displayPath,
    name: raw.name,
    kind: isFolder ? "folder" : inferFileKind(raw.name),
    path: displayPath,
    type: isFolder ? "folder" : "file",
    children,
    defaultExpanded: isFolder ? true : undefined,
    collapsed: isFolder && COLLAPSED_BY_DEFAULT.has(displayPath) ? true : undefined,
  };
}

export function sortChildren(nodes: FileNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const ai = ORDER_INDEX.get(a.id);
    const bi = ORDER_INDEX.get(b.id);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}


interface FsStoreState {
  tree: FileNode[];
  loading: boolean;
  refresh: () => Promise<void>;
  createFile: (parentDisplayPath: string, name: string) => Promise<string>;
  createFolder: (parentDisplayPath: string, name: string) => Promise<string>;
  renameNode: (displayPath: string, newName: string) => Promise<string>;
  /** Moves `displayPath` to be a child of `newParentDisplayPath`. Refuses
   * (throws) moving a folder into its own descendant. */
  moveNode: (displayPath: string, newParentDisplayPath: string) => Promise<string>;
  removeNode: (displayPath: string) => Promise<void>;
}

async function uniqueName(parentFsPath: string, base: string, ext: string): Promise<string> {
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? `${base}${ext}` : `${base}-${n}${ext}`;
    if (!(await pathExists(`${parentFsPath}/${candidate}`))) return candidate;
    n++;
  }
}

export const useFsStore = create<FsStoreState>((set, get) => ({
  tree: [],
  loading: true,

  refresh: async () => {
    const rawChildren = await readTree(VAULT_DIR);
    const root: FileNode = {
      id: VAULT_LABEL,
      // Item 41(c) — display label only; `id`/`path` below stay the real
      // `VAULT_LABEL` unconditionally (see the import comment above).
      name: resolveVaultDisplayLabel(useSettingsStore.getState().vaultDisplayName, VAULT_LABEL),
      kind: "folder",
      type: "folder",
      path: VAULT_LABEL,
      defaultExpanded: true,
      children: rawChildren.map(toFileNode),
    };
    if (root.children) sortChildren(root.children);
    set({ tree: [root], loading: false });
  },

  createFile: async (parentDisplayPath, name) => {
    const parentFsPath = displayToFsPath(parentDisplayPath);
    await ensureDir(parentFsPath);
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    const finalName = await uniqueName(parentFsPath, base, ext);
    const fsPath = `${parentFsPath}/${finalName}`;
    await writeFile(fsPath, "");
    await get().refresh();
    return fsToDisplayPath(fsPath);
  },

  createFolder: async (parentDisplayPath, name) => {
    const parentFsPath = displayToFsPath(parentDisplayPath);
    await ensureDir(parentFsPath);
    const finalName = await uniqueName(parentFsPath, name, "");
    const fsPath = `${parentFsPath}/${finalName}`;
    await ensureDir(fsPath);
    await get().refresh();
    return fsToDisplayPath(fsPath);
  },

  renameNode: async (displayPath, newName) => {
    const oldFsPath = displayToFsPath(displayPath);
    const parentFsPath = fsDirname(oldFsPath);
    const newFsPath = joinPath(parentFsPath, newName);
    await renamePath(oldFsPath, newFsPath);
    await get().refresh();
    return fsToDisplayPath(newFsPath);
  },

  moveNode: async (displayPath, newParentDisplayPath) => {
    const descendants = collectDescendantIds(get().tree, displayPath);
    if (descendants.has(newParentDisplayPath)) {
      throw new Error("Cannot move a folder into its own descendant.");
    }
    const oldFsPath = displayToFsPath(displayPath);
    const name = oldFsPath.slice(oldFsPath.lastIndexOf("/") + 1);
    const newParentFsPath = displayToFsPath(newParentDisplayPath);
    const finalName = await uniqueName(newParentFsPath, name, "");
    const newFsPath = `${newParentFsPath}/${finalName}`;
    if (newFsPath === oldFsPath) return displayPath;
    await renamePath(oldFsPath, newFsPath);
    await get().refresh();
    return fsToDisplayPath(newFsPath);
  },

  removeNode: async (displayPath) => {
    await removePath(displayToFsPath(displayPath));
    await get().refresh();
  },
}));

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
import type { FileKind, FileNode } from "../types";

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
  "vault/notes/architecture.md",
  "vault/notes/daily-2026-08-14.md",
  "vault/notes/reading-list.md",
  "vault/src/indexer.ts",
  "vault/src/GraphView.tsx",
  "vault/src/theme.css",
  "vault/src/legacy-parser.ts",
  "vault/assets/cover.png",
];
const ORDER_INDEX = new Map(CANONICAL_ORDER.map((p, i) => [p, i]));

export function inferFileKind(name: string): FileKind {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "md":
      return "md";
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "csv":
      return "csv";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "image";
    default:
      return "unknown";
  }
}

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

/** Finds every id in the tree under (and including) `rootId`. */
export function collectDescendantIds(nodes: FileNode[], rootId: string): Set<string> {
  const ids = new Set<string>();
  function visit(node: FileNode, inside: boolean) {
    const nowInside = inside || node.id === rootId;
    if (nowInside) ids.add(node.id);
    node.children?.forEach((c) => visit(c, nowInside));
  }
  nodes.forEach((n) => visit(n, false));
  return ids;
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
      name: VAULT_LABEL,
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

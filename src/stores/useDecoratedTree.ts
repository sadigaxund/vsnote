/**
 * Combines `useFsStore`'s raw tree with `useGitStore`'s status map into the
 * `FileNode[]` shape `ExplorerTree` renders — the one place fs and git
 * meet, keeping both stores single-concern per ARCHITECTURE.md's module
 * boundaries.
 *
 * Also synthesizes tree rows for `D`-status paths: a deleted-from-working-
 * tree file has nothing left for `readTree` (fs/operations.ts) to find —
 * it no longer exists on disk — but DESIGN-SPEC §3 requires it stay listed,
 * struck through, exactly where it used to live (`legacy-parser.ts` under
 * `src/`). Those rows are the only ones in the tree that don't correspond
 * to a real fs entry; everything else is real.
 */
import { useMemo } from "react";
import { useFsStore, inferFileKind, sortChildren } from "./useFsStore";
import { useGitStore } from "./useGitStore";
import { useSettingsStore } from "./useSettingsStore";
import { parentOfDisplayPath } from "../fs/paths";
import type { FileNode, GitStatus } from "../types";

function decorate(nodes: FileNode[], statuses: Record<string, GitStatus>): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    status: statuses[node.id],
    children: node.children ? decorate(node.children, statuses) : undefined,
  }));
}

function collectIds(nodes: FileNode[], into: Set<string>): void {
  for (const node of nodes) {
    into.add(node.id);
    if (node.children) collectIds(node.children, into);
  }
}

function findFolder(nodes: FileNode[], id: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.id === id && node.type === "folder") return node;
    if (node.children) {
      const found = findFolder(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function injectDeleted(nodes: FileNode[], statuses: Record<string, GitStatus>): FileNode[] {
  const existing = new Set<string>();
  collectIds(nodes, existing);

  const deletedPaths = Object.entries(statuses)
    .filter(([path, status]) => status === "D" && !existing.has(path))
    .map(([path]) => path);
  if (deletedPaths.length === 0) return nodes;

  for (const path of deletedPaths) {
    const parentPath = parentOfDisplayPath(path);
    const parent = findFolder(nodes, parentPath);
    if (!parent) continue; // parent folder was also removed; nothing sensible to attach to
    const name = path.slice(path.lastIndexOf("/") + 1);
    const ghost: FileNode = { id: path, name, kind: inferFileKind(name), path, type: "file", status: "D" };
    parent.children = [...(parent.children ?? []), ghost];
    sortChildren(parent.children);
  }
  return nodes;
}

export function useDecoratedTree(): FileNode[] {
  const tree = useFsStore((s) => s.tree);
  const statuses = useGitStore((s) => s.statuses);
  // Round 6 item 15 ("clean tree") — with the setting off (the default) the
  // Explorer is a pure fs listing: no status tint/letters and no synthesized
  // deleted-file ghost rows. The Source Control panel still lists every
  // change either way (it reads `useGitStore` directly, not this hook).
  const showGitStatus = useSettingsStore((s) => s.showGitStatusInExplorer);
  return useMemo(
    () => (showGitStatus ? injectDeleted(decorate(tree, statuses), statuses) : tree),
    [tree, statuses, showGitStatus],
  );
}

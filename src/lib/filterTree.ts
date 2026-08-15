/**
 * Filters a `FileNode[]` tree by a case-insensitive name substring, keeping
 * any folder that contains a match so results stay reachable (e.g. a match
 * inside the collapsed `assets/` folder keeps `assets/` in the result —
 * `ExplorerTree`'s `expandAll` then forces it open). Used by the sidebar's
 * "Filter files" input (DESIGN-SPEC §3).
 */
import type { FileNode } from "../types";

export function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function visit(node: FileNode): FileNode | null {
    const selfMatch = node.name.toLowerCase().includes(q);
    if (node.type === "file") {
      return selfMatch ? node : null;
    }
    const children = (node.children ?? []).map(visit).filter((n): n is FileNode => n !== null);
    if (selfMatch || children.length > 0) {
      return { ...node, children };
    }
    return null;
  }

  return nodes.map(visit).filter((n): n is FileNode => n !== null);
}

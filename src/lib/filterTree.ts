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

  // Single-pass visits (TODO §6.1.4, js-combine-iterations): the map+filter
  // shape allocated a throwaway array per node per pass; one loop with a
  // push-when-kept accumulator does the same work with none of it.
  function visit(node: FileNode): FileNode | null {
    const selfMatch = node.name.toLowerCase().includes(q);
    if (node.type === "file") {
      return selfMatch ? node : null;
    }
    const children: FileNode[] = [];
    const kids = node.children ?? [];
    for (let i = 0; i < kids.length; i += 1) {
      const kept = visit(kids[i]);
      if (kept) children.push(kept);
    }
    if (selfMatch || children.length > 0) {
      return { ...node, children };
    }
    return null;
  }

  const out: FileNode[] = [];
  for (const node of nodes) {
    const kept = visit(node);
    if (kept) out.push(kept);
  }
  return out;
}

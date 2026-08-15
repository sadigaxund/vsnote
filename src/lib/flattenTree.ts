/**
 * Flattens a `FileNode[]` tree into a plain file list (folders dropped) —
 * used by the command palette's file-jump group (⌘K/⌘P) and
 * `lib/vaultSearch.ts`'s full-text walk, so both read the same order
 * `useFsStore`'s tree already sorts into (DESIGN-SPEC §3's canonical demo
 * order, then creation order for anything added during the session).
 */
import type { FileNode } from "../types";

export function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  function visit(node: FileNode): void {
    if (node.type === "file") {
      out.push(node);
      return;
    }
    node.children?.forEach(visit);
  }
  nodes.forEach(visit);
  return out;
}

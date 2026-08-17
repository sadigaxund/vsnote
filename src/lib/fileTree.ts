/**
 * Pure `FileNode` helpers with NO store/fs imports — extracted from
 * `stores/useFsStore.ts` (which re-exports them, so its many existing
 * import sites are untouched) during round 6 item 10: the rebuilt share
 * reader (`share/ShareApp.tsx`) reuses `ExplorerTree`, and that component
 * importing anything from the fs store would drag `lightning-fs` (and its
 * IndexedDB open) into the `/share/` chunk, breaking that route's
 * no-vault-access guarantee.
 */
import type { FileKind, FileNode } from "../types";

export function inferFileKind(name: string): FileKind {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "md":
      return "md";
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
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

/**
 * Full-text search across the vault — the Search activity view (DESIGN-SPEC
 * "Misc / settings" list + IMPLEMENTATION-PLAN.md Phase 5: "Search activity
 * view: full-text across vault with result list → opens at line").
 *
 * Walks `useFsStore`'s current tree (files only, via `lib/flattenTree.ts`),
 * skipping non-text kinds (`image`, `folder`) — nothing here reads bytes for
 * a binary file. For a file with an open, loaded buffer, the buffer's LIVE
 * content is searched in preference to disk (`useBufferStore` wins over
 * `readTextFile`) so search results reflect in-progress unsaved edits, not
 * a stale last-saved copy — the same "what you see is what's searched"
 * expectation Obsidian/VSCode's in-editor search give for the active file,
 * extended here to every open file.
 *
 * Deliberately excludes `D`-status (deleted-from-working-tree) files: they
 * don't appear in `useFsStore`'s raw tree at all (only the decorated tree
 * `useDecoratedTree` — a React hook — synthesizes a ghost row for them), so
 * there's nothing this plain async function can read for them without
 * pulling in a second, HEAD-reading code path for a vault that has exactly
 * one such file; a real HEAD-content search over deleted files is a
 * reasonable future addition, not a Phase 5a requirement.
 */
import { flattenFiles } from "./flattenTree";
import { useFsStore } from "../stores/useFsStore";
import { useBufferStore } from "../stores/useBufferStore";
import { pathExists, readTextFile } from "../fs/operations";
import { displayToFsPath } from "../fs/paths";
import type { FileKind, FileNode } from "../types";

const SEARCHABLE_KINDS = new Set<FileKind>(["md", "ts", "tsx", "js", "jsx", "json", "css", "html", "csv", "unknown"]);

/** Caps so a pathological huge file/vault can't make one search freeze the
 * UI — this app's demo vault is tiny, but the mechanism should degrade
 * gracefully rather than assume that forever. */
const MAX_MATCHES_PER_FILE = 20;
const MAX_FILES_WITH_RESULTS = 50;

export interface SearchMatch {
  line: number;
  column: number;
  /** The full source line the match was found on (untruncated — the
   * result row truncates for display, not this module). */
  text: string;
}

export interface SearchFileResult {
  path: string;
  name: string;
  kind: FileKind;
  matches: SearchMatch[];
}

async function contentFor(node: FileNode): Promise<string | undefined> {
  const buffer = useBufferStore.getState().buffers[node.path];
  if (buffer?.loaded) return buffer.content;
  const fsPath = displayToFsPath(node.path);
  if (!(await pathExists(fsPath))) return undefined;
  return readTextFile(fsPath);
}

export async function searchVault(query: string): Promise<SearchFileResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();

  const files = flattenFiles(useFsStore.getState().tree).filter((f) => SEARCHABLE_KINDS.has(f.kind));
  const results: SearchFileResult[] = [];

  for (const file of files) {
    if (results.length >= MAX_FILES_WITH_RESULTS) break;
    const content = await contentFor(file);
    if (!content) continue;

    const lines = content.split("\n");
    const matches: SearchMatch[] = [];
    for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
      const idx = lines[i].toLowerCase().indexOf(needle);
      if (idx !== -1) matches.push({ line: i + 1, column: idx + 1, text: lines[i] });
    }
    if (matches.length > 0) {
      results.push({ path: file.path, name: file.name, kind: file.kind, matches });
    }
  }

  return results;
}

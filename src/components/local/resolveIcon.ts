/**
 * Pure curated-icon-key resolution — split out of `FileIcon.tsx` (see that
 * file's header for the full two-tier rationale) so the component file stays
 * component-only for React Fast Refresh, the same reasoning
 * `lib/gitStatusColor.ts`'s header already documents for this codebase ("a
 * plain data module rather than exporting it from the component file itself,
 * so that component-only file stays clean for React Fast Refresh — a file
 * mixing a component export with a plain-value export loses fast-refresh
 * boundary detection"). Also lets `tests/unit/fileIcon.test.ts` pin the
 * resolution order directly, without mounting React.
 */
import { curatedManifest, KIND_FALLBACK_EXT } from "./materialIcons.curated";
import type { FileKind } from "../../types";

export interface CuratedResolution {
  key: string;
  /** False only when resolution fell all the way through to the curated
   * pack's own generic default (`file`/`folder`/`folder-open`) — signals
   * `FileIcon` to also try the full-manifest fallback in the background. */
  matched: boolean;
}

/** File resolution order (matches VSCode's icon-theme host):
 * `fileNames[basename.toLowerCase()]` -> longest matching `fileExtensions`
 * suffix ("a.b.c" tries "b.c" before "c") -> the kind's representative
 * extension -> the curated pack's generic `file` default. */
export function resolveFileIconCurated(name: string | undefined, kind: FileKind): CuratedResolution {
  const lower = name?.toLowerCase();
  if (lower) {
    const byName = curatedManifest.fileNames[lower];
    if (byName) return { key: byName, matched: true };
    // Longest matching extension first: "a.b.c" tries "b.c" before "c".
    const parts = lower.split(".");
    for (let i = 1; i < parts.length; i++) {
      const ext = parts.slice(i).join(".");
      const hit = curatedManifest.fileExtensions[ext];
      if (hit) return { key: hit, matched: true };
    }
  }
  const fallbackExt = KIND_FALLBACK_EXT[kind];
  const hit = fallbackExt ? curatedManifest.fileExtensions[fallbackExt] : undefined;
  if (hit) return { key: hit, matched: true };
  return { key: curatedManifest.file, matched: false };
}

/** Folder resolution: `folderNames`/`folderNamesExpanded` (closed/open)
 * keyed by folder name -> the curated pack's generic `folder`/`folder-open`
 * default. */
export function resolveFolderIconCurated(name: string | undefined, open: boolean): CuratedResolution {
  const lower = name?.toLowerCase();
  const map = open ? curatedManifest.folderNamesExpanded : curatedManifest.folderNames;
  const hit = lower ? map[lower] : undefined;
  if (hit) return { key: hit, matched: true };
  return { key: open ? curatedManifest.folderExpanded : curatedManifest.folder, matched: false };
}

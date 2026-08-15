/**
 * Folder-share manifest shaping — pure logic, unit-tested
 * (`tests/unit/folderManifest.test.ts`). Two things live here:
 *
 * 1. Flattening a vault subtree (the Explorer's `FileNode` shape, or
 *    anything structurally compatible with it) into a flat list of
 *    `{relpath}` entries relative to the published folder's root — the
 *    Publish dialog's checkbox tree is built from this, and the manifest
 *    posted to `POST /api/shares`/`PUT /api/shares/{id}/manifest` is this
 *    list filtered by the owner's exclusions.
 * 2. Exclusion filtering — an EXCLUDED entry must be ABSENT from the
 *    manifest array sent to the server (roadmap §5.1: "excluded entries
 *    are absent from the snapshot manifest (not hidden — absent)"), never
 *    merely flagged/hidden client-side and then sent anyway.
 *
 * Deliberately generic over a minimal tree shape (`FolderSourceNode`)
 * rather than importing `types.ts`'s `FileNode` directly — keeps this
 * module (and its tests) decoupled from the rest of the app's type graph,
 * same reasoning as `sharePolicy.ts`/`shareLinks.ts` staying pure.
 */

export interface FolderSourceNode {
  name: string;
  type: "file" | "folder";
  children?: FolderSourceNode[];
}

export interface FlatFileEntry {
  /** Path relative to the published folder's root, e.g. `"notes/queue.md"`
   * — NEVER a real filesystem/vault path (that distinction matters: this
   * is exactly what the server stores and matches against, see
   * `server/app/models.py`'s `ShareManifestEntry` docstring). */
  relpath: string;
}

/** Flattens a subtree into every FILE's relpath (folders are structural,
 * not manifest entries — a folder is only ever implied by the relpaths of
 * the files inside it, both here and server-side in `_listing_for_prefix`).
 * Order is depth-first, source order preserved (matches the Explorer's own
 * folders-first-by-creation-order display, so the checkbox tree's flat
 * validation list lines up with what the user sees). */
export function flattenFolderTree(nodes: FolderSourceNode[], prefix = ""): FlatFileEntry[] {
  const out: FlatFileEntry[] = [];
  for (const node of nodes) {
    const relpath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === "file") {
      out.push({ relpath });
    } else if (node.children && node.children.length > 0) {
      out.push(...flattenFolderTree(node.children, relpath));
    }
  }
  return out;
}

/** The checkbox tree's default state — everything included (nothing
 * excluded) until the owner unchecks something. */
export function defaultIncludedSet(entries: FlatFileEntry[]): Set<string> {
  return new Set(entries.map((e) => e.relpath));
}

/** Unchecking a FOLDER row in the checkbox tree excludes every file
 * beneath it — this computes that set of relpaths given the folder's own
 * relpath prefix and the full flat entry list. */
export function relpathsUnderFolder(entries: FlatFileEntry[], folderRelpath: string): string[] {
  const prefix = `${folderRelpath}/`;
  return entries.filter((e) => e.relpath === folderRelpath || e.relpath.startsWith(prefix)).map((e) => e.relpath);
}

/** Builds the manifest array to send to the server: every entry the owner
 * left CHECKED, paired with its already-uploaded blob id. `blobsByRelpath`
 * must have an entry for every included relpath (the caller uploads blobs
 * for included files only — no point POSTing a blob for something that's
 * about to be excluded); a missing blob id for an included relpath is a
 * caller bug and throws rather than silently dropping the file. */
export function buildManifestPayload(
  entries: FlatFileEntry[],
  includedRelpaths: ReadonlySet<string>,
  blobsByRelpath: ReadonlyMap<string, string>,
): { relpath: string; blob_id: string }[] {
  const included = entries.filter((e) => includedRelpaths.has(e.relpath));
  return included.map((e) => {
    const blobId = blobsByRelpath.get(e.relpath);
    if (!blobId) {
      throw new Error(`Missing uploaded blob for included relpath "${e.relpath}"`);
    }
    return { relpath: e.relpath, blob_id: blobId };
  });
}

/** Given the server's manifest as returned by `GET /api/shares/{id}/manifest`
 * (owner "Edit policy…" prefill), returns the set of relpaths currently
 * INCLUDED — everything else in a freshly-flattened current tree counts as
 * excluded, matching roadmap §5.1's "absent, not hidden" semantics exactly
 * (there is no separate "excluded" list anywhere, only "what's present"). */
export function includedSetFromManifest(manifestRelpaths: readonly string[]): Set<string> {
  return new Set(manifestRelpaths);
}

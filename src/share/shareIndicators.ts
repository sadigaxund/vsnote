/**
 * Explorer tree share indicator — pure logic, unit-tested
 * (`tests/unit/shareIndicators.test.ts`). `ExplorerTree.tsx` renders a
 * link glyph (right-aligned like the git status letter) on rows that are
 * directly shared ("own") and a MUTED variant on rows that merely sit
 * inside a shared folder ("inherited") — roadmap §5.1: "tree indicator in
 * the explorer (link glyph, right-aligned like git letters; muted
 * inherited variant on files inside a shared folder)".
 *
 * Deliberately generic over a minimal share shape rather than importing
 * `share/api.ts`'s full `ShareOut` — keeps this pure module (and its
 * tests) decoupled, same reasoning as `sharePolicy.ts`/`shareLinks.ts`.
 *
 * `source_path` is compared as plain vault-display-path text (the exact
 * string `App.tsx` sent as `ShareCreateIn.source_path` at publish time,
 * e.g. `"vault/notes"` for a folder or `"vault/notes/x.md"` for a file) —
 * a descendant check is a plain `startsWith(sourcePath + "/")`, no path
 * normalization needed since both sides come from the same `FileNode.path`
 * namespace.
 */

export interface ShareIndicatorInput {
  id: number;
  source_path: string;
  kind: "file" | "folder";
  revoked_at?: number | null;
}

export interface ShareIndicatorResult<T extends ShareIndicatorInput = ShareIndicatorInput> {
  /** This exact path IS the share's source_path (a "Publish…" was run on
   * this exact file/folder). */
  own: T[];
  /** This path sits inside a shared FOLDER's subtree, but isn't itself the
   * share root — the muted variant. */
  inherited: T[];
}

/** Computes the indicator state for a single Explorer tree row. Revoked
 * shares are excluded entirely (a revoked share indicates nothing —
 * matches the uniform "gone" semantics everywhere else in this feature). */
export function computeShareIndicator<T extends ShareIndicatorInput>(shares: readonly T[], path: string): ShareIndicatorResult<T> {
  const own: T[] = [];
  const inherited: T[] = [];
  for (const share of shares) {
    if (share.revoked_at) continue;
    if (share.source_path === path) {
      own.push(share);
    } else if (share.kind === "folder" && path.startsWith(`${share.source_path}/`)) {
      inherited.push(share);
    }
  }
  return { own, inherited };
}

/** True if `path` has ANY (own or inherited) active share — the cheap
 * check `ExplorerTree` uses to decide whether to render a glyph at all. */
export function hasAnyShareIndicator<T extends ShareIndicatorInput>(shares: readonly T[], path: string): boolean {
  const { own, inherited } = computeShareIndicator(shares, path);
  return own.length > 0 || inherited.length > 0;
}

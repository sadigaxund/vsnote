/**
 * Explorer tree share indicator — pure logic, unit-tested
 * (`tests/unit/shareIndicators.test.ts`). `ExplorerTree.tsx` renders a
 * link glyph (right-aligned like the git status letter) on rows that are
 * directly shared ("own").
 *
 * Deliberately generic over a minimal share shape rather than importing
 * `share/api.ts`'s full `ShareOut` — keeps this pure module (and its
 * tests) decoupled, same reasoning as `sharePolicy.ts`/`shareLinks.ts`.
 *
 * `source_path` is compared as plain vault-display-path text (the exact
 * string `App.tsx` sent as `ShareCreateIn.source_path` at publish time,
 * e.g. `"vault/notes/x.md"`) — an ancestor check is a plain
 * `sourcePath.startsWith(path + "/")`, no path normalization needed since
 * both sides come from the same `FileNode.path` namespace.
 */

export interface ShareIndicatorInput {
  id: number;
  source_path: string;
  revoked_at?: number | null;
}

export interface ShareIndicatorResult<T extends ShareIndicatorInput = ShareIndicatorInput> {
  /** This exact path IS the share's source_path (a "Publish…" was run on
   * this exact file). */
  own: T[];
  /** Round 6 item 9 — this folder is an ANCESTOR of a shared item: some
   * share's source_path lives below this path. The muted variant on the
   * folder row, so a collapsed tree still reveals where shares live. */
  containing: T[];
}

/** Computes the indicator state for a single Explorer tree row. Revoked
 * shares are excluded entirely (a revoked share indicates nothing —
 * matches the uniform "gone" semantics everywhere else in this feature). */
export function computeShareIndicator<T extends ShareIndicatorInput>(shares: readonly T[], path: string): ShareIndicatorResult<T> {
  const own: T[] = [];
  const containing: T[] = [];
  for (const share of shares) {
    if (share.revoked_at) continue;
    if (share.source_path === path) {
      own.push(share);
    } else if (share.source_path.startsWith(`${path}/`)) {
      containing.push(share);
    }
  }
  return { own, containing };
}

/** True if `path` has ANY (own or containing) active share — the cheap
 * check `ExplorerTree` uses to decide whether to render a glyph at all. */
export function hasAnyShareIndicator<T extends ShareIndicatorInput>(shares: readonly T[], path: string): boolean {
  const { own, containing } = computeShareIndicator(shares, path);
  return own.length > 0 || containing.length > 0;
}

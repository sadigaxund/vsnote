/**
 * R5-6 "Update share" — client-side half of the stale-share contract. The
 * server's content hash is NOT a bolted-on second hash column: it's
 * `models.Blob.id`, already the sha256 hex of the exact bytes stored
 * (`hashlib.sha256(content).hexdigest()`, see `server/app/routers/
 * shares.py::create_blob` and `models.Blob`'s docstring). To decide
 * "is this share stale" client-side without a round trip, this module
 * reproduces that exact digest over the SAME bytes-in/hex-out contract:
 * `crypto.subtle.digest("SHA-256", ...)` over the UTF-8 encoding of the
 * file's current text content, hex-encoded lowercase.
 *
 * This MUST byte-for-byte agree with the server for non-ASCII content too
 * — `TextEncoder`'s UTF-8 output is exactly what `str.encode("utf-8")`/
 * `file.read()` (the raw upload bytes FastAPI hands to `hashlib.sha256`)
 * produce, so no separate encoding path is needed on either side. See
 * `tests/unit/contentHash.test.ts` for the round-trip proof against a
 * handful of fixed strings/hashes, ASCII and non-ASCII alike.
 *
 * `crypto.subtle` requires a secure context (https, or localhost in dev) —
 * every environment this app ships to already satisfies that (same
 * assumption `security.ts`'s other Web Crypto users make), so this never
 * needs an insecure-context fallback.
 */

/** sha256 hex digest of `text`, encoded as UTF-8 — matches the server's
 * `hashlib.sha256(content).hexdigest()` over the exact bytes a file's
 * content becomes when POSTed as a blob. */
export async function sha256HexOfText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The three states a share's row can be in relative to the vault file it
 * was published from — never a plain boolean, so "the file is gone" isn't
 * conflated with "the file changed" (they need different chip copy, see
 * `SharedView.tsx`). `"unknown"` is the loading/not-yet-computed state
 * (never rendered as a chip; callers gate on it to show nothing rather
 * than a wrong answer). */
export type ShareFreshness = "fresh" | "stale" | "missing" | "unknown";

/** Pure predicate — the whole staleness rule in one place, unit-tested
 * independent of any fetch/hash plumbing. `currentHash: null` means the
 * source file could not be read (deleted/moved out from under the share,
 * or a genuine read error) and always resolves to `"missing"`, distinct
 * from `"stale"` (file exists, content differs) — see `SharedView.tsx`'s
 * chip copy for why the two need to read differently to an owner. */
export function computeFreshness(currentHash: string | null, blobId: string | null | undefined): ShareFreshness {
  if (currentHash === null) return "missing";
  if (!blobId) return "unknown";
  return currentHash === blobId ? "fresh" : "stale";
}

/** Minimal shape this module needs from a share row — kept generic over
 * `ShareOut` the same way `shareIndicators.ts`/`shareLinkGraph.ts` decouple
 * from the full API type. */
export interface FreshnessCheckInput {
  id: number;
  source_path: string;
  blob_id?: string | null;
}

/** Loads each share's CURRENT vault content (`loadContent`, typically a
 * vault `readTextFile`) and hashes it to compute freshness against the
 * share's pinned `blob_id`. Never throws: a `loadContent` rejection
 * (deleted/moved file) resolves that share to `"missing"` rather than
 * failing the whole batch — same "partial result beats none" discipline
 * `shareLinkGraph.ts::computeShareLinkCounts` uses. */
export async function computeShareFreshness<T extends FreshnessCheckInput>(
  shares: readonly T[],
  loadContent: (sourcePath: string) => Promise<string>,
): Promise<Map<number, ShareFreshness>> {
  const result = new Map<number, ShareFreshness>();
  await Promise.all(
    shares.map(async (share) => {
      let hash: string | null;
      try {
        hash = await sha256HexOfText(await loadContent(share.source_path));
      } catch {
        hash = null;
      }
      result.set(share.id, computeFreshness(hash, share.blob_id));
    }),
  );
  return result;
}

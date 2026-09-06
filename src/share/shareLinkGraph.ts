/**
 * Links-to / linked-from counts for the Shared view (docs/PLAN-2026-09-05-
 * refresh.md §5: "the Shared view shows links-to / linked-from per share").
 * Pure orchestration over `linksInFile.ts`'s extraction — this module's own
 * logic (the counting/inversion) is unit-tested with a fake content loader
 * (`tests/unit/shareLinkGraph.test.ts`); the network/fs reads it drives are
 * not.
 */
import { extractRelativeFileLinks } from "./linksInFile";
import type { ShareOut } from "./api";

export interface ShareLinkCounts {
  /** How many of THIS share's own outgoing relative links resolve to
   * another of the owner's active shares. */
  linksTo: number;
  /** How many other active shares have an outgoing link that resolves to
   * THIS share's `source_path`. */
  linkedFrom: number;
}

/** Loads each active share's file content (`loadContent`, typically a vault
 * `readTextFile`) and computes the link graph across ALL of them. Never
 * throws: a share whose content can't be loaded (deleted file, offline)
 * contributes zero outgoing links rather than failing the whole
 * computation — a partial graph beats none for an audit view. */
export async function computeShareLinkCounts(
  shares: readonly ShareOut[],
  loadContent: (sourcePath: string) => Promise<string>,
): Promise<Map<number, ShareLinkCounts>> {
  const active = shares.filter((s) => !s.revoked_at);
  const byPath = new Map(active.map((s) => [s.source_path, s]));
  const outgoing = new Map<number, Set<number>>(); // share id -> set of target share ids

  await Promise.all(
    active.map(async (share) => {
      let content: string;
      try {
        content = await loadContent(share.source_path);
      } catch {
        outgoing.set(share.id, new Set());
        return;
      }
      const links = extractRelativeFileLinks(share.source_path, content);
      const targets = new Set<number>();
      for (const link of links) {
        const target = byPath.get(link.target);
        if (target && target.id !== share.id) targets.add(target.id);
      }
      outgoing.set(share.id, targets);
    }),
  );

  const counts = new Map<number, ShareLinkCounts>();
  for (const share of active) counts.set(share.id, { linksTo: outgoing.get(share.id)?.size ?? 0, linkedFrom: 0 });
  for (const [, targets] of outgoing) {
    for (const targetId of targets) {
      const entry = counts.get(targetId);
      if (entry) entry.linkedFrom += 1;
    }
  }
  return counts;
}

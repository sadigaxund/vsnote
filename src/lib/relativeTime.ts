/**
 * "last pushed Xm ago"-style relative time formatting for `useGitStore`'s
 * `lastSyncedAt` (a raw epoch timestamp, not a pre-formatted string —
 * strings go stale the instant they're rendered) — `StatusBar.tsx`
 * re-derives the label on a tick interval so it visibly counts up without a
 * page reload (IMPLEMENTATION-PLAN.md Phase 5's "relative timestamp
 * ticking"; PLAN-2026-09-05-refresh.md §1 item 3 renamed the wording from
 * "synced" to "last pushed" as part of the status bar's durability
 * indicator — durable means pushed to the server vault, not merely
 * committed locally).
 */
function relativeAgo(deltaMs: number): string {
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** "last pushed Xm ago" / "never pushed" — the durability-indicator wording
 * (PLAN-2026-09-05-refresh.md §1 item 3): `lastSyncedAt` is set on every
 * successful push/pull/sync (`useGitStore.ts`'s doc), so it's already
 * exactly "the last time local history reached the server vault", the
 * plain-language claim this label makes. */
export function formatLastPushedLabel(lastSyncedAt: number | null, now: number = Date.now()): string {
  if (lastSyncedAt === null) return "never pushed";
  return `last pushed ${relativeAgo(Math.max(0, now - lastSyncedAt))}`;
}

/** Bare "Xm ago" / "Never" for a nullable EPOCH-SECONDS timestamp (the
 * Shared view's created/last-accessed columns — `ShareOut.created_at`/
 * `last_access_at` are seconds, unlike `lastSyncedAt` above which is
 * milliseconds; both funnel through the same `relativeAgo` so the two
 * surfaces never drift in wording). */
export function formatRelativeEpochSeconds(epochSeconds: number | null | undefined, now: number = Date.now()): string {
  if (epochSeconds == null) return "Never";
  return relativeAgo(Math.max(0, now - epochSeconds * 1000));
}

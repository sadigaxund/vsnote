/**
 * "synced Xm ago"-style relative time formatting, shared by `useGitStore`
 * (which persists the raw epoch timestamp, not a pre-formatted string —
 * strings go stale the instant they're rendered) and `StatusBar.tsx` (which
 * re-derives the label on a tick interval so it visibly counts up without a
 * page reload — IMPLEMENTATION-PLAN.md Phase 5: "'synced Xm ago' relative
 * timestamp ticking").
 */
export function formatSyncedLabel(lastSyncedAt: number | null, now: number = Date.now()): string {
  // Phase 11 (real sync) — `null` means "never synced yet" (a fresh vault
  // with no persisted sync history), distinct from any real elapsed time.
  if (lastSyncedAt === null) return "not synced yet";
  const deltaMs = Math.max(0, now - lastSyncedAt);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "synced just now";
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `synced ${days}d ago`;
}

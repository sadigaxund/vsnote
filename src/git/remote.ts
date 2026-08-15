/**
 * Simulated remote — CLAUDE.md rule 3 / ARCHITECTURE.md: "no real network
 * git... simulated remote (ahead/behind counters + fake push/pull with
 * latency)". There is no actual remote; push/pull/fetch here just resolve
 * after a latency delay and report the counters a real sync would leave
 * behind. `useGitStore` owns the actual ahead/behind/syncedLabel state and
 * calls these to decide how to update it.
 */
export interface SyncCounts {
  ahead: number;
  behind: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends local commits to the remote: ahead drops to 0, behind unchanged. */
export async function simulatePush(current: SyncCounts): Promise<SyncCounts> {
  await delay(900);
  return { ahead: 0, behind: current.behind };
}

/** Brings remote commits down: behind drops to 0, ahead unchanged. */
export async function simulatePull(current: SyncCounts): Promise<SyncCounts> {
  await delay(900);
  return { ahead: current.ahead, behind: 0 };
}

/** Checks the remote without changing the working tree — counts as-is. */
export async function simulateFetch(current: SyncCounts): Promise<SyncCounts> {
  await delay(500);
  return { ...current };
}

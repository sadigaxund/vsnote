/**
 * The PURE half of `runScriptsLogic.ts`'s failure-copy fix (review round
 * 2) — split into its own module specifically so `tests/unit/
 * runScriptsLogic.test.ts` can exercise it directly without transitively
 * importing `src/stores/useMarkiiStore.ts` (which reaches `src/markii/
 * platform/browser/` and, through it, `src/fs/client.ts` — instantiating
 * lightning-fs on import, exactly what `tests/unit/fsIsolation.test.ts`'s
 * ratchet forbids a new unit test file from doing transitively, the same
 * reason `markiiGrantStore.test.ts`/`markiiValuePersistence.test.ts` test
 * against a fake `FileOps` instead of the real one). `runScriptsLogic.ts`
 * (which DOES need `useMarkiiStore` for the actual run) re-exports/uses
 * everything here.
 *
 * See `runScriptsLogic.ts`'s own module doc for the full writeup of WHY
 * this logic exists (denied network/bundle access misclassified as a
 * script bug by `@markii/lua`; internal chunk identifiers/tracebacks that
 * must never reach a toast) — this file is only the "what," not the "why."
 */
import type { FailureKind, RunSummaryEntry } from "@markii/runtime";

export const FAILURE_KIND_LABEL: Record<FailureKind, string> = {
  "script-error": "the script raised an error",
  "capability-denied": "a requested capability was not granted",
  "tier-blocked": "that action needs a manual run",
  limit: "the script ran too long and was stopped",
};

/** Max characters of a cleaned error detail kept in a toast — short by design; a longer message is truncated, never shown in full. */
const MAX_DETAIL_LENGTH = 140;

/**
 * Strips a Lua error string down to something safe and short to show a
 * user: the text before any `stack traceback:` block, with the leading
 * `[string "..."]:<line>:` chunk-location prefix removed (that prefix is
 * where `__smd_user_chunk` — markii's internal chunk wrapper name — would
 * otherwise leak), collapsed to one line and capped in length. Never
 * throws; an empty or already-clean input passes through unchanged
 * (besides whitespace collapsing).
 */
export function cleanErrorMessage(raw: string): string {
  const beforeTraceback = raw.split(/stack traceback:/i)[0] ?? raw;
  const withoutChunkPrefix = beforeTraceback.replace(/^\s*\[string ".*?"\]:\d+:\s*/, "");
  const oneLine = withoutChunkPrefix.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_DETAIL_LENGTH) return oneLine;
  return `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1).trimEnd()}…`;
}

/** True when `message` is the exact Lua "indexing a nil global" shape for `globalName`. */
function isNilGlobalError(message: string, globalName: string): boolean {
  return new RegExp(`\\(global '${globalName}'\\)`).test(message);
}

/** Builds one failed script's user-facing reason. Never includes a raw traceback or an internal chunk name. */
export function describeFailureEntry(entry: RunSummaryEntry): string {
  const raw = entry.error ?? "";
  if (isNilGlobalError(raw, "net")) {
    return `${entry.name}: network access was denied for this run (change this in Settings, Packs)`;
  }
  if (isNilGlobalError(raw, "bundle")) {
    return `${entry.name}: this note has no bundle attached, so bundle access failed`;
  }
  const label = FAILURE_KIND_LABEL[entry.failureKind ?? "script-error"];
  const detail = cleanErrorMessage(raw);
  return detail ? `${entry.name}: ${label} (${detail})` : `${entry.name}: ${label}`;
}

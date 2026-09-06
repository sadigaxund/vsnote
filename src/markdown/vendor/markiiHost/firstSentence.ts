/**
 * Vendored from markii-org/markii (MIT license), pinned to v0.13.0:
 * packages/markii-host/src/insert/first-sentence.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/insert/first-sentence.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. Copied verbatim.
 */
export function firstSentence(description: string): string {
  const boundary = /\.\s+(?=[A-Z])/.exec(description);
  if (boundary === null) return description;
  return description.slice(0, boundary.index + 1);
}

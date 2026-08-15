/**
 * Phase 11 (real sync) — pure logic split out of `git/remote.ts` so it's
 * unit-testable without a real repo/network: divergence classification (the
 * fast-forward-only policy's decision table) and the `GitAuth` shape
 * isomorphic-git's `onAuth` callback needs. `git/remote.ts` is the only
 * consumer; kept separate because everything here is synchronous and has no
 * `isomorphic-git`/`fs` dependency, unlike the rest of that module.
 */
import type { GitAuth } from "isomorphic-git";

export interface AheadBehind {
  ahead: number;
  behind: number;
}

/**
 * The four states local/remote can be in, relative to their common merge
 * base. Drives both push and pull's fast-forward-only policy (below) and
 * the honest status message shown in the UI (`StatusBar.tsx`/
 * `SettingsView.tsx`).
 */
export type DivergenceState = "up-to-date" | "ahead-only" | "behind-only" | "diverged";

export function classifyDivergence({ ahead, behind }: AheadBehind): DivergenceState {
  if (ahead === 0 && behind === 0) return "up-to-date";
  if (ahead > 0 && behind === 0) return "ahead-only";
  if (ahead === 0 && behind > 0) return "behind-only";
  return "diverged";
}

/** v2.0 is fast-forward-only (IMPLEMENTATION-PLAN-V2.md Phase 11, roadmap
 * §4): a push is only ever attempted when the remote has nothing local
 * lacks — "ahead-only" is the sole state a real push call happens for.
 * "up-to-date"/"behind-only" are both legitimate push no-ops (real `git
 * push` says "Everything up-to-date" in both cases too, even when behind);
 * "diverged" is the one state that must be REFUSED with an explanation,
 * never auto-merged, never force-pushed. */
export function pushAction(state: DivergenceState): "push" | "noop" | "refuse" {
  if (state === "ahead-only") return "push";
  if (state === "diverged") return "refuse";
  return "noop";
}

/** Symmetric policy for pull: only "behind-only" needs a real
 * fast-forward. "diverged" refuses (a real merge is out of v2.0 scope);
 * "up-to-date"/"ahead-only" are no-ops (nothing to bring down). */
export function pullAction(state: DivergenceState): "fast-forward" | "noop" | "refuse" {
  if (state === "behind-only") return "fast-forward";
  if (state === "diverged") return "refuse";
  return "noop";
}

export const DIVERGED_MESSAGE =
  "Local and remote have diverged — Slate only fast-forwards in v2.0, so it won't auto-merge or force-push. Resolve manually (or ask a maintainer), then sync again.";

/** Shapes an isomorphic-git `GitAuth` value from a plaintext token — used
 * as the return value of every `onAuth` callback in `git/remote.ts`. Uses
 * the `headers` form (`Authorization: Bearer <token>`) rather than
 * `username`/`password`, since the Phase 11 server accepts Bearer directly
 * (`server/app/routers/git_http.py`) and this avoids isomorphic-git having
 * to base64-encode Basic credentials itself. Returns `undefined` for a
 * blank/whitespace-only token so an unconfigured token cleanly produces "no
 * credentials sent" (→ the server's own 401) rather than sending a
 * malformed empty Bearer header. */
export function buildGitAuth(token: string): GitAuth | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  return { headers: { Authorization: `Bearer ${trimmed}` } };
}

/** Browsers can't speak `git://` or `ssh://` (no raw TCP) — the Settings
 * "Git & Sync" hint already says as much for the token field; this is the
 * corresponding pure check so "Test connection" (and any future remote-URL
 * validation) can give an honest, specific reason instead of just letting a
 * malformed URL fail deep inside isomorphic-git with an opaque error. */
export function isHttpRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

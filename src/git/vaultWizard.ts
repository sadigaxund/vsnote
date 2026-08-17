/**
 * Phase 17 Milestone C2 — pure derivation of which step Settings → Git &
 * Sync's server-vault surface shows. Kept out of `VaultSetupPanel.tsx`
 * entirely (no React, no I/O) so it's directly unit-testable under this
 * repo's `environment: "node"` vitest config, same discipline
 * `git/autoSyncPolicy.ts`/`git/remote.ts`'s pure resolvers already
 * established.
 *
 * The SERVER only ever answers "initialized: true/false" (`VaultOut`) —
 * there is no server-side notion of "the wizard is on step 2" at all, by
 * design (Milestone A's `GET /api/vault` is side-effect-free and re-read
 * on every poll). The "connect an external remote" step is therefore a
 * purely CLIENT-side, THIS-SESSION affordance: once `POST /api/vault/init`
 * succeeds, the panel shows step 2 until the user explicitly skips or
 * finishes it, then never shows it again for the rest of that mount (a
 * reload, or a fresh Settings-tab mount, goes straight to the management
 * surface below — DESIGN-SPEC's "When initialized: true: no wizard" rule,
 * verbatim). `awaitingRemoteStep` is `VaultSetupPanel.tsx`'s own
 * `useState`, true only in the narrow window between a successful init
 * call and the user dismissing step 2 either way.
 */

export type VaultWizardPhase = "create" | "connect-remote" | "management";

export interface VaultWizardPhaseInput {
  /** `VaultOut.initialized` from the most recent `GET /api/vault` — `null`
   * before the first successful fetch (loading/unreachable), which callers
   * handle as its own separate UI state upstream of this function (never
   * passed in as `false`, which would misreport "no vault yet" while the
   * real answer is simply not known). */
  vaultInitialized: boolean;
  /** See module doc — true only right after THIS session's own init call
   * succeeded, until skipped/finished. Ignored entirely while
   * `vaultInitialized` is false (there is nothing to connect a remote FOR
   * yet). */
  awaitingRemoteStep: boolean;
}

export function deriveVaultWizardPhase(input: VaultWizardPhaseInput): VaultWizardPhase {
  if (!input.vaultInitialized) return "create";
  if (input.awaitingRemoteStep) return "connect-remote";
  return "management";
}

/** Found during Phase 17 verification against a real mounted vault, not
 * theorised: a mounted vault's working tree only ever reflects the branch
 * its HEAD points at (`app/vault.py::checkout_head_into_worktree` updates
 * files from HEAD, and never moves HEAD itself — a push updates whichever
 * ref it names). So if the vault was initialized on one branch and this
 * client syncs another, the push still lands as real git history, but the
 * files on the server's disk silently stop tracking it: `git clone` and an
 * editor reading the mount keep showing the OTHER branch.
 *
 * That is invisible without being told, so the panel says it. Pure and
 * separate from the component for the usual testability reason.
 *
 * Returns `false` (nothing to warn about) unless BOTH branch names are
 * actually known and actually differ — an empty/unknown server branch means
 * a vault with no commits yet, where nothing is being tracked either way. */
export function hasVaultBranchMismatch(clientBranch: string, serverHeadBranch: string | null | undefined): boolean {
  const client = clientBranch.trim();
  const server = (serverHeadBranch ?? "").trim();
  if (!client || !server) return false;
  return client !== server;
}

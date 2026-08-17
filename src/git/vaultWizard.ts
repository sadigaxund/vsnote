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

/**
 * Pure step-index derivation for Git & Sync's guided connection card
 * (`Git.tsx`'s "Connection" `SettingsRow`, round 5). Extracted out of the
 * JSX (R5-3) so the mapping from real store/derived state to a `Stepper`
 * `current` index is independently unit-testable, per CLAUDE.md's TS-strict
 * / test-what-you-fix expectations.
 *
 * A step is "done" only from REAL state — a valid remote, a non-empty
 * resolved credential, a last test that actually succeeded — never from
 * "the user clicked past this step" (design-health P1, see `Git.tsx`'s own
 * module doc). Once the test genuinely passes, this returns `steps.length`
 * (one past the last valid index) as the sanctioned TERMINAL state:
 * `Stepper` (R5-3) now treats `current >= steps.length` as "every step
 * done", rendering "Step {N} of {N} · {doneLabel}" instead of the old,
 * broken "Step {N+1} of {N}" with a blank current-step label.
 */
export const CONNECTION_STEP_COUNT = 3;

export interface ConnectionStepState {
  remoteStepDone: boolean;
  credentialStepDone: boolean;
  testStepDone: boolean;
}

/**
 * Returns:
 *   0 — remote not yet valid
 *   1 — remote valid, credential still empty
 *   2 — remote + credential valid, test not yet passed
 *   3 — everything valid AND the last test passed (terminal state)
 */
export function deriveConnectionStepIndex({ remoteStepDone, credentialStepDone, testStepDone }: ConnectionStepState): number {
  if (!remoteStepDone) return 0;
  if (!credentialStepDone) return 1;
  if (testStepDone) return CONNECTION_STEP_COUNT;
  return 2;
}

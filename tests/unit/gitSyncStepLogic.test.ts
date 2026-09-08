/**
 * `components/local/gitSyncStepLogic.ts`'s `deriveConnectionStepIndex` —
 * extracted (R5-3) out of `Git.tsx`'s JSX so every remote/credential/test
 * combination is pinned here rather than only exercised indirectly through
 * the rendered card. Covers the terminal state (test passed => index 3,
 * one past the last valid step) that `Stepper.tsx` now renders as "Step 3
 * of 3 · Connected" instead of the old, broken "Step 4 of 3".
 */
import { describe, expect, it } from "vitest";
import { CONNECTION_STEP_COUNT, deriveConnectionStepIndex } from "../../src/components/local/gitSyncStepLogic";

describe("deriveConnectionStepIndex", () => {
  it("is 0 when the remote itself isn't valid yet, regardless of credential/test state", () => {
    expect(deriveConnectionStepIndex({ remoteStepDone: false, credentialStepDone: false, testStepDone: false })).toBe(0);
    expect(deriveConnectionStepIndex({ remoteStepDone: false, credentialStepDone: true, testStepDone: false })).toBe(0);
    expect(deriveConnectionStepIndex({ remoteStepDone: false, credentialStepDone: true, testStepDone: true })).toBe(0);
    expect(deriveConnectionStepIndex({ remoteStepDone: false, credentialStepDone: false, testStepDone: true })).toBe(0);
  });

  it("is 1 once the remote is valid but the credential is still empty", () => {
    expect(deriveConnectionStepIndex({ remoteStepDone: true, credentialStepDone: false, testStepDone: false })).toBe(1);
    // A stale `testStepDone: true` from a since-cleared credential must not
    // leapfrog step 2 — credential state gates the test step.
    expect(deriveConnectionStepIndex({ remoteStepDone: true, credentialStepDone: false, testStepDone: true })).toBe(1);
  });

  it("is 2 once remote + credential are valid but the last test hasn't passed", () => {
    expect(deriveConnectionStepIndex({ remoteStepDone: true, credentialStepDone: true, testStepDone: false })).toBe(2);
  });

  it("is the terminal index (steps.length) once everything is valid and the test actually passed", () => {
    const index = deriveConnectionStepIndex({ remoteStepDone: true, credentialStepDone: true, testStepDone: true });
    expect(index).toBe(CONNECTION_STEP_COUNT);
    expect(index).toBe(3);
  });
});

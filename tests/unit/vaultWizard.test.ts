import { describe, expect, it } from "vitest";
import { deriveVaultWizardPhase, hasVaultBranchMismatch } from "../../src/git/vaultWizard";

describe("deriveVaultWizardPhase", () => {
  it("stays on the create step while the server reports no vault yet", () => {
    expect(deriveVaultWizardPhase({ vaultInitialized: false, awaitingRemoteStep: false })).toBe("create");
    // Even a stray true `awaitingRemoteStep` (shouldn't happen, but must
    // never be trusted over the server's own initialized flag) still shows
    // step 1 — there is nothing to connect a remote FOR yet.
    expect(deriveVaultWizardPhase({ vaultInitialized: false, awaitingRemoteStep: true })).toBe("create");
  });

  it("shows the optional connect-remote step right after this session's own init succeeds", () => {
    expect(deriveVaultWizardPhase({ vaultInitialized: true, awaitingRemoteStep: true })).toBe("connect-remote");
  });

  it("goes straight to the management surface once initialized and the remote step is done/skipped", () => {
    expect(deriveVaultWizardPhase({ vaultInitialized: true, awaitingRemoteStep: false })).toBe("management");
  });

  it("never shows the wizard at all for an already-initialized vault on a fresh mount (DESIGN-SPEC rule)", () => {
    // A fresh mount always starts with `awaitingRemoteStep: false` (it's
    // local component state, never persisted) — this is exactly what makes
    // "initialized: true -> no wizard" hold on reload, per the module doc.
    expect(deriveVaultWizardPhase({ vaultInitialized: true, awaitingRemoteStep: false })).toBe("management");
  });
});

describe("hasVaultBranchMismatch", () => {
  it("flags a real disagreement between the client's branch and the vault's checked-out branch", () => {
    expect(hasVaultBranchMismatch("feat/incremental-index", "main")).toBe(true);
  });

  it("is quiet when both agree", () => {
    expect(hasVaultBranchMismatch("main", "main")).toBe(false);
  });

  it("is quiet when the server branch is unknown (a vault with no commits yet)", () => {
    expect(hasVaultBranchMismatch("main", null)).toBe(false);
    expect(hasVaultBranchMismatch("main", undefined)).toBe(false);
    expect(hasVaultBranchMismatch("main", "   ")).toBe(false);
  });

  it("is quiet when the client branch is unknown", () => {
    expect(hasVaultBranchMismatch("", "main")).toBe(false);
  });

  it("ignores surrounding whitespace rather than reporting a phantom mismatch", () => {
    expect(hasVaultBranchMismatch("  main  ", "main")).toBe(false);
  });
});

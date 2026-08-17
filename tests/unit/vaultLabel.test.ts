/**
 * Pins DESIGN-SPEC Amendments round 5 item 41(c)'s "vault display name"
 * mapping (`src/lib/vaultLabel.ts::resolveVaultDisplayLabel`) — the label
 * shown for the tree's top folder changes, while `fs/paths.ts`'s real path
 * resolution (`displayToFsPath`/`fsToDisplayPath`, keyed on the literal
 * `VAULT_LABEL`) stays completely unaffected. That's the whole point of
 * choosing a display-name MAPPING over a real FS-root rename (see
 * `useSettingsStore.ts`'s `vaultDisplayName` doc): the two are provably
 * independent, which this test asserts directly rather than trusting it.
 */
import { describe, expect, it } from "vitest";
import { resolveVaultDisplayLabel } from "../../src/lib/vaultLabel";
import { VAULT_LABEL, displayToFsPath, fsToDisplayPath } from "../../src/fs/paths";

describe("resolveVaultDisplayLabel()", () => {
  it("falls back to the real label when no custom name is set", () => {
    expect(resolveVaultDisplayLabel("", VAULT_LABEL)).toBe(VAULT_LABEL);
  });

  it("falls back when the custom name is whitespace only", () => {
    expect(resolveVaultDisplayLabel("   ", VAULT_LABEL)).toBe(VAULT_LABEL);
  });

  it("uses the custom display name, trimmed, when one is set", () => {
    expect(resolveVaultDisplayLabel("My Notes", VAULT_LABEL)).toBe("My Notes");
    expect(resolveVaultDisplayLabel("  My Notes  ", VAULT_LABEL)).toBe("My Notes");
  });
});

describe("vault display name mapping leaves real path resolution unchanged", () => {
  it("displayToFsPath/fsToDisplayPath still key off the literal VAULT_LABEL, regardless of any display name", () => {
    // The display label is a pure render-time swap (see `useFsStore.ts`'s
    // root-node construction and `App.tsx`'s `titlebarBreadcrumb`) — it
    // never flows into `fs/paths.ts` at all. Renaming to "My Notes" (or
    // anything else) must not change what these two functions do with a
    // real display path built from the real `VAULT_LABEL`.
    const customLabel = resolveVaultDisplayLabel("My Notes", VAULT_LABEL);
    expect(customLabel).not.toBe(VAULT_LABEL);

    const displayPath = `${VAULT_LABEL}/notes/architecture.md`;
    expect(displayToFsPath(displayPath)).toBe("/vault/notes/architecture.md");
    expect(fsToDisplayPath("/vault/notes/architecture.md")).toBe(displayPath);
  });
});

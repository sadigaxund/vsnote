/**
 * DESIGN-SPEC Amendments round 5 item 41(c) — the pure "vault display name"
 * -> rendered-label mapping. Split into its own module (rather than inlined
 * in `stores/useFsStore.ts`/`App.tsx`, both files this item only gets
 * TARGETED edits in) so it's independently unit-testable and both call
 * sites stay provably in sync with each other.
 *
 * Deliberately takes `fallback` as a parameter instead of importing
 * `fs/paths.ts`'s `VAULT_LABEL` itself: this module has zero fs/path
 * dependency, which is the point — the whole design (a DISPLAY-name
 * mapping, not a real FS-root rename) rests on the rendered label and the
 * real vault path being two totally independent things that only happen to
 * share a fallback value. See `useSettingsStore.ts`'s `vaultDisplayName`
 * doc for why a display mapping was chosen over an actual rename.
 */
export function resolveVaultDisplayLabel(displayName: string, fallback: string): string {
  const trimmed = displayName.trim();
  return trimmed || fallback;
}

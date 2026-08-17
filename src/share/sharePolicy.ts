/**
 * Share-policy shaping — pure logic, unit-tested
 * (`tests/unit/sharePolicy.test.ts`). Turns the Publish dialog's
 * `PublishInput` (UI-shaped: strings for expiry, an alias that might be
 * empty) into the exact `ShareCreateIn` body `POST /api/shares` expects
 * (`server/app/schemas.py`) — extracted out of `useShareStore.publish` so
 * this shaping is testable without mocking `fetch`.
 */
import type { GrantIn, ManifestEntryIn, ShareCreateIn } from "./api";
import type { PublishInput } from "./useShareStore";

export function shareCreatePayload(input: PublishInput, blobId: string): ShareCreateIn {
  const grants: GrantIn[] | undefined = input.grants && input.grants.length > 0 ? input.grants : undefined;
  return {
    source_path: input.sourcePath,
    blob_id: blobId,
    render_mode: input.renderMode,
    general_access: input.generalAccess,
    auth_mode: input.authMode,
    // `password` only makes sense (and the backend only accepts a
    // non-empty one) when `auth_mode === "password"` — never send a
    // leftover value from a previously-toggled-off password field.
    password: input.authMode === "password" ? input.password : undefined,
    alias: input.alias && input.alias.length > 0 ? input.alias : undefined,
    expires_at: input.expiresAt,
    grants,
    // Round 7 item 57 — only meaningful for link access; omitted otherwise
    // so restricted shares never carry a stray editor default.
    link_role: input.generalAccess === "link" ? input.linkRole : undefined,
  };
}

/**
 * Phase 10.5 — the folder-share twin of `shareCreatePayload`. A SEPARATE
 * function rather than an overload of the one above: `blob_id` and
 * `manifest` are mutually exclusive on the wire (`server/app/schemas.py`'s
 * `ShareCreateIn`), and keeping them as two small pure functions means
 * `shareCreatePayload`'s existing output/tests are untouched by this phase
 * (see `tests/unit/sharePolicy.test.ts`'s exact `toEqual` assertions —
 * adding a conditional `kind`/`manifest` field to the same function would
 * have broken every one of those without changing behavior).
 */
export function shareFolderCreatePayload(input: PublishInput, manifest: ManifestEntryIn[]): ShareCreateIn {
  const grants: GrantIn[] | undefined = input.grants && input.grants.length > 0 ? input.grants : undefined;
  return {
    source_path: input.sourcePath,
    kind: "folder",
    manifest,
    render_mode: input.renderMode,
    general_access: input.generalAccess,
    auth_mode: input.authMode,
    password: input.authMode === "password" ? input.password : undefined,
    alias: input.alias && input.alias.length > 0 ? input.alias : undefined,
    expires_at: input.expiresAt,
    grants,
    link_role: input.generalAccess === "link" ? input.linkRole : undefined,
  };
}

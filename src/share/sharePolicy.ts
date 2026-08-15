/**
 * Share-policy shaping — pure logic, unit-tested
 * (`tests/unit/sharePolicy.test.ts`). Turns the Publish dialog's
 * `PublishInput` (UI-shaped: strings for expiry, an alias that might be
 * empty) into the exact `ShareCreateIn` body `POST /api/shares` expects
 * (`server/app/schemas.py`) — extracted out of `useShareStore.publish` so
 * this shaping is testable without mocking `fetch`.
 */
import type { GrantIn, ShareCreateIn } from "./api";
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
  };
}

/**
 * Custom-alias validation — pure logic, unit-tested (`tests/unit/alias.test.ts`).
 * Mirrors the backend's `SLUG_RE` exactly (`server/app/security.py`,
 * `^[A-Za-z0-9_-]{8,64}$` — see `docs/ROADMAP-SHARING-AUTH.md` §1 and
 * `server/app/routers/shares.py`'s `validate_slug_format` calls) so the
 * Publish dialog can show a precise inline error BEFORE ever making a
 * request, rather than round-tripping to the server just to learn the
 * format was wrong (`POST /api/shares` would 422 on this same rule).
 */

export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type AliasValidation = { valid: true } | { valid: false; reason: string };

/** Empty string is treated as "no alias chosen" — valid, since the field is
 * optional (the backend generates a random slug when omitted). */
export function validateAlias(alias: string): AliasValidation {
  if (alias.length === 0) return { valid: true };
  if (alias.length < 8) return { valid: false, reason: "Must be at least 8 characters." };
  if (alias.length > 64) return { valid: false, reason: "Must be at most 64 characters." };
  if (!ALIAS_PATTERN.test(alias)) {
    return { valid: false, reason: "Only letters, digits, hyphens, and underscores are allowed." };
  }
  return { valid: true };
}

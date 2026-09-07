/**
 * Custom-alias validation — pure logic, unit-tested (`tests/unit/alias.test.ts`).
 * Mirrors the backend's `ALIAS_RE`/`alias_error` EXACTLY
 * (`server/app/security.py`; see that file's comment for why aliases get
 * their OWN pattern instead of sharing `SLUG_RE`, which still governs
 * generated slugs) so the Publish dialog can show a precise inline error
 * BEFORE ever making a request, rather than round-tripping to the server
 * just to learn the format was wrong (`POST /api/shares` would 422 on this
 * same rule).
 *
 * R3-4 — alias rules, exactly mirroring the server:
 *   - length 2-64
 *   - lowercase-only `[a-z0-9-_]` — an uppercase character is REJECTED,
 *     never silently downcased (a silently rewritten alias would hand the
 *     owner a different URL than the one they just typed).
 */

export const ALIAS_MIN_LENGTH = 2;
export const ALIAS_MAX_LENGTH = 64;
export const ALIAS_PATTERN = new RegExp(`^[a-z0-9_-]{${ALIAS_MIN_LENGTH},${ALIAS_MAX_LENGTH}}$`);

/** Mirrors `server/app/security.py::RESERVED_ALIASES` exactly — see that
 * constant's comment for where every entry comes from (a fixed list of
 * words that read as system paths, PLUS every top-level path this server
 * or the SPA actually serves today, enumerated from `server/app/main.py`
 * and `src/main.tsx`). Checked case-insensitively, same as the server.
 * Kept in sync by hand (small, stable set); a drift would only ever
 * produce a client-side false-negative (server still rejects), never a
 * false-positive block. */
export const RESERVED_ALIASES: ReadonlySet<string> = new Set([
  "api",
  "share",
  "git",
  "assets",
  "static",
  "admin",
  "login",
  "logout",
  "health",
  "s",
  "raw",
]);

export type AliasValidation = { valid: true } | { valid: false; reason: string };

/** Empty string is treated as "no alias chosen" — valid, since the field is
 * optional (the backend generates a random slug when omitted). */
export function validateAlias(alias: string): AliasValidation {
  if (alias.length === 0) return { valid: true };
  if (alias.length < ALIAS_MIN_LENGTH || alias.length > ALIAS_MAX_LENGTH) {
    return { valid: false, reason: `Must be ${ALIAS_MIN_LENGTH}-${ALIAS_MAX_LENGTH} characters.` };
  }
  if (!ALIAS_PATTERN.test(alias)) {
    // Covers uppercase (named explicitly per R3-4 — never silently
    // downcased) as well as any other disallowed character.
    return { valid: false, reason: "Use lowercase letters, digits, hyphens and underscores." };
  }
  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    return { valid: false, reason: "This word is reserved. Choose a different alias." };
  }
  return { valid: true };
}

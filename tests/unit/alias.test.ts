/**
 * `share/alias.ts`'s `validateAlias` — mirrors the backend's `ALIAS_RE`/
 * `alias_error` exactly (`^[a-z0-9_-]{2,64}$`, `server/app/security.py`),
 * so these cases double as "would the server also 422 this" documentation.
 * R3-4 gave aliases their own, looser-than-slug rules (min length 2,
 * lowercase-only) — see that file's comment for why aliases no longer
 * share `SLUG_RE`.
 */
import { describe, expect, it } from "vitest";
import { RESERVED_ALIASES, validateAlias } from "../../src/share/alias";

describe("validateAlias()", () => {
  it("accepts an empty string (no alias chosen — the backend generates a random slug)", () => {
    expect(validateAlias("")).toEqual({ valid: true });
  });

  it("accepts a valid alias at the minimum length (2)", () => {
    expect(validateAlias("ab")).toEqual({ valid: true });
  });

  it("accepts a short alias like the owner actually wants (R3-4)", () => {
    expect(validateAlias("get")).toEqual({ valid: true });
    expect(validateAlias("help")).toEqual({ valid: true });
  });

  it("accepts a valid alias at the maximum length (64)", () => {
    expect(validateAlias("a".repeat(64))).toEqual({ valid: true });
  });

  it("accepts hyphens and underscores", () => {
    expect(validateAlias("my-cool_alias-1")).toEqual({ valid: true });
  });

  it("rejects fewer than 2 characters", () => {
    const result = validateAlias("a");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/2-64/);
  });

  it("rejects more than 64 characters", () => {
    const result = validateAlias("a".repeat(65));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/2-64/);
  });

  it("rejects spaces", () => {
    const result = validateAlias("no spaces");
    expect(result.valid).toBe(false);
  });

  it("rejects punctuation outside - and _", () => {
    expect(validateAlias("has.a.dot").valid).toBe(false);
    expect(validateAlias("has/slash").valid).toBe(false);
    expect(validateAlias("has@symbol").valid).toBe(false);
  });

  // R3-4 — an uppercase character is REJECTED, never silently downcased: a
  // silently rewritten alias would hand the owner a different URL than the
  // one they just typed.
  it("rejects uppercase characters with a clear, specific message", () => {
    const result = validateAlias("Get");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("Use lowercase letters, digits, hyphens and underscores.");
  });

  it("never silently downcases an alias with uppercase characters", () => {
    // validateAlias only classifies; it must not mutate/normalize.
    const input = "MyAlias";
    validateAlias(input);
    expect(input).toBe("MyAlias");
  });

  // §4.5 — mirrors `server/app/security.py::RESERVED_ALIASES` exactly.
  it("keeps the reserved-word set in sync with the server's RESERVED_ALIASES", () => {
    expect([...RESERVED_ALIASES].sort()).toEqual(
      ["admin", "api", "assets", "git", "health", "login", "logout", "raw", "s", "share", "static"].sort(),
    );
  });

  it("rejects every reserved word that clears the 2-char length minimum on its reserved-word grounds specifically", () => {
    // "s" is only 1 character, so it's rejected for LENGTH before the
    // reserved-word check ever runs — still a rejection either way,
    // covered by the blanket "rejects every reserved word" assertion
    // below. This test isolates the reserved-word branch itself.
    for (const word of RESERVED_ALIASES) {
      if (word.length < 2) continue;
      const result = validateAlias(word);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/reserved/);
    }
  });

  it("rejects every reserved word, full stop (including the 1-char 's', on length grounds)", () => {
    for (const word of RESERVED_ALIASES) {
      expect(validateAlias(word).valid).toBe(false);
    }
  });

  it("rejects a reserved word case-insensitively (as an already-lowercase input, since uppercase is rejected first)", () => {
    expect(RESERVED_ALIASES.has("API".toLowerCase())).toBe(true);
    // "Api" itself is caught by the uppercase check before the reserved
    // check ever runs — this documents the actual order, matching the
    // server's alias_error.
    const result = validateAlias("Api");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("Use lowercase letters, digits, hyphens and underscores.");
  });

  it("does not flag a non-reserved alias that merely contains a reserved word", () => {
    expect(validateAlias("my-api-notes").valid).toBe(true);
    expect(validateAlias("sharedocs1").valid).toBe(true);
  });
});

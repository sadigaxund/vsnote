/**
 * `share/alias.ts`'s `validateAlias` — mirrors the backend's `SLUG_RE`
 * exactly (`^[A-Za-z0-9_-]{8,64}$`, `server/app/security.py`), so these
 * cases double as "would the server also 422 this" documentation.
 */
import { describe, expect, it } from "vitest";
import { validateAlias } from "../../src/share/alias";

describe("validateAlias()", () => {
  it("accepts an empty string (no alias chosen — the backend generates a random slug)", () => {
    expect(validateAlias("")).toEqual({ valid: true });
  });

  it("accepts a valid alias at the minimum length (8)", () => {
    expect(validateAlias("abcd1234")).toEqual({ valid: true });
  });

  it("accepts a valid alias at the maximum length (64)", () => {
    expect(validateAlias("a".repeat(64))).toEqual({ valid: true });
  });

  it("accepts hyphens and underscores", () => {
    expect(validateAlias("my-cool_alias-1")).toEqual({ valid: true });
  });

  it("rejects fewer than 8 characters", () => {
    const result = validateAlias("short1");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/at least 8/);
  });

  it("rejects more than 64 characters", () => {
    const result = validateAlias("a".repeat(65));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/at most 64/);
  });

  it("rejects spaces", () => {
    const result = validateAlias("no spaces allowed!");
    expect(result.valid).toBe(false);
  });

  it("rejects punctuation outside - and _", () => {
    expect(validateAlias("has.a.dot.here").valid).toBe(false);
    expect(validateAlias("has/a/slash!!").valid).toBe(false);
    expect(validateAlias("has@symbol!!!!").valid).toBe(false);
  });
});

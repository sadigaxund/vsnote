/**
 * Phase M3, worker 3 (review round 2) — unit tests for
 * `scriptFailureCopy.ts`'s failure-copy cleanup (the pure half of
 * `runScriptsLogic.ts`, split out specifically so this test file never
 * transitively imports `useMarkiiStore.ts` -> `src/fs/client.ts` — see
 * that module's own doc): denied network/bundle access must be reported
 * honestly (not as a generic script bug), and no internal chunk identifier
 * or raw traceback may ever reach a toast.
 */
import { describe, expect, it } from "vitest";
import { cleanErrorMessage, describeFailureEntry } from "../../src/components/local/scriptFailureCopy";
import type { RunSummaryEntry } from "@markii/runtime";

const REAL_NET_ERROR =
  '[string "local function __smd_user_chunk()..."]:2: attempt to index a nil value (global \'net\')\nstack traceback:\n\t[string "local function __smd_user_chunk()..."]:5: in main chunk';

describe("cleanErrorMessage", () => {
  it("drops everything from stack traceback: onward", () => {
    expect(cleanErrorMessage(REAL_NET_ERROR)).not.toMatch(/stack traceback/i);
  });

  it("strips the internal chunk-location prefix", () => {
    expect(cleanErrorMessage(REAL_NET_ERROR)).not.toContain("__smd_user_chunk");
    expect(cleanErrorMessage(REAL_NET_ERROR)).not.toMatch(/^\[string/);
  });

  it("collapses to one line and trims", () => {
    expect(cleanErrorMessage("line one\n\nline two  ")).toBe("line one\n\nline two".replace(/\s+/g, " ").trim());
  });

  it("truncates a long message", () => {
    const long = "x".repeat(500);
    const cleaned = cleanErrorMessage(long);
    expect(cleaned.length).toBeLessThan(150);
    expect(cleaned.endsWith("…")).toBe(true);
  });

  it("passes an already-short, clean message through unchanged", () => {
    expect(cleanErrorMessage('net access to host "evil.example.com" not granted for GET')).toBe(
      'net access to host "evil.example.com" not granted for GET',
    );
  });
});

function errorEntry(overrides: Partial<RunSummaryEntry>): RunSummaryEntry {
  return { name: "answer", status: "error", ...overrides };
}

describe("describeFailureEntry", () => {
  it("reports a nil global 'net' error as denied network access, not a script bug", () => {
    const desc = describeFailureEntry(errorEntry({ error: REAL_NET_ERROR, failureKind: "script-error" }));
    expect(desc).toContain("network access was denied");
    expect(desc).not.toContain("__smd_user_chunk");
    expect(desc).not.toMatch(/stack traceback/i);
  });

  it("reports a nil global 'bundle' error as no bundle attached, not a script bug", () => {
    const raw = "[string \"...\"]:1: attempt to index a nil value (global 'bundle')";
    const desc = describeFailureEntry(errorEntry({ error: raw, failureKind: "script-error" }));
    expect(desc).toContain("no bundle attached");
  });

  it("a genuine script bug still reports as a script error, cleaned and short", () => {
    const raw = '[string "local function __smd_user_chunk()..."]:3: attempt to call a nil value (global \'oops\')\nstack traceback:\n\tmore lines';
    const desc = describeFailureEntry(errorEntry({ error: raw, failureKind: "script-error" }));
    expect(desc).toContain("the script raised an error");
    expect(desc).not.toContain("__smd_user_chunk");
    expect(desc).not.toMatch(/stack traceback/i);
  });

  it("a real capability-denied entry keeps its own clean message", () => {
    const desc = describeFailureEntry(
      errorEntry({ error: 'net access to host "evil.example.com" not granted for GET', failureKind: "capability-denied" }),
    );
    expect(desc).toContain("a requested capability was not granted");
    expect(desc).toContain("evil.example.com");
  });

  it("an entry with no error message at all still produces a plain label", () => {
    expect(describeFailureEntry(errorEntry({ failureKind: "limit" }))).toBe("answer: the script ran too long and was stopped");
  });
});

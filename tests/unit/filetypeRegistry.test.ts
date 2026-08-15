/**
 * Pins `filetypes/registry.ts`'s mode-availability + default-mode table
 * (DESIGN-SPEC "Modes") — the single source `EditorHeader`'s segmented
 * control and `useTabsStore`'s "what mode does a newly-opened file start
 * in" both read.
 */
import { describe, expect, it } from "vitest";
import { defaultModeFor, modeAvailabilityFor } from "../../src/filetypes/registry";

describe("filetypes/registry defaults", () => {
  it("md defaults to rendered", () => {
    expect(defaultModeFor("md")).toBe("rendered");
  });
  it("json defaults to source (the one table-explicit override besides code)", () => {
    expect(defaultModeFor("json")).toBe("source");
  });
  it("code kinds (ts/tsx/js/jsx/css) default to source", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(defaultModeFor(kind)).toBe("source");
    }
  });
  it("html/csv default to rendered (ARCHITECTURE.md's documented interpretation of the table's silence)", () => {
    expect(defaultModeFor("html")).toBe("rendered");
    expect(defaultModeFor("csv")).toBe("rendered");
  });
  it("image defaults to (and only has) rendered", () => {
    expect(defaultModeFor("image")).toBe("rendered");
  });
  it("unrecognized kinds fall back to the plain-text entry's source default", () => {
    expect(defaultModeFor("unknown")).toBe("source");
    expect(defaultModeFor(undefined)).toBe("source");
  });
});

describe("filetypes/registry modeAvailabilityFor", () => {
  it("md offers rendered+source, plus diff only when the file has a real diff", () => {
    expect(modeAvailabilityFor("md", false)).toEqual(["rendered", "source"]);
    expect(modeAvailabilityFor("md", true)).toEqual(["rendered", "source", "diff"]);
  });

  it("code kinds only ever offer source (+ diff when applicable), never rendered", () => {
    expect(modeAvailabilityFor("ts", false)).toEqual(["source"]);
    expect(modeAvailabilityFor("ts", true)).toEqual(["source", "diff"]);
  });

  it("images never offer diff, even when hasDiff is true (supportsDiff: false)", () => {
    expect(modeAvailabilityFor("image", true)).toEqual(["rendered"]);
  });

  it("folders and no-kind get no modes at all", () => {
    expect(modeAvailabilityFor("folder", true)).toEqual([]);
    expect(modeAvailabilityFor(undefined, true)).toEqual([]);
  });

  it("html/csv/json all offer rendered+source", () => {
    for (const kind of ["html", "csv", "json"] as const) {
      expect(modeAvailabilityFor(kind, false)).toEqual(["rendered", "source"]);
    }
  });

  it("the settings view tab (Phase 6.5c) gets no modes, even with a diff", () => {
    expect(modeAvailabilityFor("settings", true)).toEqual([]);
  });
});

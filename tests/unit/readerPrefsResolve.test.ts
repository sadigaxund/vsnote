/**
 * feat(share) R4 — `share/readerPrefsResolve.ts`'s pure per-content-class
 * column-width fallback and theme-attribute resolution, the logic behind
 * both the reader (`ShareApp.tsx`) and the new owner-side Settings >
 * Sharing > "Reader appearance" group.
 */
import { describe, expect, it } from "vitest";
import { classifyShareContent, resolveReaderColumnWidth, resolveReaderThemeAttr } from "../../src/share/readerPrefsResolve";

describe("classifyShareContent", () => {
  it("classifies markdown", () => {
    expect(classifyShareContent(true, false)).toBe("markdown");
  });
  it("classifies html", () => {
    expect(classifyShareContent(false, true)).toBe("html");
  });
  it("classifies everything else as code", () => {
    expect(classifyShareContent(false, false)).toBe("code");
  });
});

describe("resolveReaderColumnWidth", () => {
  it("the owner's explicit choice always wins, regardless of content class", () => {
    expect(resolveReaderColumnWidth("markdown", "full")).toBe("full");
    expect(resolveReaderColumnWidth("html", "narrow")).toBe("narrow");
    expect(resolveReaderColumnWidth("code", "narrow")).toBe("narrow");
  });

  it("falls back to a per-class default when the owner never chose (null)", () => {
    expect(resolveReaderColumnWidth("markdown", null)).toBe("narrow");
    expect(resolveReaderColumnWidth("html", null)).toBe("full");
    expect(resolveReaderColumnWidth("code", null)).toBe("wide");
  });
});

describe("resolveReaderThemeAttr", () => {
  it("system resolves to no attribute at all (CSS media query keeps governing)", () => {
    expect(resolveReaderThemeAttr("system")).toBeUndefined();
  });

  it("an explicit light/dark choice passes through unchanged", () => {
    expect(resolveReaderThemeAttr("light")).toBe("light");
    expect(resolveReaderThemeAttr("dark")).toBe("dark");
  });
});

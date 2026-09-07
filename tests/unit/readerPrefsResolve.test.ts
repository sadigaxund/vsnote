/**
 * feat(share) R4 — `share/readerPrefsResolve.ts`'s pure per-content-class
 * column-width fallback and theme-attribute resolution, the logic behind
 * both the reader (`ShareApp.tsx`) and the new owner-side Settings >
 * Sharing > "Reader appearance" group.
 */
import { describe, expect, it } from "vitest";
import { classifyShareContent, resolveReaderColumnWidth, resolveReaderThemeAttr } from "../../src/share/readerPrefsResolve";

describe("classifyShareContent", () => {
  it("classifies livepreview (markdown) as markdown", () => {
    expect(classifyShareContent("livepreview")).toBe("markdown");
  });
  it("classifies html as html", () => {
    expect(classifyShareContent("html")).toBe("html");
  });
  it("classifies csv/json/image/code as code", () => {
    expect(classifyShareContent("csv")).toBe("code");
    expect(classifyShareContent("json")).toBe("code");
    expect(classifyShareContent("image")).toBe("code");
    expect(classifyShareContent("code")).toBe("code");
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

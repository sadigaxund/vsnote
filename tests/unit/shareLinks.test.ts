/**
 * `share/shareLinks.ts` — single-origin share link construction (Phase
 * 10.5a, roadmap §5.4: front + back are one origin, so every link — raw or
 * rendered — points at this app's own origin) and identifier preference
 * (alias over slug).
 */
import { describe, expect, it } from "vitest";
import { buildShareLink, shareIdentifier } from "../../src/share/shareLinks";

describe("shareIdentifier()", () => {
  it("prefers the custom alias over the slug when set", () => {
    expect(shareIdentifier({ slug: "abc12345", alias: "my-cool-alias" })).toBe("my-cool-alias");
  });

  it("falls back to the slug when there is no alias", () => {
    expect(shareIdentifier({ slug: "abc12345", alias: null })).toBe("abc12345");
    expect(shareIdentifier({ slug: "abc12345" })).toBe("abc12345");
  });

  it("treats an empty-string alias as no alias", () => {
    expect(shareIdentifier({ slug: "abc12345", alias: "" })).toBe("abc12345");
  });
});

describe("buildShareLink()", () => {
  it("points at the app's own origin regardless of render_mode", () => {
    const raw = buildShareLink({ slug: "abc12345", render_mode: "raw" }, "http://127.0.0.1:5290");
    expect(raw).toBe("http://127.0.0.1:5290/share/abc12345");

    const rendered = buildShareLink({ slug: "abc12345", render_mode: "rendered" }, "http://127.0.0.1:5290");
    expect(rendered).toBe("http://127.0.0.1:5290/share/abc12345");
  });

  it("uses the alias in the link when present", () => {
    const link = buildShareLink({ slug: "abc12345", alias: "my-note", render_mode: "rendered" }, "http://127.0.0.1:5290");
    expect(link).toBe("http://127.0.0.1:5290/share/my-note");
  });
});

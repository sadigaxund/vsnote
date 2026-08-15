/**
 * `share/shareLinks.ts` — which ORIGIN a share link points at (raw =
 * backend origin; rendered = this app's own origin) and identifier
 * preference (alias over slug). See that module's doc for why the mode
 * picks an origin rather than a query param.
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
  const backend = "http://127.0.0.1:8787/";

  it("raw mode points at the BACKEND origin", () => {
    const link = buildShareLink({ slug: "abc12345", render_mode: "raw" }, backend, "http://127.0.0.1:5290");
    expect(link).toBe("http://127.0.0.1:8787/share/abc12345");
  });

  it("rendered mode points at the APP's own origin, not the backend", () => {
    const link = buildShareLink({ slug: "abc12345", render_mode: "rendered" }, backend, "http://127.0.0.1:5290");
    expect(link).toBe("http://127.0.0.1:5290/share/abc12345");
  });

  it("uses the alias in the link when present", () => {
    const link = buildShareLink(
      { slug: "abc12345", alias: "my-note", render_mode: "rendered" },
      backend,
      "http://127.0.0.1:5290",
    );
    expect(link).toBe("http://127.0.0.1:5290/share/my-note");
  });

  it("trims a trailing slash from the backend base URL", () => {
    const link = buildShareLink({ slug: "abc12345", render_mode: "raw" }, "http://127.0.0.1:8787///", "http://127.0.0.1:5290");
    expect(link).toBe("http://127.0.0.1:8787/share/abc12345");
  });
});

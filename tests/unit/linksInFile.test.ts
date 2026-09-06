import { describe, expect, it } from "vitest";
import { extractRelativeFileLinks, resolveRelativeVaultLink, statusForLinks } from "../../src/share/linksInFile";

describe("resolveRelativeVaultLink()", () => {
  it("resolves a same-directory relative link", () => {
    expect(resolveRelativeVaultLink("vault/notes/x.md", "./part-2.md")).toBe("vault/notes/part-2.md");
    expect(resolveRelativeVaultLink("vault/notes/x.md", "part-2.md")).toBe("vault/notes/part-2.md");
  });

  it("resolves a parent-directory relative link", () => {
    expect(resolveRelativeVaultLink("vault/notes/sub/x.md", "../y.md")).toBe("vault/notes/y.md");
  });

  it("resolves into a sibling subfolder", () => {
    expect(resolveRelativeVaultLink("vault/notes/x.md", "sub/y.md")).toBe("vault/notes/sub/y.md");
  });

  it("returns null for external, absolute, and anchor links", () => {
    expect(resolveRelativeVaultLink("vault/notes/x.md", "https://example.com/y.md")).toBeNull();
    expect(resolveRelativeVaultLink("vault/notes/x.md", "mailto:a@b.com")).toBeNull();
    expect(resolveRelativeVaultLink("vault/notes/x.md", "/absolute.md")).toBeNull();
    expect(resolveRelativeVaultLink("vault/notes/x.md", "#heading")).toBeNull();
  });

  it("returns null when a link tries to escape above the vault root", () => {
    expect(resolveRelativeVaultLink("vault/x.md", "../../outside.md")).toBeNull();
  });
});

describe("extractRelativeFileLinks()", () => {
  it("finds relative markdown links and resolves them, deduplicated", () => {
    const content = "See [part two](./part-2.md) and [again](./part-2.md) and [external](https://example.com) and [image](./pic.png)";
    const links = extractRelativeFileLinks("vault/notes/x.md", content);
    expect(links).toEqual([{ raw: "./part-2.md", target: "vault/notes/part-2.md" }]);
  });

  it("returns an empty array when there are no relative markdown links", () => {
    expect(extractRelativeFileLinks("vault/notes/x.md", "no links here")).toEqual([]);
  });
});

describe("statusForLinks()", () => {
  const shares = [
    { id: 1, slug: "abc12345", alias: "part-2", source_path: "vault/notes/part-2.md", revoked_at: null },
    { id: 2, slug: "def67890", alias: null, source_path: "vault/notes/revoked.md", revoked_at: 123 },
  ];

  it("matches a link to its active share", () => {
    const links = [{ raw: "./part-2.md", target: "vault/notes/part-2.md" }];
    expect(statusForLinks(links, shares)).toEqual([{ raw: "./part-2.md", target: "vault/notes/part-2.md", share: { id: 1, slug: "abc12345", alias: "part-2" } }]);
  });

  it("never matches a revoked share", () => {
    const links = [{ raw: "./revoked.md", target: "vault/notes/revoked.md" }];
    expect(statusForLinks(links, shares)[0]!.share).toBeNull();
  });

  it("marks an unshared target as not shared", () => {
    const links = [{ raw: "./nope.md", target: "vault/notes/nope.md" }];
    expect(statusForLinks(links, shares)[0]!.share).toBeNull();
  });
});

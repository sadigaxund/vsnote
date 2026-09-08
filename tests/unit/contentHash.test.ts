/**
 * `share/contentHash.ts` — R5-6 stale detection. Proves the client's
 * `sha256HexOfText` agrees with the server's
 * `hashlib.sha256(content).hexdigest()` (see `models.Blob`'s docstring and
 * `server/app/routers/shares.py::create_blob`) for both ASCII and
 * non-ASCII content, and pins the pure `computeFreshness` predicate.
 */
import { describe, expect, it } from "vitest";
import { computeFreshness, computeShareFreshness, sha256HexOfText } from "../../src/share/contentHash";

describe("sha256HexOfText()", () => {
  it("matches the server's hashlib.sha256(...).hexdigest() for empty content", async () => {
    expect(await sha256HexOfText("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the server's digest for plain ASCII content", async () => {
    expect(await sha256HexOfText("hello world")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("matches the server's digest for non-ASCII content (UTF-8 bytes, not UTF-16 code units)", async () => {
    // `str.encode("utf-8")` on the Python side and `TextEncoder().encode`
    // here must produce byte-identical output for this to hold — a naive
    // client-side hash over UTF-16 code units (e.g. hashing `.charCodeAt`
    // values directly) would silently disagree for anything outside ASCII.
    expect(await sha256HexOfText("héllo wörld — ünïcödé ✓")).toBe(
      "58eebde16e0408f073ccc6b800d443ab094584c5cd47960a8cd0f6a2baea7a2d",
    );
  });

  it("is sensitive to a single-character change", async () => {
    const a = await sha256HexOfText("original content");
    const b = await sha256HexOfText("original content.");
    expect(a).not.toBe(b);
  });
});

describe("computeFreshness()", () => {
  it("is fresh when the current hash matches the share's blob id", () => {
    expect(computeFreshness("abc123", "abc123")).toBe("fresh");
  });

  it("is stale when the current hash differs from the share's blob id", () => {
    expect(computeFreshness("abc123", "def456")).toBe("stale");
  });

  it("is missing when the file could not be read (null hash), even if a blob id exists", () => {
    expect(computeFreshness(null, "def456")).toBe("missing");
  });

  it("is missing even when the share also has no blob id", () => {
    expect(computeFreshness(null, null)).toBe("missing");
  });

  it("is unknown when the hash is known but the share carries no blob id yet", () => {
    expect(computeFreshness("abc123", null)).toBe("unknown");
    expect(computeFreshness("abc123", undefined)).toBe("unknown");
  });
});

describe("computeShareFreshness()", () => {
  const helloHash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

  it("marks a share fresh when the loaded content hashes to the pinned blob id", async () => {
    const shares = [{ id: 1, source_path: "notes/a.md", blob_id: helloHash }];
    const result = await computeShareFreshness(shares, async () => "hello world");
    expect(result.get(1)).toBe("fresh");
  });

  it("marks a share stale when the loaded content differs from the pinned blob id", async () => {
    const shares = [{ id: 1, source_path: "notes/a.md", blob_id: helloHash }];
    const result = await computeShareFreshness(shares, async () => "hello world, edited");
    expect(result.get(1)).toBe("stale");
  });

  it("marks a share missing when loadContent rejects (file gone from the vault)", async () => {
    const shares = [{ id: 1, source_path: "notes/gone.md", blob_id: helloHash }];
    const result = await computeShareFreshness(shares, async () => {
      throw new Error("ENOENT");
    });
    expect(result.get(1)).toBe("missing");
  });

  it("computes each share independently in a batch", async () => {
    const shares = [
      { id: 1, source_path: "notes/a.md", blob_id: helloHash },
      { id: 2, source_path: "notes/b.md", blob_id: "deadbeef" },
      { id: 3, source_path: "notes/gone.md", blob_id: helloHash },
    ];
    const result = await computeShareFreshness(shares, async (path) => {
      if (path === "notes/gone.md") throw new Error("ENOENT");
      return "hello world";
    });
    expect(result.get(1)).toBe("fresh");
    expect(result.get(2)).toBe("stale");
    expect(result.get(3)).toBe("missing");
  });
});

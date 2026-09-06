import { describe, expect, it } from "vitest";
import { computeShareLinkCounts } from "../../src/share/shareLinkGraph";
import type { ShareOut } from "../../src/share/api";

function makeShare(overrides: Partial<ShareOut> & { id: number; source_path: string }): ShareOut {
  return {
    slug: `slug${overrides.id}`,
    alias: null,
    blob_id: null,
    live: false,
    render_mode: "rendered",
    general_access: "link",
    auth_mode: "none",
    has_password: false,
    expires_at: null,
    revoked_at: null,
    created_at: 0,
    last_access_at: null,
    hit_count: 0,
    link_role: "viewer",
    grants: [],
    show_title: false,
    back_link: null,
    ...overrides,
  };
}

describe("computeShareLinkCounts()", () => {
  it("counts outgoing links to other active shares and inverts for linked-from", async () => {
    const index = makeShare({ id: 1, source_path: "vault/blog/index.md" });
    const post = makeShare({ id: 2, source_path: "vault/blog/post.md" });
    const shares = [index, post];
    const content: Record<string, string> = {
      "vault/blog/index.md": "[post](./post.md)",
      "vault/blog/post.md": "back to [index](./index.md)",
    };
    const counts = await computeShareLinkCounts(shares, async (p) => content[p] ?? "");
    expect(counts.get(1)).toEqual({ linksTo: 1, linkedFrom: 1 });
    expect(counts.get(2)).toEqual({ linksTo: 1, linkedFrom: 1 });
  });

  it("excludes revoked shares from the graph entirely", async () => {
    const active = makeShare({ id: 1, source_path: "vault/a.md" });
    const revoked = makeShare({ id: 2, source_path: "vault/b.md", revoked_at: 123 });
    const counts = await computeShareLinkCounts([active, revoked], async () => "[b](./b.md)");
    expect(counts.has(2)).toBe(false);
    expect(counts.get(1)).toEqual({ linksTo: 0, linkedFrom: 0 });
  });

  it("never throws when a share's content fails to load", async () => {
    const share = makeShare({ id: 1, source_path: "vault/missing.md" });
    const counts = await computeShareLinkCounts([share], async () => {
      throw new Error("not found");
    });
    expect(counts.get(1)).toEqual({ linksTo: 0, linkedFrom: 0 });
  });
});

/**
 * Pins `git/syncStatus.ts`'s pure logic (Phase 11 — real sync): divergence
 * classification and the fast-forward-only push/pull decision table, the
 * `GitAuth` shape built from a plaintext token, and the http(s)-only remote
 * URL check. The actual ahead/behind COMPUTATION (`git/remote.ts::
 * computeSyncStatus`, real `git.log`/`findMergeBase` over a real repo) is
 * covered by the e2e `git-sync.spec.ts` against a real vault/remote instead
 * of re-derived here against a fake filesystem — same split `diffStat.
 * test.ts` documents for `git/diff.ts`.
 */
import { describe, expect, it } from "vitest";
import { buildGitAuth, classifyDivergence, isHttpRemoteUrl, pullAction, pushAction } from "../../src/git/syncStatus";

describe("classifyDivergence()", () => {
  it("is up-to-date when both are zero", () => {
    expect(classifyDivergence({ ahead: 0, behind: 0 })).toBe("up-to-date");
  });
  it("is ahead-only when there's local work and nothing new remotely", () => {
    expect(classifyDivergence({ ahead: 2, behind: 0 })).toBe("ahead-only");
  });
  it("is behind-only when the remote has moved and local hasn't", () => {
    expect(classifyDivergence({ ahead: 0, behind: 3 })).toBe("behind-only");
  });
  it("is diverged when both sides have unique commits", () => {
    expect(classifyDivergence({ ahead: 1, behind: 1 })).toBe("diverged");
    expect(classifyDivergence({ ahead: 5, behind: 2 })).toBe("diverged");
  });
});

describe("pushAction() — fast-forward-only push policy", () => {
  it("pushes when ahead-only", () => {
    expect(pushAction("ahead-only")).toBe("push");
  });
  it("no-ops when up-to-date (nothing to send)", () => {
    expect(pushAction("up-to-date")).toBe("noop");
  });
  it("no-ops when behind-only (real git also says 'Everything up-to-date' here)", () => {
    expect(pushAction("behind-only")).toBe("noop");
  });
  it("refuses when diverged — never attempts the network call", () => {
    expect(pushAction("diverged")).toBe("refuse");
  });
});

describe("pullAction() — fast-forward-only pull policy", () => {
  it("fast-forwards when behind-only", () => {
    expect(pullAction("behind-only")).toBe("fast-forward");
  });
  it("no-ops when up-to-date", () => {
    expect(pullAction("up-to-date")).toBe("noop");
  });
  it("no-ops when ahead-only (nothing to bring down)", () => {
    expect(pullAction("ahead-only")).toBe("noop");
  });
  it("refuses when diverged — never auto-merges", () => {
    expect(pullAction("diverged")).toBe("refuse");
  });
});

describe("buildGitAuth()", () => {
  it("shapes a Bearer Authorization header from a plaintext token", () => {
    expect(buildGitAuth("vsn_abc123")).toEqual({ headers: { Authorization: "Bearer vsn_abc123" } });
  });
  it("trims surrounding whitespace", () => {
    expect(buildGitAuth("  vsn_abc123  ")).toEqual({ headers: { Authorization: "Bearer vsn_abc123" } });
  });
  it("returns undefined for an empty/blank token (no credentials sent)", () => {
    expect(buildGitAuth("")).toBeUndefined();
    expect(buildGitAuth("   ")).toBeUndefined();
  });
});

describe("isHttpRemoteUrl()", () => {
  it("accepts http/https URLs", () => {
    expect(isHttpRemoteUrl("http://127.0.0.1:8787/git/vault.git")).toBe(true);
    expect(isHttpRemoteUrl("https://example.com/git/vault.git")).toBe(true);
  });
  it("rejects non-http(s) schemes — browsers can't speak SSH/git://", () => {
    expect(isHttpRemoteUrl("ssh://git@example.com/vault.git")).toBe(false);
    expect(isHttpRemoteUrl("git://example.com/vault.git")).toBe(false);
  });
  it("rejects malformed URLs instead of throwing", () => {
    expect(isHttpRemoteUrl("not a url")).toBe(false);
    expect(isHttpRemoteUrl("")).toBe(false);
  });
});

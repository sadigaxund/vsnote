/**
 * `components/local/publishDialogLogic.ts`'s pure Mode-step logic. R3-7:
 * `canPublishRendered` is the fix for a real bug — `PublishDialog.tsx`
 * accepted a `fileKind` prop (plumbed all the way from `App.tsx`'s
 * `handleOpenPublish`) but never once read it, so the "Viewer page"
 * delivery option was unconditionally offered regardless of whether the
 * file's kind actually has a renderer (`filetypes/registry.ts`'s
 * `baseModes`). These tests pin the fix against the SAME registry table
 * `filetypeRegistry.test.ts` covers, so the two can never silently drift
 * apart.
 */
import { describe, expect, it } from "vitest";
import { buildBackLinkOptions, canPublishRendered, isShareActive, shouldShowShortAliasHint } from "../../src/components/local/publishDialogLogic";
import type { ShareOut } from "../../src/share/api";

describe("canPublishRendered", () => {
  it("is true for every code kind now that R3-7 gives them a renderer", () => {
    for (const kind of ["ts", "tsx", "js", "jsx", "css"] as const) {
      expect(canPublishRendered(kind)).toBe(true);
    }
  });

  it("is true for kinds that already had a renderer (md, html, csv, json, image)", () => {
    for (const kind of ["md", "mkmd", "html", "csv", "json", "image"] as const) {
      expect(canPublishRendered(kind)).toBe(true);
    }
  });

  it("is false for a kind with no renderer at all — the actual .py bug: unrecognized extensions fall back to the plain-text entry (source-only)", () => {
    expect(canPublishRendered("unknown")).toBe(false);
  });

  it("treats an unknown fileKind (edit-policy mode, where the dialog never learns the source file's kind) as renderable — 'don't know' must never narrow an existing share's options", () => {
    expect(canPublishRendered(undefined)).toBe(true);
  });
});

/**
 * R3-4 — `shouldShowShortAliasHint`: a nudge, never a block, shown only
 * when the share is "anyone with the link" AND the chosen alias is short
 * enough to be guessable. A blank alias means "no alias chosen" (the
 * backend generates a random 22-char slug), which is never short/guessable
 * regardless of `SHORT_ALIAS_THRESHOLD`.
 */
describe("shouldShowShortAliasHint", () => {
  it("is true for a short alias on a link-accessible share", () => {
    expect(shouldShowShortAliasHint("link", "get")).toBe(true);
    expect(shouldShowShortAliasHint("link", "ab")).toBe(true);
  });

  it("is false once the alias reaches the threshold length", () => {
    expect(shouldShowShortAliasHint("link", "abcd1234")).toBe(false);
    expect(shouldShowShortAliasHint("link", "a".repeat(9))).toBe(false);
  });

  it("is false for a restricted (sign-in) share regardless of alias length", () => {
    expect(shouldShowShortAliasHint("restricted", "get")).toBe(false);
  });

  it("is false when no alias is chosen (blank, or all whitespace)", () => {
    expect(shouldShowShortAliasHint("link", "")).toBe(false);
    expect(shouldShowShortAliasHint("link", "   ")).toBe(false);
  });
});

/**
 * Back-link dropdown fix — the options must come from ACTIVE shares only
 * (not revoked, not expired), excluding the share currently being edited,
 * labeled "source_path (alias or slug)".
 */
function makeShare(overrides: Partial<ShareOut>): ShareOut {
  return {
    id: 1,
    slug: "abc123",
    alias: null,
    source_path: "vault/notes/a.md",
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

const NOW = 1_000_000;

describe("isShareActive", () => {
  it("is true for a share with no revoke/expiry", () => {
    expect(isShareActive(makeShare({}), NOW)).toBe(true);
  });

  it("is false once revoked", () => {
    expect(isShareActive(makeShare({ revoked_at: NOW - 10 }), NOW)).toBe(false);
  });

  it("is false once its expiry has passed", () => {
    expect(isShareActive(makeShare({ expires_at: NOW - 1 }), NOW)).toBe(false);
    expect(isShareActive(makeShare({ expires_at: NOW }), NOW)).toBe(false);
  });

  it("is true while expiry is still in the future", () => {
    expect(isShareActive(makeShare({ expires_at: NOW + 1 }), NOW)).toBe(true);
  });
});

describe("buildBackLinkOptions", () => {
  it("excludes revoked and expired shares", () => {
    const shares = [
      makeShare({ id: 1, slug: "active", source_path: "vault/a.md" }),
      makeShare({ id: 2, slug: "gone", source_path: "vault/b.md", revoked_at: NOW - 5 }),
      makeShare({ id: 3, slug: "stale", source_path: "vault/c.md", expires_at: NOW - 5 }),
    ];
    const options = buildBackLinkOptions(shares, undefined, NOW);
    expect(options).toEqual([{ value: "active", label: "vault/a.md (active)" }]);
  });

  it("excludes the share currently being edited", () => {
    const shares = [
      makeShare({ id: 1, slug: "self", source_path: "vault/a.md" }),
      makeShare({ id: 2, slug: "other", source_path: "vault/b.md" }),
    ];
    const options = buildBackLinkOptions(shares, 1, NOW);
    expect(options).toEqual([{ value: "other", label: "vault/b.md (other)" }]);
  });

  it("labels with the alias when present, falling back to the slug", () => {
    const shares = [makeShare({ id: 1, slug: "slug1", alias: "my-alias", source_path: "vault/a.md" })];
    expect(buildBackLinkOptions(shares, undefined, NOW)).toEqual([{ value: "my-alias", label: "vault/a.md (my-alias)" }]);
  });
});

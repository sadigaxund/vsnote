/**
 * `src/markii/platform/browser/paths.ts`'s path-encoding rule for the
 * `/.markii/` logical folder (mirrors `src/fs/drafts.ts`'s `/.drafts`
 * convention). Pure functions, no fs access.
 */
import { describe, expect, it } from "vitest";
import { grantsFsPath, valueFsPath, valuesDir } from "../../src/markii/platform/browser/paths";

describe("markii persistence path encoding", () => {
  it("encodes a simple display path under /.markii/values/", () => {
    expect(valueFsPath("notes/scratch.mk.md")).toBe(`${valuesDir()}/notes%2Fscratch.mk.md.json`);
  });

  it("distinct display paths never collide after encoding", () => {
    const a = valueFsPath("notes/a.mk.md");
    const b = valueFsPath("notes/b.mk.md");
    const c = valueFsPath("other/a.mk.md");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("a path containing characters that collide with fs syntax (.. and /) is neutralized", () => {
    const traversal = valueFsPath("../../etc/passwd");
    expect(traversal.startsWith(`${valuesDir()}/`)).toBe(true);
    expect(traversal).not.toContain("/../");
  });

  it("the grants file lives directly under /.markii/, sibling to values/", () => {
    expect(grantsFsPath()).toBe("/.markii/grants.json");
    expect(valuesDir()).toBe("/.markii/values");
  });
});

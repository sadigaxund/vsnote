/**
 * Pins `git/remote.ts`'s DESIGN-SPEC Amendments round 5 item 41 additions —
 * the pure parts only (`resolveGitRemoteUrl`/`resolveGitCredential`/
 * `validateRepoName`/`describeConnectionTest`), same split `gitSync.test.ts`
 * documents for `syncStatus.ts`: this repo's `vitest.config.ts` runs
 * `environment: "node"` (no `window`), so `computeGitRemoteUrl` itself
 * (which reads `window.location.origin`) isn't unit-tested here — only its
 * pure `resolveGitRemoteUrl` core, which `computeGitRemoteUrl` is a thin,
 * one-line wrapper around (see that function's doc in `git/remote.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GIT_REPO_NAME,
  describeConnectionTest,
  resolveGitCredential,
  resolveGitRemoteUrl,
  validateRepoName,
  type ConnectionTestResult,
} from "../../src/git/remote";

const ORIGIN = "https://notes.example.com";

describe("resolveGitRemoteUrl() — item 41(a)/(b)/(d)", () => {
  it("uses the default repo name when none is set", () => {
    expect(resolveGitRemoteUrl(ORIGIN, { repoName: "", overrideEnabled: false, overrideUrl: "" })).toBe(
      `${ORIGIN}/git/${DEFAULT_GIT_REPO_NAME}.git`,
    );
  });

  it("uses a custom repo name to build the implicit remote", () => {
    expect(resolveGitRemoteUrl(ORIGIN, { repoName: "my-notes", overrideEnabled: false, overrideUrl: "" })).toBe(
      `${ORIGIN}/git/my-notes.git`,
    );
  });

  it("the custom override wins outright when enabled and filled in", () => {
    expect(
      resolveGitRemoteUrl(ORIGIN, {
        repoName: "my-notes",
        overrideEnabled: true,
        overrideUrl: "https://github.com/me/notes.git",
      }),
    ).toBe("https://github.com/me/notes.git");
  });

  it("the override is ignored (falls back to the implicit remote) when disabled", () => {
    expect(
      resolveGitRemoteUrl(ORIGIN, {
        repoName: "my-notes",
        overrideEnabled: false,
        overrideUrl: "https://github.com/me/notes.git",
      }),
    ).toBe(`${ORIGIN}/git/my-notes.git`);
  });

  it("a half-filled override (enabled, blank URL) falls back to the implicit remote rather than resolving empty", () => {
    expect(resolveGitRemoteUrl(ORIGIN, { repoName: "my-notes", overrideEnabled: true, overrideUrl: "   " })).toBe(
      `${ORIGIN}/git/my-notes.git`,
    );
  });
});

describe("resolveGitCredential() — mirrors resolveGitRemoteUrl's override precedence", () => {
  it("uses the implicit-remote token when the override is disabled", () => {
    expect(
      resolveGitCredential({ token: "vsn_token", overrideEnabled: false, overrideUrl: "https://x/y.git", overrideToken: "ghp_token" }),
    ).toBe("vsn_token");
  });

  it("uses the override's own credential when enabled with a URL set", () => {
    expect(
      resolveGitCredential({ token: "vsn_token", overrideEnabled: true, overrideUrl: "https://x/y.git", overrideToken: "ghp_token" }),
    ).toBe("ghp_token");
  });

  it("falls back to the implicit token when the override is enabled but blank", () => {
    expect(resolveGitCredential({ token: "vsn_token", overrideEnabled: true, overrideUrl: "  ", overrideToken: "ghp_token" })).toBe(
      "vsn_token",
    );
  });
});

describe("validateRepoName() — mirrors server/app/gitrepo.py's REPO_NAME_RE exactly", () => {
  it("accepts ordinary names", () => {
    expect(validateRepoName("vault")).toBeNull();
    expect(validateRepoName("my-notes")).toBeNull();
    expect(validateRepoName("my_notes_2")).toBeNull();
    expect(validateRepoName("A1")).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validateRepoName("")).not.toBeNull();
  });

  it("rejects a name over 64 characters", () => {
    expect(validateRepoName("a".repeat(65))).not.toBeNull();
    expect(validateRepoName("a".repeat(64))).toBeNull();
  });

  it("rejects a path separator (server-side directory traversal vector)", () => {
    expect(validateRepoName("notes/evil")).not.toBeNull();
  });

  it("rejects a literal path-traversal segment", () => {
    expect(validateRepoName("../../etc")).not.toBeNull();
    expect(validateRepoName("..")).not.toBeNull();
  });

  it("rejects other disallowed characters (space, dot, slash-adjacent punctuation)", () => {
    expect(validateRepoName("my notes")).not.toBeNull();
    expect(validateRepoName("notes.git")).not.toBeNull();
  });
});

describe("describeConnectionTest() — item 41(e)'s three distinct outcomes", () => {
  it("maps an offline/unreachable failure to 'unreachable'", () => {
    const result: ConnectionTestResult = { ok: false, code: "offline", message: "Could not reach the git remote." };
    expect(describeConnectionTest(result).outcome).toBe("unreachable");
  });

  it("maps an auth failure to 'auth-rejected', distinct from 'unreachable'", () => {
    const result: ConnectionTestResult = { ok: false, code: "auth", message: "The remote rejected the credentials." };
    const described = describeConnectionTest(result);
    expect(described.outcome).toBe("auth-rejected");
    expect(described.outcome).not.toBe("unreachable");
  });

  it("maps ok:true with no heads to 'repo-missing', distinct from both failure outcomes", () => {
    const result: ConnectionTestResult = { ok: true, repoExists: false };
    const described = describeConnectionTest(result);
    expect(described.outcome).toBe("repo-missing");
    expect(described.outcome).not.toBe("unreachable");
    expect(described.outcome).not.toBe("auth-rejected");
  });

  it("maps a full success to 'ok'", () => {
    const result: ConnectionTestResult = { ok: true, repoExists: true };
    expect(describeConnectionTest(result).outcome).toBe("ok");
  });

  it("tailors the repo-missing message to the remote: built-in auto-creates, external does not", () => {
    // Regression: a single "that repository does not exist yet" message read
    // as an ERROR on the built-in remote, where a missing repo is simply the
    // normal first-run state (the server creates it on first authenticated
    // push). An external GitHub/Gitea remote genuinely will not auto-create,
    // so the two cases must not share wording.
    const builtIn = describeConnectionTest({ ok: true, repoExists: false }, false);
    const external = describeConnectionTest({ ok: true, repoExists: false }, true);

    expect(builtIn.outcome).toBe("repo-missing");
    expect(external.outcome).toBe("repo-missing");
    expect(builtIn.message).toMatch(/created on first push/i);
    expect(external.message).not.toMatch(/created on first push/i);
    expect(external.message).toMatch(/does not exist on the remote/i);
    expect(builtIn.message).not.toBe(external.message);
  });

  it("gives each of the three outcomes a distinct, single-line message", () => {
    const unreachable = describeConnectionTest({ ok: false, code: "offline", message: "x" });
    const authRejected = describeConnectionTest({ ok: false, code: "auth", message: "x" });
    const repoMissing = describeConnectionTest({ ok: true, repoExists: false });
    const messages = [unreachable.message, authRejected.message, repoMissing.message];
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) {
      expect(message.includes("\n")).toBe(false);
      expect(message.includes("—")).toBe(false);
    }
  });
});

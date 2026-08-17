import { describe, expect, it } from "vitest";
import {
  describeMirrorRunResult,
  describeMirrorStatus,
  mirrorStatusTone,
  remoteTestTone,
  validateCredentialFields,
  validateMirrorRemoteName,
  validateMirrorRemoteUrl,
} from "../../src/git/vaultRemotes";

describe("validateMirrorRemoteUrl", () => {
  it("accepts https/http/ssh URLs with a real host", () => {
    expect(validateMirrorRemoteUrl("https://github.com/you/notes.git")).toBeNull();
    expect(validateMirrorRemoteUrl("http://example.com/repo.git")).toBeNull();
    expect(validateMirrorRemoteUrl("ssh://git@example.com/repo.git")).toBeNull();
  });

  it("accepts the scp-like user@host:path form", () => {
    expect(validateMirrorRemoteUrl("git@github.com:you/notes.git")).toBeNull();
  });

  it("accepts file:// and plain local paths", () => {
    expect(validateMirrorRemoteUrl("file:///tmp/repo.git")).toBeNull();
    expect(validateMirrorRemoteUrl("/tmp/repo.git")).toBeNull();
    expect(validateMirrorRemoteUrl("./relative/repo.git")).toBeNull();
    expect(validateMirrorRemoteUrl("../relative/repo.git")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateMirrorRemoteUrl("")).not.toBeNull();
    expect(validateMirrorRemoteUrl("   ")).not.toBeNull();
  });

  it("rejects a leading hyphen (argv-injection shape)", () => {
    expect(validateMirrorRemoteUrl("--upload-pack=evil")).not.toBeNull();
  });

  it("rejects a git remote-helper transport like ext::", () => {
    expect(validateMirrorRemoteUrl("ext::sh -c evil")).not.toBeNull();
  });

  it("rejects an unsupported scheme", () => {
    expect(validateMirrorRemoteUrl("ftp://example.com/repo.git")).not.toBeNull();
  });

  it("rejects a scheme URL missing its host", () => {
    expect(validateMirrorRemoteUrl("https://")).not.toBeNull();
  });

  it("rejects a host starting with a hyphen", () => {
    expect(validateMirrorRemoteUrl("ssh://-oProxyCommand=evil/repo.git")).not.toBeNull();
  });

  it("rejects an unrecognized bare string", () => {
    expect(validateMirrorRemoteUrl("not a url at all")).not.toBeNull();
  });
});

describe("validateMirrorRemoteName", () => {
  it("requires a non-blank name", () => {
    expect(validateMirrorRemoteName("")).not.toBeNull();
    expect(validateMirrorRemoteName("   ")).not.toBeNull();
    expect(validateMirrorRemoteName("GitHub backup")).toBeNull();
  });
});

describe("validateCredentialFields", () => {
  it("requires the SSH key when credential_kind is ssh_key", () => {
    expect(validateCredentialFields("ssh_key", "", "")).not.toBeNull();
    expect(validateCredentialFields("ssh_key", "-----BEGIN...", "")).toBeNull();
  });

  it("requires the token when credential_kind is https_token", () => {
    expect(validateCredentialFields("https_token", "", "")).not.toBeNull();
    expect(validateCredentialFields("https_token", "", "ghp_abc123")).toBeNull();
  });

  it("needs neither field when credential_kind is none", () => {
    expect(validateCredentialFields("none", "", "")).toBeNull();
  });
});

describe("mirrorStatusTone", () => {
  it("maps every known status to a tone, and unknown/missing to neutral", () => {
    expect(mirrorStatusTone("success")).toBe("success");
    expect(mirrorStatusTone("error")).toBe("danger");
    expect(mirrorStatusTone("busy")).toBe("warning");
    expect(mirrorStatusTone("skipped")).toBe("neutral");
    expect(mirrorStatusTone(null)).toBe("neutral");
    expect(mirrorStatusTone(undefined)).toBe("neutral");
  });
});

describe("describeMirrorStatus", () => {
  it("describes a never-run remote", () => {
    expect(describeMirrorStatus(null, null)).toBe("Never run.");
  });

  it("includes the error detail on a failed run", () => {
    expect(describeMirrorStatus("error", "auth rejected")).toBe("Last mirror failed: auth rejected");
    expect(describeMirrorStatus("error", null)).toBe("Last mirror failed.");
  });

  it("describes success/busy/skipped", () => {
    expect(describeMirrorStatus("success", null)).toBe("Last mirror succeeded.");
    expect(describeMirrorStatus("busy", null)).toBe("A mirror is already running.");
    expect(describeMirrorStatus("skipped", null)).toBe("Skipped (disabled).");
  });
});

describe("describeMirrorRunResult", () => {
  it("prefers a fixed message for success/busy/skipped, and the server message otherwise", () => {
    expect(describeMirrorRunResult("success", "irrelevant")).toBe("Mirrored successfully.");
    expect(describeMirrorRunResult("busy", "irrelevant")).toBe("A mirror to this remote is already running.");
    expect(describeMirrorRunResult("skipped", "irrelevant")).toBe("Skipped (this remote is disabled).");
    expect(describeMirrorRunResult("error", "auth rejected by remote")).toBe("auth rejected by remote");
    expect(describeMirrorRunResult("error", "")).toBe("Mirror failed.");
  });
});

describe("remoteTestTone", () => {
  it("maps each RemoteTestOutcome to a tone", () => {
    expect(remoteTestTone("reachable")).toBe("success");
    expect(remoteTestTone("repo-missing")).toBe("warning");
    expect(remoteTestTone("auth-rejected")).toBe("danger");
    expect(remoteTestTone("unreachable")).toBe("danger");
    expect(remoteTestTone("error")).toBe("danger");
  });
});

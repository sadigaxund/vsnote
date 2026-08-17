/**
 * `share/sharePolicy.ts`'s `shareCreatePayload` — shapes the Publish
 * dialog's UI-level `PublishInput` into the exact `POST /api/shares` body
 * (`server/app/schemas.py::ShareCreateIn`).
 */
import { describe, expect, it } from "vitest";
import { shareCreatePayload, shareFolderCreatePayload } from "../../src/share/sharePolicy";
import type { PublishInput } from "../../src/share/useShareStore";

const BASE_INPUT: PublishInput = {
  sourcePath: "vault/notes/x.md",
  filename: "x.md",
  content: "hello",
  renderMode: "raw",
  generalAccess: "restricted",
  authMode: "none",
};

describe("shareCreatePayload()", () => {
  it("shapes a minimal publish into the ShareCreateIn body", () => {
    expect(shareCreatePayload(BASE_INPUT, "blob123")).toEqual({
      source_path: "vault/notes/x.md",
      blob_id: "blob123",
      render_mode: "raw",
      general_access: "restricted",
      auth_mode: "none",
      password: undefined,
      alias: undefined,
      expires_at: undefined,
      grants: undefined,
    });
  });

  it("drops the password when auth_mode isn't 'password' — never leaks a stale field value", () => {
    const input: PublishInput = { ...BASE_INPUT, authMode: "none", password: "leftover-from-a-toggle" };
    expect(shareCreatePayload(input, "blob123").password).toBeUndefined();
  });

  it("includes the password when auth_mode is 'password'", () => {
    const input: PublishInput = { ...BASE_INPUT, authMode: "password", password: "s3cret" };
    expect(shareCreatePayload(input, "blob123").password).toBe("s3cret");
  });

  it("omits an empty-string alias rather than sending it", () => {
    const input: PublishInput = { ...BASE_INPUT, alias: "" };
    expect(shareCreatePayload(input, "blob123").alias).toBeUndefined();
  });

  it("passes a real alias through", () => {
    const input: PublishInput = { ...BASE_INPUT, alias: "my-real-alias" };
    expect(shareCreatePayload(input, "blob123").alias).toBe("my-real-alias");
  });

  it("omits empty grants rather than sending an empty array", () => {
    expect(shareCreatePayload({ ...BASE_INPUT, grants: [] }, "blob123").grants).toBeUndefined();
  });

  it("passes real grants through", () => {
    const grants = [{ principal: "a@example.com", role: "viewer" as const }];
    expect(shareCreatePayload({ ...BASE_INPUT, grants }, "blob123").grants).toEqual(grants);
  });
});

describe("shareFolderCreatePayload()", () => {
  const FOLDER_INPUT: PublishInput = { ...BASE_INPUT, sourcePath: "vault/notes" };
  const manifest = [
    { relpath: "a.md", blob_id: "blob-a" },
    { relpath: "sub/b.md", blob_id: "blob-b" },
  ];

  it("shapes a folder publish into a kind='folder' body with the manifest, never blob_id", () => {
    expect(shareFolderCreatePayload(FOLDER_INPUT, manifest)).toEqual({
      source_path: "vault/notes",
      kind: "folder",
      manifest,
      render_mode: "raw",
      general_access: "restricted",
      auth_mode: "none",
      password: undefined,
      alias: undefined,
      expires_at: undefined,
      grants: undefined,
    });
  });

  it("applies the exact same password/alias/grants shaping rules as the file variant", () => {
    const input: PublishInput = { ...FOLDER_INPUT, authMode: "password", password: "s3cret", alias: "my-folder" };
    const payload = shareFolderCreatePayload(input, manifest);
    expect(payload.password).toBe("s3cret");
    expect(payload.alias).toBe("my-folder");
  });
});

describe("round 7 item 57: link_role", () => {
  it("sends link_role only for link access", () => {
    const base = {
      sourcePath: "vault/x.md",
      filename: "x.md",
      content: "hi",
      renderMode: "rendered" as const,
      authMode: "none" as const,
    };
    const linked = shareCreatePayload({ ...base, generalAccess: "link", linkRole: "editor" }, "blob1");
    expect(linked.link_role).toBe("editor");
    const restricted = shareCreatePayload({ ...base, generalAccess: "restricted", linkRole: "editor" }, "blob1");
    expect(restricted.link_role).toBeUndefined();
  });
});

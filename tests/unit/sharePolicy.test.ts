/**
 * `share/sharePolicy.ts`'s `shareCreatePayload` — shapes the Publish
 * dialog's UI-level `PublishInput` into the exact `POST /api/shares` body
 * (`server/app/schemas.py::ShareCreateIn`).
 */
import { describe, expect, it } from "vitest";
import { shareCreatePayload } from "../../src/share/sharePolicy";
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

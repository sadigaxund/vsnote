/**
 * Phase M3, worker 3 — unit tests for `grantPromptLogic.ts`'s pure scan/
 * build functions, independent of `GrantPromptDialog`'s React tree.
 */
import { describe, expect, it } from "vitest";
import { permissionsFromSelection, scanScriptRequests } from "../../src/components/local/grantPromptLogic";
import type { ScriptBlock } from "@markii/core";

function script(name: string, code: string): ScriptBlock {
  return { name, lang: "lua", code };
}

describe("scanScriptRequests", () => {
  it("finds fetch_json/get hosts as read-only", () => {
    const result = scanScriptRequests([
      script("a", 'local r = net.fetch_json("https://api.example.com/data")'),
      script("b", 'local r = net.get("https://other.example.com/x")'),
    ]);
    expect(result.getHosts).toEqual(["api.example.com", "other.example.com"]);
    expect(result.postHosts).toEqual([]);
    expect(result.bundleWriteRequested).toBe(false);
  });

  it("finds post/patch hosts as effectful", () => {
    const result = scanScriptRequests([script("a", 'net.post("https://hooks.example.com/x", body)')]);
    expect(result.postHosts).toEqual(["hooks.example.com"]);
    expect(result.getHosts).toEqual([]);
  });

  it("dedupes and sorts hosts across multiple scripts", () => {
    const result = scanScriptRequests([
      script("a", 'net.fetch_json("https://b.example.com/1")'),
      script("b", 'net.fetch_json("https://a.example.com/2")'),
      script("c", 'net.fetch_json("https://b.example.com/3")'),
    ]);
    expect(result.getHosts).toEqual(["a.example.com", "b.example.com"]);
  });

  it("detects bundle.write calls", () => {
    expect(scanScriptRequests([script("a", 'bundle.write("out.json", data)')]).bundleWriteRequested).toBe(true);
    expect(scanScriptRequests([script("a", 'bundle.read("out.json")')]).bundleWriteRequested).toBe(false);
  });

  it("never throws on a script with no network/bundle calls at all", () => {
    const result = scanScriptRequests([script("a", "return 42")]);
    expect(result).toEqual({ getHosts: [], postHosts: [], bundleWriteRequested: false });
  });

  it("cannot see a dynamically-built URL (documented scan limitation)", () => {
    const result = scanScriptRequests([script("a", 'local u = base .. "/x"\nnet.fetch_json(u)')]);
    expect(result.getHosts).toEqual([]);
  });
});

describe("permissionsFromSelection", () => {
  it("builds a GrantedPermissions from exactly the selected hosts and bundle-write flag", () => {
    expect(permissionsFromSelection(["a.example.com"], ["b.example.com"], true)).toEqual({
      net: { get: ["a.example.com"], post: ["b.example.com"] },
      bundleWrite: true,
    });
  });

  it("defaults to no access when nothing was selected", () => {
    expect(permissionsFromSelection([], [], false)).toEqual({ net: { get: [], post: [] }, bundleWrite: false });
  });
});

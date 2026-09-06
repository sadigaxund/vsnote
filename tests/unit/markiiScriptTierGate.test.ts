/**
 * Phase M3's security gate: `auto`/`scheduled` triggers must run at the
 * read-only tier and must NEVER receive write-capable net capabilities,
 * even when a manual grant for the exact same note already contains
 * `post` hosts. Per the worker brief: assert on the CONSTRUCTED capability
 * config `buildCapabilityConfig` produces, not on a mock's cooperative
 * behavior — a hostile or buggy executor should find there is simply
 * nothing write-capable in the config to exercise in the first place.
 */
import { describe, expect, it } from "vitest";
import { buildCapabilityConfig } from "../../src/markii/host/capabilities";
import type { GrantedPermissions } from "../../src/markii/host/types";
import type { NetProvider } from "@markii/lua";

const fakeNet: NetProvider = {
  get: async () => ({ status: 200, body: "{}" }),
  post: async () => ({ status: 200, body: "{}" }),
  patch: async () => ({ status: 200, body: "{}" }),
};

const permissionsWithPost: GrantedPermissions = {
  net: { get: ["example.com"], post: ["example.com"] },
  bundleWrite: true,
};

describe("markii capability tier gate", () => {
  it("manual trigger maps to the manual tier and carries the grant's full net permissions", () => {
    const config = buildCapabilityConfig({ trigger: "manual", permissions: permissionsWithPost, netProvider: fakeNet });
    expect(config.tier).toBe("manual");
    expect(config.netGrants).toEqual({ get: ["example.com"], post: ["example.com"] });
    expect(config.net).toBe(fakeNet);
  });

  it("auto trigger maps to the read-only tier and strips post hosts even though the grant has them", () => {
    const config = buildCapabilityConfig({ trigger: "auto", permissions: permissionsWithPost, netProvider: fakeNet });
    expect(config.tier).toBe("auto");
    expect(config.netGrants?.post).toEqual([]);
  });

  it("scheduled trigger also maps to the read-only tier and strips post hosts", () => {
    const config = buildCapabilityConfig({ trigger: "scheduled", permissions: permissionsWithPost, netProvider: fakeNet });
    expect(config.tier).toBe("auto");
    expect(config.netGrants?.post).toEqual([]);
  });

  it("auto trigger still allows reads (net.get is not an effectful op)", () => {
    const config = buildCapabilityConfig({ trigger: "auto", permissions: permissionsWithPost, netProvider: fakeNet });
    expect(config.netGrants?.get).toEqual(["example.com"]);
  });

  it("with no permissions at all, manual trigger gets an empty net grant, not undefined behavior", () => {
    const config = buildCapabilityConfig({ trigger: "manual", netProvider: fakeNet });
    expect(config.netGrants).toEqual({ get: [], post: [] });
  });

  it("with no net provider, no net config is constructed for any tier", () => {
    const manual = buildCapabilityConfig({ trigger: "manual", permissions: permissionsWithPost });
    const auto = buildCapabilityConfig({ trigger: "auto", permissions: permissionsWithPost });
    expect(manual.net).toBeUndefined();
    expect(manual.netGrants).toBeUndefined();
    expect(auto.net).toBeUndefined();
    expect(auto.netGrants).toBeUndefined();
  });

  it("a caller cannot forge a manual tier by passing a wrong trigger/tier combination: the tier is derived from trigger, not trusted", () => {
    // Even if some caller mistakenly thought it could pass tier directly,
    // buildCapabilityConfig only accepts a RunTrigger and derives the tier
    // itself via tierForTrigger - there is no tier parameter to forge.
    const config = buildCapabilityConfig({ trigger: "scheduled", permissions: permissionsWithPost, netProvider: fakeNet });
    expect(config.tier).not.toBe("manual");
  });
});

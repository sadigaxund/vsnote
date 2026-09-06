/**
 * Worker 2's completion of the grant closure (`src/markii/host/
 * grantClosure.ts`): `bundleModules` and `packs` now participate in the
 * hash `computeNoteGrantKey` produces, so editing a `src=` bundle module's
 * CONTENT, or bumping a required pack's version/modules, invalidates a
 * note's existing grant the same way editing an inline script already
 * does (worker 1's `markiiGrantKey.test.ts`). `vaultModules` stays `{}` —
 * see `grantClosure.ts`'s module doc for why VSNote has no such concept.
 */
import { describe, expect, it } from "vitest";
import type { ScriptBlock } from "@markii/core";
import { buildGrantClosure, computeNoteGrantKey } from "../../src/markii/host/grantClosure";

function script(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return { name: "greeting", lang: "lua", src: "scripts/greeting.lua", code: "", ...overrides };
}

describe("grant closure: bundleModules", () => {
  it("changes the key when a src= module's resolved CONTENT changes, even though the script block itself is identical", async () => {
    const before = await computeNoteGrantKey({
      scripts: [script()],
      bundleModules: { "scripts/greeting.lua": 'return "hi"' },
    });
    const after = await computeNoteGrantKey({
      scripts: [script()],
      bundleModules: { "scripts/greeting.lua": 'return "bye"' },
    });
    expect(after).not.toBe(before);
  });

  it("is stable when bundleModules content is unchanged", async () => {
    const inputs = { scripts: [script()], bundleModules: { "scripts/greeting.lua": 'return "hi"' } };
    const a = await computeNoteGrantKey(inputs);
    const b = await computeNoteGrantKey(inputs);
    expect(a).toBe(b);
  });

  it("differs from a closure with no resolved bundleModules at all (an unopened bundle)", async () => {
    const withModule = await computeNoteGrantKey({
      scripts: [script()],
      bundleModules: { "scripts/greeting.lua": 'return "hi"' },
    });
    const withoutModule = await computeNoteGrantKey({ scripts: [script()] });
    expect(withModule).not.toBe(withoutModule);
  });
});

describe("grant closure: packs", () => {
  const pack = { namespace: "ana", version: "1.0.0", modules: { "http.lua": "return {}" } };

  it("changes the key when a required pack's version changes", async () => {
    const before = await computeNoteGrantKey({ scripts: [script({ src: undefined, code: "return 1" })], packs: [pack] });
    const after = await computeNoteGrantKey({
      scripts: [script({ src: undefined, code: "return 1" })],
      packs: [{ ...pack, version: "2.0.0" }],
    });
    expect(after).not.toBe(before);
  });

  it("changes the key when a required pack's module source changes", async () => {
    const before = await computeNoteGrantKey({ scripts: [script({ src: undefined, code: "return 1" })], packs: [pack] });
    const after = await computeNoteGrantKey({
      scripts: [script({ src: undefined, code: "return 1" })],
      packs: [{ ...pack, modules: { "http.lua": "return { changed = true }" } }],
    });
    expect(after).not.toBe(before);
  });

  it("differs from a closure that requires no packs at all", async () => {
    const withPack = await computeNoteGrantKey({ scripts: [script({ src: undefined, code: "return 1" })], packs: [pack] });
    const withoutPack = await computeNoteGrantKey({ scripts: [script({ src: undefined, code: "return 1" })] });
    expect(withPack).not.toBe(withoutPack);
  });
});

describe("buildGrantClosure defaults", () => {
  it("always carries an empty vaultModules section (no vault-library concept in this app)", () => {
    const closure = buildGrantClosure({ scripts: [script()] });
    expect(closure.vaultModules).toEqual({});
  });
});

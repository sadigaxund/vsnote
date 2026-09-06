/**
 * Grant keys are content hashes over a note's script closure
 * (`@markii/runtime`'s `computeGrantKey`, docs/security.md): editing a
 * script must invalidate its grant, because that is the entire point of
 * keying by content instead of by note path. `buildGrantClosure`
 * (`src/markii/host/grantClosure.ts`) is the adapter from `@markii/core`'s
 * `ScriptBlock` to that closure shape; `computeNoteGrantKey` wraps the hash
 * call for direct use from `runScripts.ts`.
 */
import { describe, expect, it } from "vitest";
import type { ScriptBlock } from "@markii/core";
import { buildGrantClosure, computeNoteGrantKey } from "../../src/markii/host/grantClosure";

function script(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return { name: "greeting", lang: "lua", code: 'return "hi"', ...overrides };
}

describe("markii grant key", () => {
  it("is stable for the exact same script content", async () => {
    const a = await computeNoteGrantKey({ scripts: [script()] });
    const b = await computeNoteGrantKey({ scripts: [script()] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a script's code is edited", async () => {
    const before = await computeNoteGrantKey({ scripts: [script({ code: 'return "hi"' })] });
    const after = await computeNoteGrantKey({ scripts: [script({ code: 'return "bye"' })] });
    expect(after).not.toBe(before);
  });

  it("changes when a script's name changes", async () => {
    const before = await computeNoteGrantKey({ scripts: [script({ name: "a" })] });
    const after = await computeNoteGrantKey({ scripts: [script({ name: "b" })] });
    expect(after).not.toBe(before);
  });

  it("changes when a src= reference path changes even with identical (empty) inline code", async () => {
    const before = await computeNoteGrantKey({ scripts: [script({ src: "scripts/a.lua", code: "" })] });
    const after = await computeNoteGrantKey({ scripts: [script({ src: "scripts/b.lua", code: "" })] });
    expect(after).not.toBe(before);
  });

  it("is independent of script array order (order-insensitive set semantics)", async () => {
    const s1 = script({ name: "one", code: "return 1" });
    const s2 = script({ name: "two", code: "return 2" });
    const forward = await computeNoteGrantKey({ scripts: [s1, s2] });
    const backward = await computeNoteGrantKey({ scripts: [s2, s1] });
    expect(forward).toBe(backward);
  });

  it("adding an extra script changes the key", async () => {
    const one = await computeNoteGrantKey({ scripts: [script({ name: "only" })] });
    const two = await computeNoteGrantKey({ scripts: [script({ name: "only" }), script({ name: "extra" })] });
    expect(two).not.toBe(one);
  });

  it("buildGrantClosure only carries name/lang/src/code, dropping publish/position", () => {
    const closure = buildGrantClosure({
      scripts: [{ name: "x", lang: "lua", code: "return 1", publish: true, position: undefined }],
    });
    expect(closure.scripts).toEqual([{ name: "x", lang: "lua", src: undefined, code: "return 1" }]);
    expect(closure.bundleModules).toEqual({});
    expect(closure.vaultModules).toEqual({});
    expect(closure.packs).toEqual([]);
  });
});

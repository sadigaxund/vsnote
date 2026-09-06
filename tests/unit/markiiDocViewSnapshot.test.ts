/**
 * Defect fix (found in review before Phase M3 shipped): `@markii/runtime`'s
 * `DocView.value` is a FUNCTION, which `runDocumentScripts` hands to every
 * script's executor unconditionally — a real `DocView` cannot cross
 * `postMessage`/`structuredClone` (`DataCloneError`). `docViewSnapshot.ts`
 * is the fix: `buildDocViewSnapshot` (sending side, host-thread) precomputes
 * a plain, cloneable snapshot; `reconstructDocView` (receiving side, inside
 * whatever isolate actually needs a real `DocView`) rebuilds one from it.
 */
import { describe, expect, it } from "vitest";
import type { DocValueRead, DocView } from "@markii/runtime";
import { buildDocViewSnapshot, reconstructDocView } from "../../src/markii/host/docViewSnapshot";

function fakeDoc(answers: Record<string, DocValueRead>): DocView {
  return {
    directives: { directives: [{ name: "q", form: "leaf", attributes: {}, text: "hi" }], truncated: false },
    value: (name) => answers[name] ?? { ok: true, value: undefined },
  };
}

describe("markii DocView snapshot", () => {
  it("captures the directives listing and every requested name's answer", () => {
    const doc = fakeDoc({ first: { ok: true, value: 100 } });
    const snapshot = buildDocViewSnapshot(doc, ["first"]);
    expect(snapshot.directives).toEqual(doc.directives);
    expect(snapshot.values.get("first")).toEqual({ ok: true, value: 100 });
  });

  it("deduplicates repeated names, calling doc.value once per unique name", () => {
    let calls = 0;
    const doc: DocView = {
      directives: { directives: [], truncated: false },
      value: (name) => {
        calls += 1;
        return { ok: true, value: name };
      },
    };
    buildDocViewSnapshot(doc, ["a", "a", "b", "a"]);
    expect(calls).toBe(2);
  });

  it("the snapshot is structured-cloneable (round trips through structuredClone)", () => {
    const doc = fakeDoc({
      first: { ok: true, value: { nested: [1, 2, 3] } },
      second: { ok: false, message: "reads \"second\", which runs later in the note" },
    });
    const snapshot = buildDocViewSnapshot(doc, ["first", "second"]);
    const cloned = structuredClone(snapshot);
    expect(cloned).toEqual(snapshot);
    expect(cloned.values).toBeInstanceOf(Map);
  });

  it("reconstructDocView rebuilds a working DocView: known names answer exactly as captured", () => {
    const doc = fakeDoc({
      first: { ok: true, value: 42 },
      second: { ok: false, message: "reads \"second\", which runs later in the note" },
    });
    const snapshot = buildDocViewSnapshot(doc, ["first", "second"]);
    const rebuilt = reconstructDocView(snapshot);
    expect(rebuilt.value("first")).toEqual({ ok: true, value: 42 });
    expect(rebuilt.value("second")).toEqual({ ok: false, message: "reads \"second\", which runs later in the note" });
  });

  it("reconstructDocView answers nil (never a thrown error) for a name outside the snapshot", () => {
    const snapshot = buildDocViewSnapshot(fakeDoc({}), []);
    const rebuilt = reconstructDocView(snapshot);
    expect(rebuilt.value("never-asked-about")).toEqual({ ok: true, value: undefined });
  });

  it("preserves a rejection's exact message, never turning a refusal into a thrown error or a different shape", () => {
    const message = 'reads "quiz", which runs later in the note';
    const snapshot = buildDocViewSnapshot(fakeDoc({ quiz: { ok: false, message } }), ["quiz"]);
    const rebuilt = reconstructDocView(snapshot);
    expect(() => rebuilt.value("quiz")).not.toThrow();
    expect(rebuilt.value("quiz")).toEqual({ ok: false, message });
  });
});

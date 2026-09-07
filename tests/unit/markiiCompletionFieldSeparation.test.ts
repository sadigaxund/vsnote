/**
 * Round 5 MK item 2: `markiiCompletionSource`'s options must keep the
 * directive name (`label`), its short kind/attrs summary (`detail`), and
 * its documentation (`info`) as three SEPARATE `Completion` fields — never
 * concatenated into `label` — so `@codemirror/autocomplete`'s own rendering
 * (`.cm-completionLabel` / `.cm-completionDetail` / the side info panel)
 * can style and lay each one out independently (see `index.css`'s
 * `.cm-completionDetail` rule for why the popup LOOKED glued together
 * despite this already being true in code: a Tailwind preflight margin
 * reset ate the default theme's label/detail spacing, a CSS bug, not a
 * data one — this test guards the data half of that fix).
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { markiiCompletionSource } from "../../src/editor/markiiCompletion";

function optionsAt(doc: string, pos: number) {
  const state = EditorState.create({ doc });
  const result = markiiCompletionSource({ state, pos, explicit: false } as unknown as CompletionContext);
  expect(result).not.toBeNull();
  return result!.options;
}

describe("markiiCompletionSource option field separation", () => {
  it("keeps label as just the directive name, with detail (if any) a separate field", () => {
    const options = optionsAt(":::", 3);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      // The label must be a bare identifier-ish token — never the label
      // with a detail/description string glued onto the end of it.
      expect(option.label).not.toMatch(/\s/);
      if (option.detail) {
        expect(option.label.endsWith(option.detail)).toBe(false);
        expect(option.detail).not.toContain(option.label + option.detail);
      }
    }
  });

  it("carries documentation in `info`, not folded into `label` or `detail`", () => {
    const options = optionsAt(":::", 3);
    const withDocs = options.filter((o) => o.info !== undefined);
    expect(withDocs.length).toBeGreaterThan(0);
    for (const option of withDocs) {
      expect(typeof option.info).toBe("function");
      if (option.detail) {
        expect(option.detail).not.toBe(option.label);
      }
    }
  });
});

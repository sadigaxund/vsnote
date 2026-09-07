/**
 * R3-12 follow-up: `markiiCompletionSource`'s `from` must be the token
 * being typed, not the range an accepted item replaces.
 *
 * `@markii/host`'s `completionAt` reports `replaceStart` at the start of
 * the `:::` fence when the rest of the line is empty, because the accepted
 * skeleton replaces the whole line. CodeMirror, though, filters the
 * offered options against the document text between `CompletionResult.from`
 * and the cursor: with `from` at the fence that text is `":::"`, no
 * component label starts with it, every option is filtered away and the
 * popup never opens at all. That was the actual reason the directive
 * completion looked missing in both Source and Rendered mode.
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { markiiCompletionSource, markiiInsertionCursorPos } from "../../src/editor/markiiCompletion";

function sourceAt(doc: string, pos: number) {
  const state = EditorState.create({ doc });
  return markiiCompletionSource({ state, pos, explicit: false } as unknown as CompletionContext);
}

describe("markiiCompletionSource result range", () => {
  it("starts the completion after the colon run, so the filter text is the name being typed", () => {
    const result = sourceAt(":::", 3);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(3);
    expect(result!.options.length).toBeGreaterThan(0);
  });

  it("keeps a partially typed name as the filter text", () => {
    const result = sourceAt(":::ce", 5);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(3);
    // CodeMirror will filter these itself; the source stays unfiltered, so
    // what matters is that "center" is offered and reachable from "ce".
    expect(result!.options.map((o) => o.label)).toContain("center");
  });

  it("offers the whole catalog for a bare fence on a later line too", () => {
    const doc = "intro\n\n:::";
    const result = sourceAt(doc, doc.length);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(doc.length);
  });
});

describe("markiiInsertionCursorPos", () => {
  it("adds the skeleton's own cursor offset to where the insertion lands", () => {
    const state = EditorState.create({ doc: ":::cen" });
    const tr = state.update({ changes: { from: 0, to: 6, insert: ":::center{}\n\n:::" } });
    // 12 is the blank body line between the two fences of the inserted
    // skeleton; the old code mapped position 0 + 12 through a changeset
    // whose old document was only 6 long, which threw and silently
    // swallowed the whole accept.
    expect(markiiInsertionCursorPos(tr.changes, 0, 12)).toBe(12);
  });

  it("follows an insertion shifted by a fence-lengthening edit before it", () => {
    const state = EditorState.create({ doc: ":::center\nX\n:::" });
    const tr = state.update({
      changes: [
        { from: 0, to: 3, insert: "::::" },
        { from: 10, to: 11, insert: ":::note{}\n\n:::" },
      ],
    });
    expect(markiiInsertionCursorPos(tr.changes, 10, 10)).toBe(21);
  });
});

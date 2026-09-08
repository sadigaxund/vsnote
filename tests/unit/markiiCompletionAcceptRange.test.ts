/**
 * Round 6 MK item 2: accepting a completion must replace the WHOLE typed
 * prefix (from the start of the `:::`/`::`/`:` run through everything typed
 * since), never leave a leftover tail behind. Reproduces the exact bug:
 * `markiiCompletionSource` queries once (e.g. right after typing `:::`,
 * before the name), CodeMirror's `validFor` regex keeps re-using that same
 * `Completion` object as the author keeps typing (`ro`, `row`, ...) without
 * re-querying — see `markiiCompletion.ts`'s own `validFor` comment — and
 * `@codemirror/autocomplete` tracks the growing end of that typed span
 * itself, handing it to `apply` as a live 4th argument on accept. The old
 * code closed over the STALE end from the original query instead of reading
 * that live value, so accepting after typing past the query position left
 * the extra characters behind, right after the inserted skeleton.
 */
import { describe, expect, it } from "vitest";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { markiiCompletionSource } from "../../src/editor/markiiCompletion";

/**
 * A minimal `EditorView` stand-in: `applyMarkiiInsertion` only ever reads
 * `view.state` and calls `view.dispatch` with either a real `Transaction`
 * (has its own `.state`) or a plain `TransactionSpec` (needs `state.update`)
 * — exactly what a real `EditorView` does, without needing an actual DOM
 * (this suite runs under Vitest's `node` environment, see `vitest.config.ts`).
 */
function fakeView(doc: string): EditorView {
  let state = EditorState.create({ doc });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      state = "state" in spec && spec.state instanceof EditorState ? spec.state : state.update(spec as TransactionSpec).state;
    },
  };
  return view as unknown as EditorView;
}

function optionsAt(doc: string, pos: number) {
  const state = EditorState.create({ doc });
  const result = markiiCompletionSource({ state, pos, explicit: false } as unknown as CompletionContext);
  expect(result).not.toBeNull();
  return result!;
}

function findOption(options: readonly Completion[], label: string): Completion {
  const option = options.find((o) => o.label === label);
  expect(option).toBeDefined();
  return option!;
}

/** Simulates CM's real accept call: `apply(view, completion, from, to)` — `from`/`to` are dummy/live values a real accept would pass; only `to` is exercised (see `toCmCompletion`'s own doc for why `from` is fixed and closed over instead). */
function accept(option: Completion, view: EditorView, from: number, liveTo: number): void {
  expect(typeof option.apply).toBe("function");
  (option.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(view, option, from, liveTo);
}

describe("completion accept replaces the whole typed prefix", () => {
  it("accepting over `:::ro` after the query ran at `:::` leaves no leftover `ro`", () => {
    // Query happens the instant `:::` is typed (before `ro`) — this is when
    // the real popup first opens and builds its `Completion` objects.
    const queried = optionsAt(":::", 3);
    const row = findOption(queried.options, "row");

    // By the time the author accepts, `ro` has been typed and CM re-used
    // the SAME option (validFor kept matching) rather than re-querying —
    // the document now reads `:::ro`, and CM would pass a live `to` of 5.
    const view = fakeView(":::ro");
    accept(row, view, 0, 5);

    expect(view.state.doc.toString()).toBe(":::row\n\n:::");
  });

  it("accepting over `::rat` (leaf form) leaves no leftover tail", () => {
    const queried = optionsAt("::", 2);
    const rating = findOption(queried.options, "rating");

    const view = fakeView("::rat");
    accept(rating, view, 0, 5);

    expect(view.state.doc.toString()).toBe("::rating");
  });

  it("accepting `:::` alone (caret at end, nothing typed after) still works — the no-extra-typing baseline", () => {
    const queried = optionsAt(":::", 3);
    const row = findOption(queried.options, "row");

    const view = fakeView(":::");
    accept(row, view, 0, 3);

    expect(view.state.doc.toString()).toBe(":::row\n\n:::");
  });

  it("accepting with a mid-line caret (trailing text already on the line) replaces only the typed name, never the fence or the trailing text", () => {
    // With something non-blank already after the caret (`ctx`'s `isRestEmpty`
    // false — `completion.ts`'s `directiveNameCompletionContext`), the item
    // is just the bare directive name, not a full skeleton, and its replace
    // range starts AFTER the colon run rather than at the fence — this is
    // the "author is already editing an existing directive line" shape, not
    // the "insert a fresh skeleton" one the other cases above cover.
    const doc = ":::ro cols=3";
    const queried = optionsAt(doc, 5); // caret right after "ro"
    const row = findOption(queried.options, "row");

    const view = fakeView(doc);
    accept(row, view, 3, 5);

    expect(view.state.doc.toString()).toBe(":::row cols=3");
  });
});

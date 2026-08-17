/**
 * DESIGN-SPEC item 38's Format/Insert actions — pure CM6 operations over the
 * focused editor's `EditorView`, driven by `activeView.ts`'s
 * `getActiveEditorView(paneId)` (the same "reach the real focused view
 * without prop-drilling" mechanism `openSearchInActiveView` already uses).
 * Nothing here knows about React, panes, or the menu that calls it — it's a
 * thin CM6 command layer, matched to `editor/activeView.ts`'s module doc
 * ("the app's single source of truth for the focused view").
 *
 * `wrapSelection` implements the shared "toggle a pair of markers around the
 * selection, or insert both and place the cursor between them when there is
 * no selection" behavior item 38 specifies for every Format action (bold,
 * italic, strikethrough, inline code, link — link's marker pair is `[` /
 * `](url)`, so wrapping a selection produces `[selected](url)` with the
 * literal `url` placeholder left for the user to overtype, and toggling twice
 * removes the pair again like every other Format action). `insertBlock`
 * implements the Insert actions (table, code block, horizontal rule):
 * unlike Format, these don't wrap a selection — they insert a fresh block at
 * the cursor, padded with the blank lines the CM6 markdown parser (and the
 * live-preview decoration plugin reading the same parse) needs to recognize
 * a table/fence/thematic-break as its own block rather than trailing
 * whatever paragraph the cursor happened to be inside.
 */
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface MarkerPair {
  before: string;
  after: string;
}

function wrapSelection(view: EditorView, marker: MarkerPair): void {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const { before, after } = marker;
    if (range.empty) {
      return {
        changes: [{ from: range.from, insert: before + after }],
        range: EditorSelection.cursor(range.from + before.length),
      };
    }
    const selected = state.sliceDoc(range.from, range.to);
    // Toggle off: the selection already carries this exact marker pair —
    // unwrap instead of double-wrapping (e.g. pressing Bold twice on the
    // same bolded selection removes the `**`/`**` rather than nesting them).
    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
      const inner = selected.slice(before.length, selected.length - after.length);
      return {
        changes: [{ from: range.from, to: range.to, insert: inner }],
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
}

export function formatBold(view: EditorView): void {
  wrapSelection(view, { before: "**", after: "**" });
}

export function formatItalic(view: EditorView): void {
  wrapSelection(view, { before: "*", after: "*" });
}

export function formatStrikethrough(view: EditorView): void {
  wrapSelection(view, { before: "~~", after: "~~" });
}

export function formatInlineCode(view: EditorView): void {
  wrapSelection(view, { before: "`", after: "`" });
}

export function formatLink(view: EditorView): void {
  wrapSelection(view, { before: "[", after: "](url)" });
}

/** Blank-line padding an Insert action needs BEFORE the cursor — none when
 * already at the document start or already separated by a blank line, one
 * `\n` when only a single line break precedes it, two when the cursor sits
 * mid-line (pushing whatever's already on that line above the new block). */
function leadingPad(before: string): string {
  if (before === "" || before.endsWith("\n\n")) return "";
  return before.endsWith("\n") ? "\n" : "\n\n";
}

/** Same padding, mirrored for the content AFTER the cursor. */
function trailingPad(after: string): string {
  if (after === "" || after.startsWith("\n\n")) return "";
  return after.startsWith("\n") ? "\n" : "\n\n";
}

function insertBlock(view: EditorView, build: (state: EditorState) => { text: string; cursorOffset: number }): void {
  const { state } = view;
  const range = state.selection.main;
  const lead = leadingPad(state.sliceDoc(0, range.from));
  const trail = trailingPad(state.sliceDoc(range.to, state.doc.length));
  const { text, cursorOffset } = build(state);
  const insertion = lead + text + trail;
  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert: insertion },
      selection: EditorSelection.cursor(range.from + lead.length + cursorOffset),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  view.focus();
}

export function insertTable(view: EditorView): void {
  insertBlock(view, () => ({
    text: "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |",
    cursorOffset: 2, // right after "| ", on the first header cell's placeholder text
  }));
}

export function insertCodeBlockMarker(view: EditorView): void {
  insertBlock(view, () => ({
    text: "```\n\n```",
    cursorOffset: 4, // the blank line between the two fences
  }));
}

export function insertHorizontalRule(view: EditorView): void {
  insertBlock(view, () => ({ text: "---", cursorOffset: 3 }));
}

export type FormatActionId = "bold" | "italic" | "strikethrough" | "code" | "link";
export type InsertActionId = "table" | "codeblock" | "hr";

export function applyFormatAction(view: EditorView, action: FormatActionId): void {
  switch (action) {
    case "bold":
      return formatBold(view);
    case "italic":
      return formatItalic(view);
    case "strikethrough":
      return formatStrikethrough(view);
    case "code":
      return formatInlineCode(view);
    case "link":
      return formatLink(view);
  }
}

export function applyInsertAction(view: EditorView, action: InsertActionId): void {
  switch (action) {
    case "table":
      return insertTable(view);
    case "codeblock":
      return insertCodeBlockMarker(view);
    case "hr":
      return insertHorizontalRule(view);
  }
}

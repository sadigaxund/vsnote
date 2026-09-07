/**
 * CM6 wiring for the Markii extension's directive completion/hover/insert
 * (docs/PLAN-2026-09-05-refresh.md §6 Phase M1's last bullet, extended by
 * R3-12 to Rendered mode). `markiiEditorExtensions()` is passed as
 * `.mk.md`'s extension bundle in BOTH modes now: Source mode via
 * `EditorContent.tsx`'s `CodeMirrorEditor.extraExtensions` (unchanged), and
 * Rendered mode via `LivePreviewEditor.tsx`'s own `.mk.md` compartment (see
 * that file's module doc for why this needed a separate dispatch from the
 * directive-language/decorations compartments — this bundle reads no
 * syntax tree at all, so it carries none of their ordering hazard and can
 * be installed independently).
 *
 * The pure logic (`completionAt`/`hoverAt`/`fenceExtensionEdits`/
 * `componentSkeleton`) is `@markii/host`'s — vendored under
 * `src/markdown/vendor/markiiHost/` since that package is `private: true`
 * upstream and never published to npm (see that directory's file headers).
 * This module is the CM6-specific glue on top: turning a cursor position
 * into the (line text, column) pair those pure functions take, and turning
 * their results back into `@codemirror/autocomplete` / `@codemirror/view`
 * API shapes.
 *
 * R3-12 also adds the MANUAL-TYPING fence-lengthening path
 * (`manualContainerOpenFenceEdits` + the Enter keymap below): vendored
 * `fenceExtensionEdits` only ever ran on a completion accept or "Insert
 * component", both of which insert a COMPLETE skeleton (opening fence +
 * body + closing fence) in one shot — `insertedContainerColonCount` only
 * recognizes that shape (it requires the inserted text to end with
 * `\n` + the same colon run it starts with). An author who hand-types
 * `:::note` inside `:::center`/`:::` and presses Enter has produced only
 * an OPENING fence line with no closing counterpart yet, so upstream's
 * function returns `[]` for it — see this file's own doc-comment on
 * `manualContainerOpenFenceEdits` for the small amount of vendored-logic
 * duplication that gap required, and the HANDOVER note this is recorded
 * against.
 */
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, type Tooltip } from "@codemirror/view";
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
  buildComponentCatalog,
  completionAt,
  componentSkeleton,
  enclosingContainerFences,
  fenceExtensionEdits,
  formatComponentDocumentation,
  hoverAt,
  type DiscoveredPack,
  type FenceLineEdit,
  type InsertableComponent,
} from "../markdown/vendor/markiiHost";

/**
 * Which packs the completion/hover/insert catalog below is currently built
 * from (worker 2, Phase M3). Module-level, mutable state, set by
 * `setMarkiiDiscoveredPacks` — worker 3's Packs settings UI calls that
 * whenever the enabled-packs set changes (enable/disable/remove), so an
 * already-open `.mk.md` editor's completion/hover picks up the change on
 * its next keystroke/hover without needing to be remounted. Defaults to
 * `[]` (standard components only), matching this module's behavior before
 * packs existed.
 */
let discoveredPacks: readonly DiscoveredPack[] = [];

/** Worker 3's Packs settings UI calls this whenever the enabled-packs set changes — see `discoveredPacks`'s doc comment. Pass every ENABLED pack (an `EnabledPack` from `src/markii/host/packs.ts` already satisfies `DiscoveredPack`'s shape); a disabled pack should not be included. */
export function setMarkiiDiscoveredPacks(packs: readonly DiscoveredPack[]): void {
  discoveredPacks = packs;
}

/** Rebuilds the catalog on every call from the CURRENT `discoveredPacks` — cheap (a handful of standard components plus, realistically, a handful of pack components) and keeps completion/hover pack-aware without a stale cache to invalidate. */
function currentCatalog(): readonly InsertableComponent[] {
  return buildComponentCatalog(discoveredPacks);
}

function lineAndColumnAt(context: CompletionContext): { lineText: string; column: number; lineFrom: number } {
  const line = context.state.doc.lineAt(context.pos);
  return { lineText: line.text, column: context.pos - line.from, lineFrom: line.from };
}

/**
 * Applies one accepted completion item, folding in `fenceExtensionEdits`
 * (for a container skeleton nested inside another container) into the SAME
 * transaction as the insertion itself — one undo step, per the plan's
 * explicit requirement.
 */
/**
 * Applies one insertion (`insertText`/`insertCursorOffset`, the shape both
 * a completion item and `componentSkeleton` share) at `[from, to)`, folding
 * `fenceExtensionEdits` (for a container skeleton nested inside another
 * container) into the SAME transaction — one undo step, per the plan's
 * explicit requirement. Shared by the completion popup (`toCmCompletion`)
 * and the standalone "Insert component" command below.
 */
function applyMarkiiInsertion(view: EditorView, insertText: string, insertCursorOffset: number, from: number, to: number): void {
  const doc = view.state.doc;
  const insertionLine = doc.lineAt(from).number - 1; // fenceExtensionEdits' lines are zero-based
  const edits = fenceExtensionEdits(doc.toString(), insertionLine, insertText);

  const changes = [
    ...edits.map((edit) => {
      const editLine = doc.line(edit.line + 1);
      const editFrom = editLine.from + edit.column;
      return { from: editFrom, to: editFrom + edit.oldText.length, insert: edit.newText };
    }),
    { from, to, insert: insertText },
  ];

  const tr = view.state.update({ changes });
  const cursorPos = tr.changes.mapPos(from + insertCursorOffset, 1);
  view.dispatch(tr);
  view.dispatch({ selection: EditorSelection.cursor(cursorPos) });
}

function toCmCompletion(item: ReturnType<typeof completionAt>["items"][number], from: number, to: number): Completion {
  return {
    label: item.label,
    type: item.kind === "component" ? "class" : item.kind === "attribute" ? "property" : "text",
    detail: item.detail || undefined,
    info: item.documentation
      ? () => {
          const text = formatComponentDocumentation(item.documentation!);
          return text ? document.createTextNode(text) : null;
        }
      : undefined,
    apply: (view) => applyMarkiiInsertion(view, item.insertText, item.insertCursorOffset, from, to),
  };
}

/** `@codemirror/autocomplete` `CompletionSource` backed by `@markii/host`'s `completionAt`. */
export function markiiCompletionSource(context: CompletionContext): CompletionResult | null {
  const { lineText, column, lineFrom } = lineAndColumnAt(context);
  const ctx = completionAt(lineText, column, currentCatalog());
  if (ctx.kind === "none" || ctx.items.length === 0) return null;

  const from = lineFrom + ctx.replaceStart;
  const to = lineFrom + ctx.replaceEnd;
  return {
    from,
    to,
    options: ctx.items.map((item) => toCmCompletion(item, from, to)),
  };
}

/** `@codemirror/view` `hoverTooltip` backed by `@markii/host`'s `hoverAt`. */
export const markiiHoverTooltip: Extension = hoverTooltip((view, pos): Tooltip | null => {
  const line = view.state.doc.lineAt(pos);
  const column = pos - line.from;
  const info = hoverAt(line.text, column, currentCatalog());
  if (!info) return null;

  const text = formatComponentDocumentation(info.documentation) || info.directiveName;
  return {
    pos: line.from + info.start,
    end: line.from + info.end,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-markii";
      dom.style.whiteSpace = "pre-wrap";
      dom.style.maxWidth = "360px";
      dom.style.padding = "6px 8px";
      dom.style.fontFamily = "var(--font-sans)";
      dom.style.fontSize = "12px";
      dom.textContent = text;
      return { dom };
    },
  };
});

/**
 * "Insert component" command: inserts `directiveName`'s skeleton at the
 * cursor, folding fence-extension edits into the same transaction (same
 * `applyMarkiiCompletion` helper the completion popup itself uses).
 * `EditorHeader`/`OverflowMenu`-style callers wire this to a command
 * palette entry or menu item for `.mk.md` files.
 */
export function insertMarkiiComponent(view: EditorView, directiveName: string): boolean {
  const component = currentCatalog().find((c) => c.directiveName === directiveName);
  if (!component) return false;

  const skeleton = componentSkeleton(component.directiveName, component.kind, component.requiredAttributes);
  const pos = view.state.selection.main.head;
  applyMarkiiInsertion(view, skeleton.text, skeleton.cursorOffset, pos, pos);
  view.focus();
  return true;
}

/**
 * A hand-typed container-directive OPENING fence line, e.g. `:::note` or
 * `::::wide{align="center"}` — three or more colons immediately followed by
 * a directive name. Deliberately excludes a bare closing fence (`:::` with
 * nothing after the colons: no name group to match) and anything
 * fenced-code-shaped (backtick/tilde, not colon), so "typing a bare `:::`
 * closing line changes nothing else" and "never touch fenced code blocks"
 * both fall out of this regex alone, before `manualContainerOpenFenceEdits`
 * even reaches the code-fence check below.
 */
const CONTAINER_OPEN_FENCE_RE = /^ {0,3}(:{3,})[A-Za-z0-9_-]/;

/** Mirrors `containerFences.ts`'s own (unexported) `CODE_FENCE_RE` — see `isInsideFencedCode`'s doc for why this couldn't just be imported. */
const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Whether `lines[uptoLineExclusive]` sits inside an OPEN fenced code block,
 * scanning from the top of the document. Duplicates the fence-toggling half
 * of vendored `containerFences.ts`'s `stepCodeFence` (that helper isn't
 * exported — `@markii/host`'s own public surface only ever needs it
 * internally, since `enclosingContainerFences` already folds code-fence
 * skipping into its own single top-to-bottom pass). This module needs the
 * same fact answered in isolation, BEFORE it decides whether a line even
 * looks like a container opener worth reasoning about at all, so it
 * re-derives it here rather than hand-editing the vendored file (repo rule:
 * "re-fetch from upstream on version bumps rather than hand-editing").
 */
function isInsideFencedCode(lines: readonly string[], uptoLineExclusive: number): boolean {
  let state: { char: string; length: number } | undefined;
  for (let i = 0; i < uptoLineExclusive; i++) {
    const text = lines[i] ?? "";
    const match = CODE_FENCE_RE.exec(text);
    if (state === undefined) {
      if (match) {
        const run = match[1] ?? "";
        const info = match[2] ?? "";
        if (!(run.startsWith("`") && info.includes("`"))) {
          state = { char: run[0] ?? "`", length: run.length };
        }
      }
      continue;
    }
    if (match) {
      const run = match[1] ?? "";
      const info = match[2] ?? "";
      if (run[0] === state.char && run.length >= state.length && info.trim() === "") {
        state = undefined;
      }
    }
  }
  return state !== undefined;
}

/**
 * The manual-typing counterpart to vendored `fenceExtensionEdits`: given
 * that `openLine` (zero-based) was JUST typed as a container-opening fence
 * (`:::name`, no closing fence of its own yet), lengthens every enclosing
 * container pair transitively so the hierarchy still parses — same
 * algorithm as `fenceExtensionEdits`'s own loop (innermost enclosing pair
 * first, each pair's new colon count is `max(current, deepestInside + 1)`,
 * propagated outward), just fed `openLine`'s own colon count directly
 * instead of extracting it from a skeleton string via
 * `insertedContainerColonCount` (which requires a matching closing fence to
 * already be present in the inserted text — see this file's module doc).
 * Returns `[]` for anything that isn't a hand-typed container opener, or
 * that sits inside a fenced code block, or that has no lengthening to do
 * (including "typing inside an already-longer outer pair" — a deliberate
 * no-op, matching upstream's own fence rule).
 */
export function manualContainerOpenFenceEdits(documentText: string, openLine: number): readonly FenceLineEdit[] {
  if (typeof documentText !== "string") return [];
  if (!Number.isInteger(openLine) || openLine < 0) return [];

  const lines = documentText.split("\n");
  const lineText = lines[openLine];
  if (lineText === undefined) return [];
  if (isInsideFencedCode(lines, openLine)) return [];

  const match = CONTAINER_OPEN_FENCE_RE.exec(lineText);
  if (!match) return [];
  const colonCount = (match[1] ?? "").length;

  const enclosing = enclosingContainerFences(documentText, openLine);
  if (enclosing === undefined || enclosing.length === 0) return [];

  const edits: FenceLineEdit[] = [];
  let deepestInside = colonCount;
  for (let i = enclosing.length - 1; i >= 0; i--) {
    const pair = enclosing[i];
    if (!pair) continue;
    const nextCount = Math.max(pair.colonCount, deepestInside + 1);
    if (nextCount !== pair.colonCount) {
      const oldText = ":".repeat(pair.colonCount);
      const newText = ":".repeat(nextCount);
      edits.push({ line: pair.openLine, column: pair.openColumn, oldText, newText });
      edits.push({ line: pair.closeLine, column: pair.closeColumn, oldText, newText });
    }
    deepestInside = nextCount;
  }

  return edits.sort((a, b) => a.line - b.line);
}

/**
 * Enter keymap handler: when the line the cursor is leaving is a hand-typed
 * container opener, folds `manualContainerOpenFenceEdits` into the SAME
 * transaction as the newline insertion (one undo step, matching the
 * completion-accept/"Insert component" paths' own contract) and returns
 * `true` to consume the keystroke. Returns `false` (falls through to
 * whatever binding is next — list continuation, indentation, etc.) whenever
 * there is nothing to lengthen, so this never changes Enter's behavior on
 * an ordinary line, a closing `:::`, or a line inside fenced code.
 */
function handleContainerOpenFenceEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.head);
  const edits = manualContainerOpenFenceEdits(state.doc.toString(), line.number - 1);
  if (edits.length === 0) return false;

  const changes = edits.map((edit) => {
    const editLine = state.doc.line(edit.line + 1);
    const editFrom = editLine.from + edit.column;
    return { from: editFrom, to: editFrom + edit.oldText.length, insert: edit.newText };
  });

  const mappedHead = state.changes(changes).mapPos(sel.head, 1);
  const tr = state.update({
    changes: [...changes, { from: sel.head, to: sel.head, insert: "\n" }],
    selection: { anchor: mappedHead + 1 },
    scrollIntoView: true,
  });
  view.dispatch(tr);
  return true;
}

/**
 * High precedence so this runs before atomic-editor's/CM6's own Enter
 * bindings (list continuation, markdown indent-on-enter) can consume the
 * keystroke first — it always falls through cleanly (returns `false`) when
 * there is nothing to lengthen, so it never shadows those other bindings on
 * an ordinary line.
 */
const containerFenceEnterKeymap: Extension = Prec.highest(
  keymap.of([{ key: "Enter", run: handleContainerOpenFenceEnter }]),
);

/**
 * The full extension bundle for `.mk.md`, used by BOTH modes (see this
 * file's module doc): `EditorContent.tsx` passes this as `CodeMirrorEditor`
 * `extraExtensions` for Source mode, and `LivePreviewEditor.tsx` passes it
 * through its own `.mk.md` compartment for Rendered mode.
 */
export function markiiEditorExtensions(): Extension[] {
  return [
    autocompletion({ override: [markiiCompletionSource] }),
    markiiHoverTooltip,
    containerFenceEnterKeymap,
    EditorView.baseTheme({
      ".cm-tooltip-markii": { color: "var(--color-fg)", background: "var(--color-surface-elevated)" },
    }),
  ];
}

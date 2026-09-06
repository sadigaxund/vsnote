/**
 * CM6 wiring for the Markii extension's directive completion/hover/insert
 * (docs/PLAN-2026-09-05-refresh.md §6 Phase M1's last bullet) — Source
 * mode ONLY, for `.mk.md` files (`filetypes/registry.ts`'s `mkmd` kind;
 * `EditorContent.tsx` passes this module's `markiiEditorExtensions()` to
 * `CodeMirrorEditor`'s `extraExtensions` only for that kind, never for
 * plain `.md`).
 *
 * The pure logic (`completionAt`/`hoverAt`/`fenceExtensionEdits`/
 * `componentSkeleton`) is `@markii/host`'s — vendored under
 * `src/markdown/vendor/markiiHost/` since that package is `private: true`
 * upstream and never published to npm (see that directory's file headers).
 * This module is the CM6-specific glue on top: turning a cursor position
 * into the (line text, column) pair those pure functions take, and turning
 * their results back into `@codemirror/autocomplete` / `@codemirror/view`
 * API shapes.
 */
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
  buildComponentCatalog,
  completionAt,
  componentSkeleton,
  fenceExtensionEdits,
  formatComponentDocumentation,
  hoverAt,
  type DiscoveredPack,
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

/** The full Source-mode extension bundle for `.mk.md` (`EditorContent.tsx` passes this as `CodeMirrorEditor`'s `extraExtensions` only for `kind === "mkmd"`). */
export function markiiEditorExtensions(): Extension[] {
  return [
    autocompletion({ override: [markiiCompletionSource] }),
    markiiHoverTooltip,
    EditorView.baseTheme({
      ".cm-tooltip-markii": { color: "var(--color-fg)", background: "var(--color-surface-elevated)" },
    }),
  ];
}

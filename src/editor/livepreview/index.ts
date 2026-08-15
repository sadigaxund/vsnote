/**
 * Public entry point for the Obsidian-style live-preview extension —
 * `editor/livepreview/` per ARCHITECTURE.md's module list. See `plugin.ts`
 * for the decoration logic (and its OSS attribution) and its `focused`
 * parameter's doc comment for why hiding is gated on DOM focus, not just
 * selection position.
 *
 * Decorations are provided from a `StateField`, not a `ViewPlugin`. CM6
 * enforces this: `hideWholeLine` (`plugin.ts`) produces `Decoration.replace`
 * ranges that span a line break (collapsing an entire fenced-code fence
 * line, marks *and* its trailing newline, so it disappears instead of
 * leaving a blank row) — and CM6 throws `"Decorations that replace line
 * breaks may not be specified via plugins"` if a `ViewPlugin` tries to
 * supply those (confirmed empirically: the first implementation used a
 * `ViewPlugin` and crashed the editor on mount with exactly that error).
 * `StateField`-sourced decorations are exempt from that restriction since
 * they're computed synchronously with the document rather than during
 * view measurement.
 */
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { buildLivePreviewDecorations, type LivePreviewOptions } from "./plugin";
import { livePreviewTheme } from "./theme";

export type { LivePreviewOptions } from "./plugin";

const setFocused = StateEffect.define<boolean>();

interface FieldValue {
  focused: boolean;
  deco: DecorationSet;
}

function livePreviewField(opts: LivePreviewOptions) {
  return StateField.define<FieldValue>({
    create(state) {
      return { focused: false, deco: buildLivePreviewDecorations(state, false, opts) };
    },
    update(value, tr) {
      let focused = value.focused;
      for (const effect of tr.effects) {
        if (effect.is(setFocused)) focused = effect.value;
      }
      if (tr.docChanged || focused !== value.focused || !tr.startState.selection.eq(tr.state.selection)) {
        return { focused, deco: buildLivePreviewDecorations(tr.state, focused, opts) };
      }
      return value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (v) => v.deco),
      // The idiomatic CM6 hook for "produce an effect when the view's DOM
      // focus changes" — see plugin.ts's `overlapsSelection` doc for why
      // this drives the reveal/hide toggle instead of selection alone.
      EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
    ],
  });
}

/** The full live-preview extension set: decorations + typography theme.
 * Callers still supply their own language (`@codemirror/lang-markdown`
 * with the `TaskList`/`Strikethrough` GFM extensions — see
 * `editor/LivePreviewEditor.tsx`), base extensions (history, search,
 * selection), and line wrapping. */
export function livePreviewExtensions(opts: LivePreviewOptions) {
  return [livePreviewField(opts), livePreviewTheme];
}

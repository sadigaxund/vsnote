/**
 * Base CM6 extensions shared by every editor surface — IMPLEMENTATION-PLAN.md
 * Phase 3: "line numbers, active line, bracket match, search panel, word
 * wrap setting", plus the minimum extra (undo history, selection, bracket
 * closing) needed for this to genuinely replace Phase 2's crude `Textarea`
 * rather than just look like an editor. Deliberately hand-assembled instead
 * of the `codemirror` package's `basicSetup` bundle, so bundle weight stays
 * limited to exactly what DESIGN-SPEC/IMPLEMENTATION-PLAN ask for (no
 * autocomplete UI, no code folding — out of this phase's scope).
 *
 * `wordWrapCompartment`/`tabSizeCompartment`/`fontSizeCompartment`/
 * `lineHeightCompartment` are module-level `Compartment` instances shared
 * across every mounted editor (CM6's documented pattern for a setting that
 * needs live reconfiguration — a `Compartment` carries no per-editor state
 * itself, so reusing one across concurrently-alive `EditorState`s is safe)
 * — `CodeMirrorEditor.tsx` dispatches `.reconfigure()` through them when
 * `useSettingsStore`'s `wordWrap`/`tabSize`/`editorFontSize`/
 * `editorLineSpacing` change.
 *
 * `lineHeightCompartment` (Phase 6.5c, DESIGN-SPEC Amendments item 11's
 * "Editor" category) is the SOLE source of `.cm-scroller`'s `line-height` —
 * `editor/theme.ts`'s static `editorTheme` no longer hardcodes it at all
 * (previously `"1.6"`), so there's no second `EditorView.theme()` rule
 * fighting this one over the same property/selector, and therefore no
 * `Prec.highest` precedence dance needed to make it win (the mechanism
 * `LivePreviewEditor.tsx`'s `fontSizeCompartment` usage documents in
 * detail, for a case where a competing static rule DOES exist). */
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { createFindPanel } from "./findPanel";

export const wordWrapCompartment = new Compartment();
export const tabSizeCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();
export const lineHeightCompartment = new Compartment();

// We own Ctrl/Cmd+F globally (DESIGN-SPEC Amendments item 5 —
// `editor/activeView.ts`'s `openSearchInActiveView`), so the default
// open-search bindings are dropped here rather than left to race our own
// window-level handler for the same key.
const ownedSearchKeymap = searchKeymap.filter((k) => k.key !== "Mod-f" && k.key !== "Mod-Shift-f");

export function fontSizeTheme(px: number) {
  return EditorView.theme({ "&": { fontSize: `${px}px` } });
}

export function lineHeightTheme(multiplier: number) {
  return EditorView.theme({ ".cm-scroller": { lineHeight: String(multiplier) } });
}

export interface BaseExtensionOptions {
  wordWrap: boolean;
  tabSize: number;
  fontSize: number;
  lineSpacing: number;
}

export function baseExtensions({ wordWrap, tabSize, fontSize, lineSpacing }: BaseExtensionOptions) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    // DESIGN-SPEC Amendments item 9: `createPanel` swaps the stock vanilla
    // find/replace panel for the VSCode-style floating `FindWidget` — see
    // `editor/findPanel.ts`'s module doc for why this keeps match
    // highlighting fully native.
    search({ top: true, createPanel: createFindPanel }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...ownedSearchKeymap, indentWithTab]),
    wordWrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
    tabSizeCompartment.of(indentUnit.of(" ".repeat(Math.max(1, tabSize)))),
    fontSizeCompartment.of(fontSizeTheme(fontSize)),
    lineHeightCompartment.of(lineHeightTheme(lineSpacing)),
  ];
}

/** Read-only variant for `DiffView.tsx`'s two panes — no undo history,
 * bracket-closing, or edit keymap (nothing there ever edits), but the same
 * navigation/search/appearance baseline. */
export function readOnlyBaseExtensions({ wordWrap, fontSize, lineSpacing }: Omit<BaseExtensionOptions, "tabSize">) {
  return [
    lineNumbers(),
    highlightActiveLine(),
    drawSelection(),
    search({ top: true, createPanel: createFindPanel }),
    highlightSelectionMatches(),
    keymap.of([...ownedSearchKeymap]),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    wordWrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
    fontSizeCompartment.of(fontSizeTheme(fontSize)),
    lineHeightCompartment.of(lineHeightTheme(lineSpacing)),
  ];
}

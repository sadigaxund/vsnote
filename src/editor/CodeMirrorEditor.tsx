/**
 * CM6 Source-mode editor — replaces Phase 2's crude `Textarea`
 * (EditorContent.tsx's module doc). One `EditorView` per open file: keyed
 * by `path` at the call site (`EditorContent.tsx`) so switching files
 * remounts rather than trying to diff/patch one long-lived view's doc —
 * simpler than reconciling "did this content prop change because of our
 * own onChange, or externally (tab switch, discard)?" by hand, and cheap
 * since `useBufferStore` (not this component) is the source of truth for
 * content, so nothing is lost on remount.
 *
 * Wires together `baseExtensions` (line numbers/history/search/…),
 * `editorExtensions` (theme + syntax highlighting), the per-filetype
 * language (lazy — `filetypes/registry.ts`), and `gitGutter` (the change
 * bars, fed the same `git/diff.ts` result the diff-stat chip reads).
 */
import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import {
  baseExtensions,
  fontSizeCompartment,
  fontSizeTheme,
  tabSizeCompartment,
  wordWrapCompartment,
} from "./baseExtensions";
import { editorExtensions } from "./theme";
import { dispatchGitDiff, gitGutter } from "./gitGutter";
import { getActiveEditorView, setActiveEditorView } from "./activeView";
import { useSettingsStore } from "../stores/useSettingsStore";
import { EMPTY_DIFF, type FileDiffResult } from "../git/diff";

export interface CursorPos {
  line: number;
  column: number;
}

export interface CodeMirrorEditorProps {
  path: string;
  content: string;
  loadLanguage: () => Promise<Extension | null>;
  diff?: FileDiffResult;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (pos: CursorPos) => void;
}

export function CodeMirrorEditor({
  path,
  content,
  loadLanguage,
  diff = EMPTY_DIFF,
  readOnly = false,
  onChange,
  onCursorChange,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Refs so the mount effect (keyed only on `path`) always calls the latest
  // callback without needing to be in its dependency array — recreating the
  // whole EditorView every render a parent re-renders would drop focus,
  // selection, and undo history for no reason. Synced via an effect (not
  // during render) since CM6's updateListener only ever fires well after
  // commit, so the one-tick-later assignment costs nothing in practice.
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
  });

  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const fontSize = useSettingsStore((s) => s.editorFontSize);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    const languageCompartment = new Compartment();

    const state = EditorState.create({
      doc: content,
      extensions: [
        ...baseExtensions({ wordWrap, tabSize, fontSize }),
        ...editorExtensions(),
        gitGutter(),
        languageCompartment.of([]),
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !readOnly) {
            onChangeRef.current?.(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorChangeRef.current?.({ line: line.number, column: head - line.from + 1 });
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    setActiveEditorView(view);
    dispatchGitDiff(view, diff);

    const initialLine = view.state.doc.lineAt(view.state.selection.main.head);
    onCursorChangeRef.current?.({
      line: initialLine.number,
      column: view.state.selection.main.head - initialLine.from + 1,
    });

    void loadLanguage().then((ext) => {
      if (destroyed) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext ?? []) });
    });

    return () => {
      destroyed = true;
      if (viewRef.current === view) viewRef.current = null;
      if (getActiveEditorView() === view) setActiveEditorView(null);
      view.destroy();
    };
    // Intentionally scoped to `path` only — this effect owns the mount
    // lifecycle of one EditorView per file; settings/diff changes are
    // applied via the reconfigure effects below instead of a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Sync content that changed for reasons other than this editor's own
  // typing (e.g. a discard-to-saved action elsewhere) without disturbing an
  // in-progress edit that produced the same value.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  useEffect(() => {
    if (viewRef.current) dispatchGitDiff(viewRef.current, diff);
  }, [diff]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wordWrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabSizeCompartment.reconfigure(indentUnit.of(" ".repeat(Math.max(1, tabSize)))),
    });
  }, [tabSize]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(fontSize)) });
  }, [fontSize]);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

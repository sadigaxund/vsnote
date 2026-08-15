/**
 * "Rendered" mode for `.md` files — the Obsidian-style live-preview CM6
 * editor (DESIGN-SPEC "Markdown live preview ... non-negotiable"; the
 * centerpiece of Phase 4 per IMPLEMENTATION-PLAN.md). This is a REAL,
 * editable CM6 `EditorView` with decorations, not a static HTML render and
 * not a read-only preview pane — see `editor/livepreview/` for the
 * decoration plugin and its OSS attribution.
 *
 * Mirrors `CodeMirrorEditor.tsx`'s mount/remount-per-path pattern (one
 * `EditorView` per open file, remounted rather than patched on file
 * switch — `useBufferStore` stays the source of truth so nothing is lost)
 * but swaps in prose-typography extensions instead of the code-editor
 * baseline: no line numbers/gutter, `EditorView.lineWrapping` always on
 * (a centered reading column always wraps, independent of the
 * `wordWrap` code-editor setting), and its own `livePreviewTheme`
 * typography instead of `editor/theme.ts`'s monospace editor theme.
 *
 * `readOnly` implements DESIGN-SPEC's "read-only reading view lock" as the
 * *same* view with editing disabled (not a separate renderer) — Obsidian
 * read/write parity. No lock-toggle UI ships this phase (optional per
 * spec); the prop exists so Phase 5's settings-driven default can flip it
 * without touching this component.
 */
import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, TaskList } from "@lezer/markdown";
import { livePreviewExtensions } from "./livepreview";
import { getActiveEditorView, setActiveEditorView } from "./activeView";
import type { CursorPos } from "./CodeMirrorEditor";

// Same reasoning as `baseExtensions.ts`: we own Ctrl/Cmd+F globally
// (DESIGN-SPEC Amendments item 5) — Rendered mode is also a real CM6 view,
// so the same owned-search wiring makes ⌘F open our panel here too instead
// of a second, competing binding.
const ownedSearchKeymap = searchKeymap.filter((k) => k.key !== "Mod-f" && k.key !== "Mod-Shift-f");

const markdownLanguage = markdown({ extensions: [TaskList, Strikethrough] });

export interface LivePreviewEditorProps {
  path: string;
  content: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (pos: CursorPos) => void;
  onOpenLink?: (href: string) => void;
}

export function LivePreviewEditor({ path, content, readOnly = false, onChange, onCursorChange, onOpenLink }: LivePreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    onOpenLinkRef.current = onOpenLink;
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      // No `highlightActiveLine()` here (unlike `baseExtensions.ts`'s
      // code-editor baseline) — a reading-column editor doesn't get the
      // code-editor "current line" background wash; it would visually
      // compete with the reveal/hide toggle this mode already draws
      // attention to, and doesn't appear anywhere in app-preview.png.
      EditorState.allowMultipleSelections.of(true),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...ownedSearchKeymap]),
      EditorView.lineWrapping,
      markdownLanguage,
      livePreviewExtensions({ onOpenLink: (href) => onOpenLinkRef.current?.(href) }),
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
    ];

    const state = EditorState.create({ doc: content, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    setActiveEditorView(view);

    return () => {
      if (viewRef.current === view) viewRef.current = null;
      if (getActiveEditorView() === view) setActiveEditorView(null);
      view.destroy();
    };
    // Scoped to `path` only, same rationale as `CodeMirrorEditor.tsx` —
    // this effect owns one EditorView's mount lifecycle per open file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

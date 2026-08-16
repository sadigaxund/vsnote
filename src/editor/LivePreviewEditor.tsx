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
 *
 * Phase 5a: reuses `baseExtensions.ts`'s shared `fontSizeCompartment` so
 * the Settings dialog's editor-font-size slider takes effect here too —
 * Rendered/`.md` is the default mode for the default boot tab
 * (app-preview.png), so it's the surface most settings verification
 * actually exercises. Word wrap is deliberately NOT wired to the settings
 * toggle (`EditorView.lineWrapping` stays unconditionally on, per the
 * class doc above: "a centered reading column always wraps, independent of
 * the wordWrap code-editor setting") — that's an existing Phase 4 design
 * decision, not a Phase 5a gap.
 *
 * The setting is applied as an OFFSET from `RENDERED_BASE_FONT_SIZE`
 * (`fontSize - DEFAULT_EDITOR_FONT_SIZE`), not as the raw pixel value —
 * `useSettingsStore`'s one `editorFontSize` field is shared with Source
 * mode's monospace 13px baseline (`baseExtensions.ts`), which is a much
 * smaller number than Rendered's carefully-tuned 17px prose size
 * (`livepreview/theme.ts`, matched to app-preview.png's typography). Wiring
 * the raw value straight through was tried first and is a real regression,
 * caught during Phase 5a verification: at the setting's own default (13) it
 * silently shrank every fresh boot's Rendered view from 17px to 13px,
 * visibly off-spec and (worse) enough to shift the live-preview reveal
 * decorations' pixel geometry — a scripted click at a coordinate computed
 * from the *current* (regressed) layout landed on the wrong line entirely
 * once compared line-for-line against the pre-Phase-5a build at the same
 * coordinates. The offset keeps the default (unconfigured) boot state
 * pixel-identical to Phase 4 while the slider still visibly scales the
 * Rendered view up/down by the same delta it applies to Source.
 *
 * Phase 6.5c (DESIGN-SPEC Amendments item 11, "Rendered view" category)
 * adds `renderedLayoutCompartment`: content column max-width (ch),
 * left/right margin (px), and line height (multiplier) — all three settings
 * DIRECT (not offset) values, unlike font size, since `livepreview/theme.ts`
 * never hardcoded a competing rule for any of them in the first place (see
 * that file's own doc) — no regression risk from a raw-value default the
 * way font size had.
 */
import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, TaskList } from "@lezer/markdown";
import { livePreviewExtensions } from "./livepreview";
import { fontSizeCompartment, fontSizeTheme } from "./baseExtensions";
import { createFindPanel } from "./findPanel";
import { getActiveEditorView, setActiveEditorView } from "./activeView";
import { useSettingsStore, DEFAULT_EDITOR_FONT_SIZE, RENDERED_CONTENT_WIDTH_FULL } from "../stores/useSettingsStore";
import type { CursorPos } from "./CodeMirrorEditor";

/** Matches `livepreview/theme.ts`'s own `"&": { fontSize: "17px" }` — the
 * one place that number is allowed to be "true," everything else derives
 * an offset from it (see the module doc above). */
const RENDERED_BASE_FONT_SIZE = 17;

function renderedFontSize(settingFontSize: number): number {
  return RENDERED_BASE_FONT_SIZE + (settingFontSize - DEFAULT_EDITOR_FONT_SIZE);
}

/** Phase 6.5c — see this file's module doc. Direct (non-offset) values:
 * content column max-width (ch), left/right margin (px, matching the
 * removed `"56px {margin}px 160px"` shape — top/bottom stay fixed), and
 * line height (a `.cm-scroller` multiplier). */
const renderedLayoutCompartment = new Compartment();

function renderedLayoutTheme(contentWidthCh: number, marginPx: number, lineSpacing: number) {
  // DESIGN-SPEC Amendments round 4 item 25: the slider's top position is
  // "Full" (`RENDERED_CONTENT_WIDTH_FULL`), not a ch value — remove the cap
  // entirely instead of clamping to some large number, so the reading
  // column genuinely spans the whole editor area on any monitor width.
  const maxWidth = contentWidthCh === RENDERED_CONTENT_WIDTH_FULL ? "none" : `${contentWidthCh}ch`;
  return EditorView.theme({
    ".cm-content": { maxWidth, padding: `56px ${marginPx}px 160px` },
    ".cm-scroller": { lineHeight: String(lineSpacing) },
  });
}

// Same reasoning as `baseExtensions.ts`: we own Ctrl/Cmd+F globally
// (DESIGN-SPEC Amendments item 5) — Rendered mode is also a real CM6 view,
// so the same owned-search wiring makes ⌘F open our panel here too instead
// of a second, competing binding.
const ownedSearchKeymap = searchKeymap.filter((k) => k.key !== "Mod-f" && k.key !== "Mod-Shift-f");

const markdownLanguage = markdown({ extensions: [TaskList, Strikethrough] });

export interface LivePreviewEditorProps {
  /** Which pane this instance belongs to — see `editor/activeView.ts`'s
   * module doc (Phase 6: one registered view per pane, not one global). */
  paneId: string;
  path: string;
  content: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (pos: CursorPos) => void;
  onOpenLink?: (href: string) => void;
}

export function LivePreviewEditor({ paneId, path, content, readOnly = false, onChange, onCursorChange, onOpenLink }: LivePreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // DESIGN-SPEC Amendments item 16 (typing-latency bug): the LAST content
  // string this editor itself emitted via `onChange` — lets the content-sync
  // effect below tell "this `content` prop update is just OUR OWN edit
  // echoing back through `useBufferStore`" apart from "content changed for
  // some OTHER reason (a second pane editing the same shared buffer, an
  // external discard/undo)". Diagnosed with a temporary before/after
  // profiling run (`lib/renderProbe.ts`'s doc + ARCHITECTURE.md's
  // Deviations entry): every keystroke was paying for TWO full-document
  // `doc.toString()` calls plus a full string-equality check on a large
  // document — one in the `updateListener` below (to hand the new content
  // to `onChange`), and a second, redundant one in the content-sync effect
  // immediately after, re-serializing the SAME doc just to confirm it
  // already matched what was just emitted. Skipping the second one
  // whenever `content` is recognizably our own echo cut measured
  // over-16ms-blocked keystrokes by roughly a third on a 1k-line document.
  const lastEmittedRef = useRef<string | null>(null);

  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    onOpenLinkRef.current = onOpenLink;
  });

  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const contentWidth = useSettingsStore((s) => s.renderedContentWidth);
  const margin = useSettingsStore((s) => s.renderedMargin);
  const lineSpacing = useSettingsStore((s) => s.renderedLineSpacing);

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
      // DESIGN-SPEC Amendments item 9 — see `editor/findPanel.ts`'s module
      // doc for why this keeps `.cm-searchMatch` highlighting fully native
      // while replacing the vanilla panel's DOM.
      search({ top: true, createPanel: createFindPanel }),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...ownedSearchKeymap]),
      EditorView.lineWrapping,
      markdownLanguage,
      livePreviewExtensions({ onOpenLink: (href) => onOpenLinkRef.current?.(href) }),
      // `Prec.highest` (not just array position — verified empirically:
      // placing this after `livePreviewExtensions` in the array alone did
      // NOT win the tie, CM6's `StyleModule` doesn't resolve identical-
      // specificity `&{...}` rules from two separate `EditorView.theme()`
      // calls by extension order the way a plain stylesheet would) so this
      // compartment's `fontSize` rule always beats `livePreviewTheme`'s own
      // hardcoded `&{fontSize: "17px"}` regardless of extension order.
      // Compartments keep whatever `Prec` wraps them across `.reconfigure()`
      // (CM6's documented pattern for dynamically-reconfigured content that
      // needs guaranteed precedence), so the Settings dialog's font-size
      // slider keeps working after every later reconfigure too.
      Prec.highest(fontSizeCompartment.of(fontSizeTheme(renderedFontSize(fontSize)))),
      renderedLayoutCompartment.of(renderedLayoutTheme(contentWidth, margin, lineSpacing)),
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !readOnly) {
          const value = update.state.doc.toString();
          lastEmittedRef.current = value;
          onChangeRef.current?.(value);
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
    setActiveEditorView(paneId, view);

    return () => {
      if (viewRef.current === view) viewRef.current = null;
      if (getActiveEditorView(paneId) === view) setActiveEditorView(paneId, null);
      view.destroy();
    };
    // Scoped to `path` only, same rationale as `CodeMirrorEditor.tsx` —
    // this effect owns one EditorView's mount lifecycle per open file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // This `content` update is our own last edit echoing back through
    // `useBufferStore` — the view already reflects it (we're the one who
    // produced it), so skip re-serializing the whole document just to
    // confirm that. See `lastEmittedRef`'s doc above.
    if (content === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(renderedFontSize(fontSize))) });
  }, [fontSize]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: renderedLayoutCompartment.reconfigure(renderedLayoutTheme(contentWidth, margin, lineSpacing)),
    });
  }, [contentWidth, margin, lineSpacing]);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

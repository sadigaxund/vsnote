/**
 * "Rendered" mode for `.md` files — the Obsidian-style live-preview editor
 * (DESIGN-SPEC "Markdown live preview ... non-negotiable"). As of 2026-08-21
 * the decoration engine itself is no longer hand-rolled: this wraps
 * **@atomic-editor/editor** (MIT, github.com/kenforthewin/atomic-editor),
 * the hardened CM6 live-preview component this repo's own `editor/livepreview/`
 * plugin was patterned after (see ARCHITECTURE.md's Deviations entry for the
 * full swap rationale — caret-geometry bugs in vertical motion across
 * hidden fence lines were the trigger).
 *
 * The contract with the rest of the app is UNCHANGED from the previous
 * hand-rolled version, so `EditorContent.tsx`, `ShareApp.tsx`,
 * `activeView.ts`, and the settings store all keep working untouched:
 *
 * - One real, editable CM6 `EditorView` per open file whose document is
 *   always raw markdown; rendered appearance is decorations only.
 *   atomic-editor remounts its view when `documentId` changes, mirroring
 *   this file's old mount-per-path pattern (`key={path}` upstream does the
 *   equivalent at the React layer).
 * - `onChange`/`onCursorChange`/`onOpenLink` keep their previous semantics:
 *   raw-markdown strings out, `{line, column}` (1-based) cursor reports,
 *   and RAW link hrefs handed to App.tsx's resolver
 *   (`editor/markdownLinks.ts`) exactly like the old LinkWidget did.
 * - The underlying view is captured through a tiny `ViewPlugin` passed via
 *   atomic-editor's documented `extensions` escape hatch, which keeps
 *   `activeView.ts`'s pane registration (⌘F, format actions) working and
 *   gives the external-content sync effect below the same `viewRef` access
 *   the hand-rolled version had.
 *
 * External content changes (second pane editing the same shared buffer, an
 * external discard) are applied as a full-document dispatch — NOT a remount
 * — with the same `lastEmittedRef` echo-suppression trick as before: the
 * last string THIS editor emitted via `onMarkdownChange` is recognized when
 * it echoes back through `useBufferStore`, skipping a redundant
 * `doc.toString()` + dispatch round-trip on every keystroke.
 *
 * Theming/settings: atomic-editor reads CSS custom properties, so VSNote's
 * DESIGN-SPEC look is restored by mapping tokens onto its variables on the
 * wrapper element (never forking library CSS): canvas/body/muted/accent
 * colors, sans/mono fonts, selection tint, transparent code background
 * (spec: fences sit flush on the editor surface), and the Settings-dialog
 * sliders — font size as the same 17px-based OFFSET as before
 * (`RENDERED_BASE_FONT_SIZE`), line spacing as `--atomic-editor-body-leading`,
 * content width as `--atomic-editor-measure`. The margin slider applies as
 * horizontal wrapper padding now (atomic-editor owns vertical rhythm via
 * line padding; see ARCHITECTURE.md's deviation note).
 *
 * ⌘F note: Rendered mode now uses atomic-editor's own find panel (its
 * `search()` extension ships one). App.tsx still owns the global Mod-f
 * handler and calls `openSearchPanel` on the registered view — that opens
 * the panel this view was configured with, i.e. atomic-editor's — instead
 * of Source/Diff mode's React `FindWidget`. Documented in ARCHITECTURE.md.
 */
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { EditorView, ViewPlugin, type PluginValue } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { closeSearchPanel } from "@codemirror/search";
import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import "./livepreview-theme.css";
import {
  getActiveEditorView,
  setActiveEditorView,
} from "./activeView";
import {
  useSettingsStore,
  DEFAULT_EDITOR_FONT_SIZE,
  RENDERED_CONTENT_WIDTH_FULL,
} from "../stores/useSettingsStore";
import type { CursorPos } from "./CodeMirrorEditor";

/** Matches the pre-swap `RENDERED_BASE_FONT_SIZE` (17px prose baseline) —
 * the Settings slider applies `(settingFontSize - DEFAULT_EDITOR_FONT_SIZE)`
 * as an offset around it, keeping the default boot state pixel-identical to
 * the hand-rolled implementation while still scaling both modes by the same
 * delta. */
const RENDERED_BASE_FONT_SIZE = 17;

function renderedFontSize(settingFontSize: number): number {
  return RENDERED_BASE_FONT_SIZE + (settingFontSize - DEFAULT_EDITOR_FONT_SIZE);
}

/** Fenced-code grammars for languages this vault actually contains, wired
 * through atomic-editor's lazy-loading `codeLanguages` (each grammar is
 * dynamically imported on first use by a matching fence — no cost until
 * then). Kept to packages already in `dependencies`; more can be added the
 * same way. */
const codeLanguages = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["javascript", "js", "jsx", "mjs", "cjs"],
    extensions: ["js", "jsx", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["typescript", "ts", "tsx"],
    extensions: ["ts", "tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "css",
    alias: ["css"],
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["html", "htm"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "json",
    alias: ["json"],
    extensions: ["json", "map"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
];

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

export function LivePreviewEditor({
  paneId,
  path,
  content,
  readOnly = false,
  onChange,
  onCursorChange,
  onOpenLink,
}: LivePreviewEditorProps) {
  // The underlying CM6 view, captured via the `CaptureView` plugin below
  // (atomic-editor's handle doesn't expose the view itself). Drives the
  // external-content sync effect; pane registration happens in the plugin
  // so ⌘F/format-actions resolve this pane's Rendered view like before.
  const viewRef = useRef<EditorView | null>(null);
  const handleRef = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  // The LAST content string this editor itself emitted — lets the sync
  // effect tell our own edit's echo apart from an external change (same
  // mechanism as the pre-swap implementation; see its notes in git history
  // and ARCHITECTURE.md).
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

  // Stable across the document's lifetime: atomic-editor captures the
  // `extensions` array once per `documentId`, so these are constructed once
  // per mount (paneId is fixed for a given mounted instance — upstream keys
  // the whole component by `path`).
  const extraExtensions = useMemo<Extension[]>(() => {
    let registered: EditorView | null = null;
    class CaptureView implements PluginValue {
      constructor(view: EditorView) {
        viewRef.current = view;
        registered = view;
        setActiveEditorView(paneId, view);
      }
      destroy() {
        if (viewRef.current === registered) viewRef.current = null;
        if (getActiveEditorView(paneId) === registered) setActiveEditorView(paneId, null);
      }
    }
    // Upstream gap workaround (fixed here, not forked): atomic-editor's
    // search panel doesn't bind Escape on its own DOM, so Esc while typing
    // in the find field did nothing (CM6's default panel closes; theirs
    // forgot the listener). Keydowns inside `.cm-panels` bubble through the
    // editor root, so one capture listener on `view.dom` closes the panel —
    // and only the panel — from anywhere inside it. (This can't be an
    // `EditorView.domEventHandlers` entry: those bind to the CONTENT dom,
    // which the panel is not part of.)
    class EscapeClosesPanel implements PluginValue {
      private readonly view: EditorView;
      private readonly handler = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".cm-panels")) return;
        event.preventDefault();
        closeSearchPanel(this.view);
      };
      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener("keydown", this.handler);
      }
      destroy() {
        this.view.dom.removeEventListener("keydown", this.handler);
      }
    }
    return [
      ViewPlugin.fromClass(CaptureView),
      ViewPlugin.fromClass(EscapeClosesPanel),
      // Same Ln/Col reporting contract as the pre-swap updateListener
      // (1-based column; fires on doc or selection changes).
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          onCursorChangeRef.current?.({ line: line.number, column: head - line.from + 1 });
        }
      }),
    ];
  }, [paneId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Our own last edit echoing back through `useBufferStore` — skip the
    // redundant re-serialize + dispatch (see `lastEmittedRef` above).
    if (content === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  // DESIGN-SPEC token mapping onto atomic-editor's CSS variables — restyle
  // at the variable layer only, never by overriding library rules (repo
  // rule 1). Recomputed per render; the vars cascade into the editor DOM.
  const wrapperStyle = {
    paddingInline: `${margin}px`,
    "--atomic-editor-font": "var(--font-sans)",
    "--atomic-editor-font-mono": "var(--font-mono)",
    "--atomic-editor-body-size": `${renderedFontSize(fontSize)}px`,
    "--atomic-editor-body-leading": String(lineSpacing),
    // Amendments round 4 item 25: "Full" removes the cap entirely rather
    // than clamping to a large ch value.
    "--atomic-editor-measure":
      contentWidth === RENDERED_CONTENT_WIDTH_FULL ? "none" : `${contentWidth}ch`,
    "--atomic-editor-fg": "var(--markdown-body)",
    "--atomic-editor-fg-muted": "var(--color-muted)",
    "--atomic-editor-accent": "var(--color-primary)",
    "--atomic-editor-accent-bright": "var(--color-primary)",
    "--atomic-editor-link": "var(--color-accent-text, var(--color-primary))",
    "--atomic-editor-selection-bg":
      "color-mix(in oklab, var(--color-primary) 25%, transparent)",
    // Spec correction: fenced code sits flush on the editor surface — no
    // raised panel behind it.
    "--atomic-editor-code-bg": "transparent",
    // Code token color follows the same `--syntax-string` role token Source
    // mode highlights with (Amendments round 3 item 22(b)).
    "--atomic-editor-hl-string": "var(--syntax-string)",
  } as CSSProperties;

  return (
    <div className="vsnote-live-preview" style={wrapperStyle} data-testid="live-preview-root">
      <AtomicCodeMirrorEditor
        documentId={path}
        markdownSource={content}
        readOnly={readOnly}
        codeLanguages={codeLanguages}
        extensions={extraExtensions}
        editorHandleRef={handleRef}
        onMarkdownChange={(md) => {
          lastEmittedRef.current = md;
          onChangeRef.current?.(md);
        }}
        onLinkClick={(url) => onOpenLinkRef.current?.(url)}
      />
    </div>
  );
}

/**
 * Diff mode — `@codemirror/merge` vs HEAD (IMPLEMENTATION-PLAN.md Phase 3:
 * "Diff mode via `@codemirror/merge` vs HEAD (unified + side-by-side
 * toggle)"). Both documents come straight from disk — `readHeadFileContent`
 * (HEAD, via `git/diff.ts`, the same call the chip/status bar use) and the
 * working-tree file as last saved — so the line counts this view renders
 * are the exact same computation behind the `+12 -5` chip, not a second
 * diff engine that could disagree with it.
 *
 * Split mode uses `MergeView` (two real `EditorView`s, left = HEAD, right =
 * working); unified mode uses `unifiedMergeView`, a single-editor extension
 * that renders deleted-line widgets inline above their replacement. Both
 * get word-level highlighting for free (`highlightChanges`, on by default)
 * per DESIGN-SPEC "Diff mode: ... with word-level highlights". Read-only —
 * accept/reject controls are switched off; Phase 3 is a viewer, not a
 * revert tool.
 *
 * This whole module is loaded lazily (`React.lazy` at the call site in
 * `EditorContent.tsx`) so `@codemirror/merge` only ever downloads once a
 * user actually opens Diff mode, keeping it out of the cold-boot bundle.
 *
 * The unified/split layout toggle used to live here as an in-content
 * `SegmentedControl` row; DESIGN-SPEC Amendments item 13 moved it into
 * `EditorHeader` (next to the Rendered/Source/Diff mode toggle, "same
 * visual language") as a compact icon-only control — `layout` is now owned
 * by `EditorPane.tsx` and passed down as a plain prop instead of local
 * state here.
 */
import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { readOnlyBaseExtensions } from "./baseExtensions";
import { editorExtensions } from "./theme";
import { getActiveEditorView, setActiveEditorView } from "./activeView";
import { readHeadFileContent } from "../git/diff";
import { pathExists, readTextFile } from "../fs/operations";
import { displayToFsPath } from "../fs/paths";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { DiffLayout } from "../types";

export interface DiffViewProps {
  /** Which pane this instance belongs to — threaded to `MergeViewport` for
   * `editor/activeView.ts` registration (Phase 6: per-pane, not global). */
  paneId: string;
  path: string;
  loadLanguage: () => Promise<Extension | null>;
  /** Unified vs. split presentation — owned by `EditorPane.tsx`, rendered
   * by `EditorHeader`'s icon-only `SegmentedControl` (DESIGN-SPEC
   * Amendments item 13). */
  layout: DiffLayout;
}

export function DiffView({ paneId, path, loadLanguage, layout }: DiffViewProps) {
  const [docs, setDocs] = useState<{ head: string; working: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fsPath = displayToFsPath(path);
      const [head, exists] = await Promise.all([readHeadFileContent(path), pathExists(fsPath)]);
      const working = exists ? await readTextFile(fsPath) : "";
      if (!cancelled) setDocs({ head: head ?? "", working });
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "var(--app-editor-bg)" }}>
        {docs && (
          <MergeViewport
            key={`${path}:${layout}`}
            paneId={paneId}
            layout={layout}
            head={docs.head}
            working={docs.working}
            loadLanguage={loadLanguage}
          />
        )}
      </div>
    </div>
  );
}

interface MergeViewportProps {
  paneId: string;
  layout: DiffLayout;
  head: string;
  working: string;
  loadLanguage: () => Promise<Extension | null>;
}

function MergeViewport({ paneId, layout, head, working, loadLanguage }: MergeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const lineSpacing = useSettingsStore((s) => s.editorLineSpacing);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let mergeView: MergeView | null = null;
    let unifiedView: EditorView | null = null;

    void loadLanguage().then((lang) => {
      if (destroyed || !containerRef.current) return;
      const shared: Extension[] = [
        ...readOnlyBaseExtensions({ wordWrap, fontSize, lineSpacing }),
        ...editorExtensions(),
        lang ?? [],
      ];

      if (layout === "split") {
        mergeView = new MergeView({
          a: { doc: head, extensions: shared },
          b: { doc: working, extensions: shared },
          parent: containerRef.current,
          orientation: "a-b",
          gutter: true,
          highlightChanges: true,
          collapseUnchanged: { margin: 3, minSize: 6 },
        });
        setActiveEditorView(paneId, mergeView.b);
      } else {
        unifiedView = new EditorView({
          state: EditorState.create({
            doc: working,
            extensions: [
              ...shared,
              unifiedMergeView({
                original: head,
                gutter: true,
                mergeControls: false,
                collapseUnchanged: { margin: 3, minSize: 6 },
              }),
            ],
          }),
          parent: containerRef.current,
        });
        setActiveEditorView(paneId, unifiedView);
      }
    });

    return () => {
      destroyed = true;
      const registered = getActiveEditorView(paneId);
      if (mergeView && registered === mergeView.b) setActiveEditorView(paneId, null);
      if (unifiedView && registered === unifiedView) setActiveEditorView(paneId, null);
      mergeView?.destroy();
      unifiedView?.destroy();
    };
    // `head`/`working`/`layout` all key the `MergeViewport` remount at the
    // call site already (see the `key={...}` in `DiffView`); `loadLanguage`
    // is a stable registry function reference. Re-running only on
    // `wordWrap`/`fontSize`/`lineSpacing` here would need reconfigure
    // plumbing that isn't worth it for a read-only view — those settings
    // simply apply on the next remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ height: "100%", overflow: "auto" }} />;
}

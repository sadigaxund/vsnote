/**
 * Editor content area — mode-aware:
 *  - **Rendered**: routed per-kind through `filetypes/registry.ts`'s
 *    `renderer` field (Phase 4, IMPLEMENTATION-PLAN.md's "renderer wiring +
 *    SegmentedControl logic"): `.md` gets the real Obsidian-style live-
 *    preview CM6 editor (`editor/LivePreviewEditor` — the centerpiece, see
 *    its module doc and `editor/livepreview/`), `.html` a sandboxed iframe,
 *    `.csv` a `DataTable`, `.json` a tree view, images the checkerboard
 *    viewer. Phase 1's static single-note placeholder is gone — every kind
 *    now renders its own real, per-file content.
 *  - **Source**: `editor/CodeMirrorEditor` (CM6) bound to the real file
 *    content via `useBufferStore`. A `D`-status tab has nothing on disk to
 *    edit, so it falls back to a read-only view of the last committed
 *    (HEAD) content instead of an empty box.
 *  - **Diff**: `editor/DiffView` — a real `@codemirror/merge` view vs HEAD
 *    (unified + split toggle), reading the exact same `git/diff.ts` data
 *    the chip/status bar use.
 *  - No open tab: an `EmptyState`.
 *
 * Every non-trivial surface (`CodeMirrorEditor`, `DiffView`,
 * `LivePreviewEditor`, and each `renderers/*`) is `React.lazy`-loaded: none
 * of CM6 core, `@codemirror/merge`, the live-preview plugin, or a renderer
 * lands in the app's cold-boot bundle until a tab actually needs it —
 * Rendered `.md` (this repo's most common file type and the boot-time
 * active tab) pays only for `LivePreviewEditor` + `@codemirror/lang-markdown`
 * + `@lezer/markdown`, never Source/Diff's extra chunks.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { EmptyState, Spinner } from "my-you-eye";
import { FileQuestion } from "lucide-react";
import type { DiffLayout, EditorMode, FileKind } from "../types";
import { readHeadFileContent, type FileDiffResult } from "../git/diff";
import { fileTypeForOrPlain } from "../filetypes/registry";
import type { CursorPos } from "../editor/CodeMirrorEditor";
import type { StoragePersistenceStatus } from "../fs/persistence";

const CodeMirrorEditor = lazy(() =>
  import("../editor/CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor })),
);
const DiffView = lazy(() => import("../editor/DiffView").then((m) => ({ default: m.DiffView })));
const LivePreviewEditor = lazy(() =>
  import("../editor/LivePreviewEditor").then((m) => ({ default: m.LivePreviewEditor })),
);
const HtmlPreview = lazy(() => import("../renderers/HtmlPreview").then((m) => ({ default: m.HtmlPreview })));
const CsvTable = lazy(() => import("../renderers/CsvTable").then((m) => ({ default: m.CsvTable })));
const JsonView = lazy(() => import("../renderers/JsonView").then((m) => ({ default: m.JsonView })));
const ImageView = lazy(() => import("../renderers/ImageView").then((m) => ({ default: m.ImageView })));
// Phase 6.5c (DESIGN-SPEC Amendments item 11) — the Settings VIEW. Lazy the
// same way as every renderer above: it's a tab a session may never open, and
// pulls in a real slice of the library (`Select`/`Slider`/`Switch`/
// `RadioGroup`/`Input`/`Button`/`DataList`/`Kbd`) that shouldn't cost the
// cold-boot bundle anything until someone actually clicks the gear.
const SettingsView = lazy(() => import("./SettingsView").then((m) => ({ default: m.SettingsView })));

export interface EditorContentProps {
  /** Which pane this content belongs to (Phase 6) — threaded to every CM6
   * mount site so `editor/activeView.ts` registers the right pane's view. */
  paneId: string;
  hasTab: boolean;
  path?: string;
  kind?: FileKind;
  mode: EditorMode;
  content: string;
  loaded: boolean;
  missing: boolean;
  onChange: (value: string) => void;
  diff: FileDiffResult;
  onCursorChange?: (pos: CursorPos) => void;
  onOpenLink?: (href: string) => void;
  /** Diff mode's unified/split toggle (DESIGN-SPEC Amendments item 13) —
   * owned by `EditorPane.tsx`, rendered by `EditorHeader`. */
  diffLayout?: DiffLayout;
  /** Threaded through to `SettingsView` for its Storage category — see
   * `EditorArea.tsx`'s doc. Unused for every other kind. */
  storagePersistence?: StoragePersistenceStatus;
  onExportVault?: () => void;
  onRequestResetVault?: () => void;
}

export function EditorContent({
  paneId,
  hasTab,
  path,
  kind,
  mode: modeProp,
  content,
  loaded,
  missing,
  onChange,
  diff,
  onCursorChange,
  onOpenLink,
  diffLayout = "split",
  storagePersistence,
  onExportVault,
  onRequestResetVault,
}: EditorContentProps) {
  const [headContent, setHeadContent] = useState("");
  useEffect(() => {
    if (missing && path) {
      let cancelled = false;
      readHeadFileContent(path).then((c) => {
        if (!cancelled) setHeadContent(c ?? "");
      });
      return () => {
        cancelled = true;
      };
    }
  }, [missing, path]);

  if (!hasTab) {
    return (
      <Centered>
        <EmptyState icon={<FileQuestion size={28} />} title="No file open" description="Select a file from the explorer to start editing." />
      </Centered>
    );
  }

  // Phase 6.5c (DESIGN-SPEC Amendments item 11) — the Settings tab ignores
  // mode/loaded/missing/diff entirely (it's not a file, `EditorPane.tsx`
  // hides the mode-toggle header for this kind, and the buffer/diff-fetch
  // effects are skipped there too), so this branch short-circuits before
  // any of the file-shaped logic below ever runs — same pattern as the
  // `!hasTab` early return just above.
  if (kind === "settings") {
    return (
      <Suspense fallback={<EditorLoading />}>
        <SettingsView
          storagePersistence={storagePersistence}
          onExportVault={onExportVault}
          onRequestResetVault={onRequestResetVault}
        />
      </Suspense>
    );
  }

  const fileType = fileTypeForOrPlain(kind);
  // Defensive normalization: images only ever have "rendered" available
  // (registry `baseModes: ["rendered"]`), but a tab persisted from before
  // this phase (localStorage `slate-tabs`) could still carry a stale
  // "source"/"diff" mode from when images had no renderer at all — clamp
  // rather than let a binary PNG hit the text CodeMirror/diff views.
  const mode = kind === "image" ? "rendered" : modeProp;

  if (mode === "diff") {
    if (!path) return null;
    return (
      <Suspense fallback={<EditorLoading />}>
        <DiffView key={path} paneId={paneId} path={path} loadLanguage={fileType.loadLanguage} layout={diffLayout} />
      </Suspense>
    );
  }

  if (mode === "rendered") {
    if (!path) return null;

    // Images are binary — their renderer reads bytes straight off the fs
    // by path, independent of the text-buffer machinery below.
    if (fileType.renderer === "image") {
      return (
        <Suspense fallback={<EditorLoading />}>
          <ImageView key={path} path={path} />
        </Suspense>
      );
    }

    if (!missing && !loaded) return <EditorLoading />;
    const displayContent = missing ? headContent : content;

    switch (fileType.renderer) {
      case "livepreview":
        return (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <MissingBanner missing={missing} />
            <div style={{ flex: 1, minHeight: 0 }}>
              <Suspense fallback={<EditorLoading />}>
                <LivePreviewEditor
                  key={path}
                  paneId={paneId}
                  path={path}
                  content={displayContent}
                  readOnly={missing}
                  onChange={missing ? undefined : onChange}
                  onCursorChange={onCursorChange}
                  onOpenLink={onOpenLink}
                />
              </Suspense>
            </div>
          </div>
        );
      case "html":
        return (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <MissingBanner missing={missing} />
            <Suspense fallback={<EditorLoading />}>
              <HtmlPreview key={path} content={displayContent} />
            </Suspense>
          </div>
        );
      case "csv":
        return (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <MissingBanner missing={missing} />
            <Suspense fallback={<EditorLoading />}>
              <CsvTable key={path} content={displayContent} />
            </Suspense>
          </div>
        );
      case "json":
        return (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <MissingBanner missing={missing} />
            <Suspense fallback={<EditorLoading />}>
              <JsonView key={path} content={displayContent} />
            </Suspense>
          </div>
        );
      default:
        // Rendered was offered without a registered renderer — shouldn't
        // happen (registry only lists "rendered" alongside a `renderer`),
        // but fail soft rather than blank.
        return (
          <Centered>
            <EmptyState icon={<FileQuestion size={28} />} title="No renderer" description="This file type has no Rendered view yet." />
          </Centered>
        );
    }
  }

  // Source mode.
  if (!missing && !loaded) {
    return <EditorLoading />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <MissingBanner missing={missing} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<EditorLoading />}>
          <CodeMirrorEditor
            key={path}
            paneId={paneId}
            path={path ?? ""}
            content={missing ? headContent : content}
            readOnly={missing}
            diff={diff}
            loadLanguage={fileType.loadLanguage}
            onChange={missing ? undefined : onChange}
            onCursorChange={onCursorChange}
          />
        </Suspense>
      </div>
    </div>
  );
}

function MissingBanner({ missing }: { missing: boolean }) {
  if (!missing) return null;
  return (
    <div
      style={{
        padding: "6px 16px",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        color: "var(--git-deleted)",
        borderBottom: "1px solid var(--app-chrome-border)",
        flexShrink: 0,
      }}
    >
      Deleted from the working tree. Showing the last committed version (read-only).
    </div>
  );
}

function EditorLoading() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, background: "var(--app-editor-bg)" }}>
      <Spinner size="sm" />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
      {children}
    </div>
  );
}

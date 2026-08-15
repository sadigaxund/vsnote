/**
 * Editor content area — mode-aware:
 *  - **Rendered**: unchanged from Phase 1 — the static `architecture.md`
 *    typography placeholder (DESIGN-SPEC "Rendered markdown typography"),
 *    shown for every `.md` tab regardless of which note is open. A real
 *    per-file Obsidian-style renderer is Phase 4's "Markdown live preview"
 *    centerpiece; building a second throwaway renderer now would fight
 *    that architecture rather than inform it.
 *  - **Source**: `editor/CodeMirrorEditor` (CM6) bound to the real file
 *    content via `useBufferStore` — replaces Phase 2's crude `Textarea`
 *    (IMPLEMENTATION-PLAN.md Phase 3). A `D`-status tab has nothing on disk
 *    to edit, so it falls back to a read-only view of the last committed
 *    (HEAD) content instead of an empty box, same as Phase 2.
 *  - **Diff**: `editor/DiffView` — a real `@codemirror/merge` view vs HEAD
 *    (unified + split toggle), reading the exact same `git/diff.ts` data
 *    the chip/status bar use.
 *  - No open tab, or an image (no `ImageView` until Phase 4): an
 *    `EmptyState`.
 *
 * `CodeMirrorEditor`/`DiffView` are both `React.lazy`-loaded: neither CM6
 * core nor `@codemirror/merge` land in the app's cold-boot bundle until a
 * tab is actually opened in Source or Diff mode (Rendered is the default
 * mode for `.md`, this repo's most common file type, so a plain "open the
 * app" boot often never pays for either chunk at all).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { EmptyState, ScrollArea, Spinner } from "my-you-eye";
import { FileQuestion, FileWarning } from "lucide-react";
import type { EditorMode, FileKind } from "../types";
import { readHeadFileContent, type FileDiffResult } from "../git/diff";
import { fileTypeForOrPlain } from "../filetypes/registry";
import type { CursorPos } from "../editor/CodeMirrorEditor";

const CodeMirrorEditor = lazy(() =>
  import("../editor/CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor })),
);
const DiffView = lazy(() => import("../editor/DiffView").then((m) => ({ default: m.DiffView })));

export interface EditorContentProps {
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
}

export function EditorContent({
  hasTab,
  path,
  kind,
  mode,
  content,
  loaded,
  missing,
  onChange,
  diff,
  onCursorChange,
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

  if (kind === "image") {
    return (
      <Centered>
        <EmptyState
          icon={<FileWarning size={28} />}
          title="No image preview yet"
          description="The image viewer (checkerboard, zoom-to-fit) lands in Phase 4. This file's git status and diff still work."
        />
      </Centered>
    );
  }

  if (mode === "rendered") {
    return <RenderedPlaceholder />;
  }

  const fileType = fileTypeForOrPlain(kind);

  if (mode === "diff") {
    if (!path) return null;
    return (
      <Suspense fallback={<EditorLoading />}>
        <DiffView key={path} path={path} loadLanguage={fileType.loadLanguage} />
      </Suspense>
    );
  }

  // Source mode.
  if (!missing && !loaded) {
    return <EditorLoading />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {missing && (
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
          Deleted from the working tree — showing the last committed version (read-only).
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<EditorLoading />}>
          <CodeMirrorEditor
            key={path}
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

/**
 * Unchanged from Phase 1 — see the module doc above for why this stays a
 * fixed placeholder rather than becoming per-file this phase.
 */
function RenderedPlaceholder() {
  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      <div
        style={{
          maxWidth: "54ch",
          margin: "0 auto",
          padding: "56px 32px 120px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--color-fg)",
            margin: "0 0 20px",
            letterSpacing: "-0.01em",
          }}
        >
          Indexing architecture
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", margin: "0 0 24px" }}>
          The vault indexer walks the file graph and emits a sparse adjacency list. See{" "}
          <a href="#indexer.ts" style={{ color: "var(--color-primary)", textDecoration: "underline" }}>
            indexer.ts
          </a>{" "}
          for the walker.
        </p>

        <h2
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: "var(--color-primary)",
            margin: "0 0 14px",
          }}
        >
          Constraints
        </h2>

        <ul style={{ margin: "0 0 24px", padding: 0, listStyle: "none" }}>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", marginBottom: 4 }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>
              Cold index of 50k notes under{" "}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 15,
                  color: "var(--markdown-code-color)",
                }}
              >
                900ms
              </code>
            </span>
          </li>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", marginBottom: 4 }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>
              Incremental updates are <strong style={{ color: "var(--color-fg)", fontWeight: 700 }}>append-only</strong>
            </span>
          </li>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)" }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>No blocking work on the render thread</span>
          </li>
        </ul>

        <blockquote
          style={{
            margin: "0 0 24px",
            padding: "2px 0 2px 16px",
            borderLeft: "3px solid var(--color-primary)",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--color-muted)",
          }}
        >
          Treat the index as a cache. Never as truth.
        </blockquote>

        <h2
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: "var(--color-primary)",
            margin: "0 0 14px",
          }}
        >
          Pipeline
        </h2>

        <pre
          style={{
            margin: 0,
            padding: "16px 0",
            background: "var(--app-editor-bg)",
            overflowX: "auto",
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              color: "var(--markdown-code-color)",
              whiteSpace: "pre",
            }}
          >
            walk(root) → parse() → link() → commit()
          </code>
        </pre>
      </div>
    </ScrollArea>
  );
}

/**
 * Editor content area — mode-aware this phase:
 *  - **Rendered**: Phase 1's static architecture.md typography placeholder
 *    (DESIGN-SPEC "Rendered markdown typography"), shown for every `.md`
 *    tab regardless of which note is open — a real per-file Obsidian-style
 *    renderer is Phase 4's "Markdown live preview" centerpiece; building a
 *    second throwaway renderer now would fight that architecture rather
 *    than inform it (see the placeholder's own file-header note, unchanged
 *    from Phase 1).
 *  - **Source**: a plain `Textarea` bound to the real file content via
 *    `useBufferStore` — IMPLEMENTATION-PLAN.md Phase 2 exit criteria calls
 *    this out explicitly ("edit (temp via a crude textarea is fine this
 *    phase)"); CodeMirror replaces it in Phase 3. A `D`-status tab has
 *    nothing on disk to edit, so it falls back to a read-only view of the
 *    last committed (HEAD) content instead of an empty box.
 *  - **Diff**: not a merge view yet (Phase 3) — but the real numbers
 *    (`git/diff.ts`, the same call the chip/status bar use) are surfaced
 *    via `EmptyState` so the data pipeline is visibly real, not a mock.
 *  - No open tab, or an image (no `ImageView` until Phase 4): an
 *    `EmptyState`.
 */
import { useEffect, useState } from "react";
import { EmptyState, ScrollArea, Textarea } from "my-you-eye";
import { FileQuestion, FileWarning, GitCompareArrows } from "lucide-react";
import type { EditorMode, FileKind } from "../types";
import { readHeadFileContent, type FileDiffResult } from "../git/diff";

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
}

export function EditorContent({ hasTab, path, kind, mode, content, loaded, missing, onChange, diff }: EditorContentProps) {
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

  if (mode === "diff") {
    return (
      <Centered>
        <EmptyState
          icon={<GitCompareArrows size={28} />}
          title="Diff view arrives in Phase 3"
          description={
            diff.added || diff.removed
              ? `Real computed diff vs HEAD: +${diff.added} / -${diff.removed} lines (git/diff.ts). The merge view renders these same lines in Phase 3.`
              : "No changes vs HEAD."
          }
        />
      </Centered>
    );
  }

  if (mode === "rendered") {
    return <RenderedPlaceholder />;
  }

  // Source mode.
  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      {missing ? (
        <div style={{ padding: 16 }}>
          <div
            style={{
              marginBottom: 10,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--git-deleted)",
            }}
          >
            Deleted from the working tree — showing the last committed version (read-only).
          </div>
          <Textarea readOnly value={headContent} spellCheck={false} style={textareaStyle} />
        </div>
      ) : (
        <div style={{ padding: 16, height: "100%" }}>
          <Textarea
            value={loaded ? content : "Loading…"}
            disabled={!loaded}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            style={textareaStyle}
          />
        </div>
      )}
    </ScrollArea>
  );
}

const textareaStyle = {
  width: "100%",
  minHeight: "calc(100vh - 260px)",
  resize: "vertical" as const,
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 1.6,
  background: "var(--app-editor-bg)",
  color: "var(--color-fg)",
  border: "1px solid var(--color-border)",
};

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

/**
 * `renderer: "code"` (R3-7, `filetypes/registry.ts`) — Rendered mode for
 * every code kind (`ts`/`tsx`/`js`/`jsx`/`css`): a READ-ONLY static
 * highlighted view built on `markdown/codeBlock.tsx`'s `<CodeBlock>` — the
 * SAME component the public share reader uses for a raw code file's Viewer
 * page (`share/ShareApp.tsx`'s `ReaderPage`), reusing its line numbers/
 * wrap-toggle/copy-button toolbar and its `filetypes/registry.ts`-backed
 * `@lezer/highlight` highlighting. Deliberately NOT a CodeMirror instance —
 * `EditorContent.tsx`'s Source mode already owns the one real, editable CM6
 * surface for this file; Rendered here is a second, cheaper, read-only look
 * at the same content (DESIGN-SPEC's Rendered/Source split), not a second
 * editor.
 *
 * Big-file cap (DESIGN-SPEC Amendments item 33's perf-cap convention, same
 * one `CodeBlock` itself already enforces via `CODE_BLOCK_MAX_LINES`): kept
 * at the share reader's default rather than raised or lifted. The DOM-node
 * math that cap protects against doesn't care who owns the file — a
 * 50,000-line generated file would blow up this view's `<pre>` exactly as
 * badly as a stranger's shared one. What DOES differ from the share reader
 * is the affordance once truncated: a visitor's ONLY way to read a shared
 * code file is this static view (raw mode is a download, not a read), so
 * the share reader's plain "Showing the first N of M lines" is all it can
 * say. Here, the file's owner is always one click away from Source mode —
 * the real CM6 editor, virtualized, never capped, and editable — so this
 * view's truncation notice says so via `CodeBlock`'s `truncatedHint` prop
 * instead of leaving the rest of a long file looking silently unreachable.
 */
import { EmptyState, ScrollArea } from "my-you-eye";
import { FileCode } from "lucide-react";
import { CodeBlock } from "../markdown/codeBlock";
import { CODE_BLOCK_MAX_LINES, capCodeLines } from "../markdown/codeBlockLogic";
import type { FileKind } from "../types";

export interface CodeViewProps {
  content: string;
  kind?: FileKind;
}

export function CodeView({ content, kind }: CodeViewProps) {
  if (content.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
        <EmptyState icon={<FileCode size={28} />} title="Empty file" description="This file has no content yet." />
      </div>
    );
  }

  const { truncated } = capCodeLines(content, CODE_BLOCK_MAX_LINES);

  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      {/* DESIGN-SPEC Amendments item 12: rendered content stays selectable
          even though the app-wide default is `user-select: none` — see
          `index.css`'s `[data-selectable-content]` rule (same opt-in
          `CsvTable`/`JsonView` already use). */}
      <div data-selectable-content style={{ padding: 20 }}>
        <CodeBlock
          code={content}
          kind={kind}
          truncatedHint={truncated ? " Switch to Source to see the rest of this file." : undefined}
        />
      </div>
    </ScrollArea>
  );
}

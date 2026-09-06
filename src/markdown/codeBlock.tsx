/**
 * Static, highlighted `<pre>` for a code FILE — the public share reader's
 * "raw code file, rendered" case (DESIGN-SPEC/docs/PLAN-2026-09-05-refresh.md
 * §4.3: "code files are a static highlighted `<pre>` with line numbers via
 * `@lezer/highlight highlightTree` on the already-loaded language") and
 * print/export's equivalent. NO CodeMirror editor instance — this is
 * read-only static output for a reader or a printed page, not an editing
 * surface.
 *
 * Scope note (see `docs/ARCHITECTURE.md`'s markdown-rendering-pipeline
 * section, "Markii upstream findings"): this component is NOT wired into
 * `src/markdown/render.tsx`'s fenced-code-block rendering — `@markii/react`'s
 * `renderMark`/`renderMarkNode` have no seam to override how a `<pre><code>`
 * hast element becomes a React element (only `resolveImageSrc` is
 * pluggable), so a fenced code block INSIDE a rendered markdown document
 * still prints as plain, unhighlighted text. This component is for a
 * standalone code FILE share/print, where the caller has full control over
 * what gets rendered.
 *
 * Highlighting: `@lezer/highlight`'s `highlightCode` (the "higher-level,
 * easier to use" sibling of `highlightTree` per its own doc comment) over
 * the Lezer parser behind whichever CM6 language `filetypes/registry.ts`
 * already loads for `kind` (dynamic `import()`, so this stays code-split
 * exactly like every other renderer) — `classHighlighter`'s `tok-*` classes
 * are mapped onto `theme.css`'s existing `--syntax-*` role tokens (the same
 * ones `editor/theme.ts`'s CM6 `HighlightStyle` uses), so static print/share
 * output matches the app's own Source-mode syntax colors instead of
 * inventing a second palette. The pure line-cap/highlight-building logic
 * lives in `codeBlockLogic.ts` (split out so this file's only export is the
 * component, per ESLint's `react-refresh/only-export-components`).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Language } from "@codemirror/language";
import { fileTypeForOrPlain } from "../filetypes/registry";
import type { FileKind } from "../types";
import { buildHighlightedLines, capCodeLines, CODE_BLOCK_MAX_LINES } from "./codeBlockLogic";

export interface CodeBlockProps {
  code: string;
  /** The file's `FileKind` (`src/types.ts`) — resolved to a CM6 language via `filetypes/registry.ts`'s existing `loadLanguage`, so this component never duplicates that table. Omitted/unrecognized kinds degrade to plain, correctly-escaped text. */
  kind?: FileKind;
  maxLines?: number;
}

/** Static highlighted `<pre>` with line numbers. Degrades to plain escaped text for an unknown/unsupported language (no `language.parser` resolved), and never chokes on a very large file (see `capCodeLines`/`CODE_BLOCK_MAX_LINES`). */
export function CodeBlock({ code, kind, maxLines = CODE_BLOCK_MAX_LINES }: CodeBlockProps): ReactNode {
  const capped = capCodeLines(code, maxLines);
  const [language, setLanguage] = useState<Language | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fileTypeForOrPlain(kind)
      .loadLanguage()
      .then((extension) => {
        if (cancelled) return;
        const lang = (extension as { language?: Language } | null)?.language;
        setLanguage(lang);
      })
      .catch(() => {
        if (!cancelled) setLanguage(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const lines = buildHighlightedLines(capped.code, language);
  const lineNumberWidth = String(lines.length).length;

  return (
    <pre className="mk-static-codeblock">
      <code>
        {lines.map((spans, index) => (
          <span className="mk-static-codeblock__line" key={index}>
            <span className="mk-static-codeblock__lineno" aria-hidden="true" style={{ minWidth: `${lineNumberWidth}ch` }}>
              {index + 1}
            </span>
            <span className="mk-static-codeblock__text">
              {spans.length === 0
                ? " "
                : spans.map((span, spanIndex) =>
                    span.classes ? (
                      <span key={spanIndex} className={span.classes}>
                        {span.text}
                      </span>
                    ) : (
                      span.text
                    ),
                  )}
            </span>
          </span>
        ))}
      </code>
      {capped.truncated && (
        <div className="mk-static-codeblock__truncated">
          Showing the first {maxLines.toLocaleString()} of {capped.totalLines.toLocaleString()} lines.
        </div>
      )}
    </pre>
  );
}

/**
 * Pure, React-free logic behind `codeBlock.tsx`'s `<CodeBlock>` — split
 * into its own module so that file's only export is the component
 * (ESLint's `react-refresh/only-export-components`, same reasoning
 * `printDocument.tsx`'s own doc comment gives for its split from
 * `printExport.tsx`). Also lets these functions be unit-tested directly
 * (`tests/unit/markdownCodeBlock.test.ts`) without rendering anything.
 */
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Language } from "@codemirror/language";

/** DESIGN-SPEC item 33's perf-cap convention (see
 * `tests/unit/rendererBigFileCaps.test.ts`) applied to static code output:
 * an unbounded file could otherwise put tens of thousands of `<span>`
 * elements into a print/share DOM. 5,000 lines comfortably covers every
 * real source file while keeping worst-case output bounded. */
export const CODE_BLOCK_MAX_LINES = 5000;

export interface CapCodeLinesResult {
  /** The (possibly truncated) code text — always a whole-line prefix of the input, never a mid-line cut. */
  code: string;
  totalLines: number;
  truncated: boolean;
}

/** R5-4 — the trailing path segment of `path` (everything after the last
 * `/`, or `path` itself when there is none). Used to name a downloaded
 * file from a full vault-relative path (`renderers/CodeView.tsx`'s
 * download handler); mirrors `share/ShareApp.tsx`'s own private `baseName`
 * verbatim so the two agree on what "the filename" means. */
export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Pure line cap — a whole-line prefix of `code`, never a mid-line cut. */
export function capCodeLines(code: string, maxLines: number = CODE_BLOCK_MAX_LINES): CapCodeLinesResult {
  const lines = code.split("\n");
  if (lines.length <= maxLines) {
    return { code, totalLines: lines.length, truncated: false };
  }
  return { code: lines.slice(0, maxLines).join("\n"), totalLines: lines.length, truncated: true };
}

export interface StyledSpan {
  text: string;
  classes: string;
}

/** One line's styled spans, built via `highlightCode`'s `putText`/`putBreak` callbacks. Falls back to one unstyled span per line (still correctly-escaped — React text children are never raw HTML) when there is no `language` (unknown/unsupported file type). */
export function buildHighlightedLines(code: string, language: Language | undefined): StyledSpan[][] {
  // An empty line becomes `[]`, not a one-element array holding an
  // empty-string span — matching the highlighted path below, where
  // `highlightCode` never calls `putText` for a blank line (only
  // `putBreak`), so both paths agree on "no spans" for a blank line.
  const toPlainLines = () => code.split("\n").map((line) => (line.length > 0 ? [{ text: line, classes: "" }] : []));
  if (!language) {
    return toPlainLines();
  }
  let tree;
  try {
    tree = language.parser.parse(code);
  } catch {
    return toPlainLines();
  }

  const lines: StyledSpan[][] = [[]];
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part.length > 0) lines[lines.length - 1]!.push({ text: part, classes });
      });
    },
    () => lines.push([]),
  );
  return lines;
}

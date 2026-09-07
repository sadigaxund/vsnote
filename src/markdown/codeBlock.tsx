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
 *
 * Toolbar (R3-7, revised for the header-row fix): ONE compact 32px header
 * row above the `<pre>` — `filename` (mono, muted) on the left when a
 * caller passes it, a wrap toggle + copy button (both `my-you-eye` `Button`
 * `size="icon-sm" variant="ghost"`) on the right, sharing the block's own
 * background/border tokens. `wrap` is a simple optional CONTROLLED prop —
 * the public share reader's visitor reading-preferences pill (
 * `ReaderPrefsPill`/`readerPrefs.ts`) and this header's own wrap toggle are
 * the SAME single source of truth: a controlled caller must also pass
 * `onWrapChange` so the header toggle mutates the SAME state the pill
 * reads, rather than the two silently disagreeing (or the header toggle
 * doing nothing at all, the original bug — only copy rendered). When
 * `wrap`/`onWrapChange` are both omitted, an internal toggle with local
 * `useState` takes over (`renderers/CodeView.tsx`'s editor-owned
 * Rendered-mode view, and any other caller that never passes the prop).
 * The copy button reads `navigator.clipboard` at render/click time and
 * simply doesn't render at all when the API is unavailable (an insecure
 * context, an old browser, a locked-down embed) rather than offering a
 * button that would silently fail — "degrade gracefully" per the API's own
 * contract, not a try/catch band-aid around a control nobody can use. The
 * `.mk-static-codeblock__lineno` gutter is unselectable both via
 * `theme.css`'s existing rule AND an inline `userSelect: "none"` here (this
 * component's own guarantee, not one borrowed from a stylesheet a caller
 * might render it without) — so dragging a selection across a highlighted
 * line to copy it never drags the line number along too.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Language } from "@codemirror/language";
import { Check, Copy, WrapText } from "lucide-react";
import { Button } from "my-you-eye";
import { fileTypeForOrPlain } from "../filetypes/registry";
import type { FileKind } from "../types";
import { buildHighlightedLines, capCodeLines, CODE_BLOCK_MAX_LINES } from "./codeBlockLogic";

export interface CodeBlockProps {
  code: string;
  /** The file's `FileKind` (`src/types.ts`) — resolved to a CM6 language via `filetypes/registry.ts`'s existing `loadLanguage`, so this component never duplicates that table. Omitted/unrecognized kinds degrade to plain, correctly-escaped text. */
  kind?: FileKind;
  /** R3-9: the file's actual name/path, passed through to `loadLanguage` — required for `kind === "code"` (the generic fallback: one `FileKind` covers every `@codemirror/language-data` language, so the real language can only be picked by filename, e.g. `foo.py` -> Python). Every hand-written kind ignores it; omitted for a directive-rendered fence (`vsnoteCodeDirective.tsx`, which has no real filename — only a fence info-string language already mapped to a hand-written kind or `undefined`). */
  path?: string;
  maxLines?: number;
  /** Controlled wrap state — see the module doc's "Toolbar" section. Omit to let the component manage its own (starts unwrapped, matching `theme.css`'s un-scoped `.mk-static-codeblock` default). */
  wrap?: boolean;
  /** Required alongside a controlled `wrap` for the header's own wrap toggle to do anything — R3-defect fix: the public reader's `ReaderPrefsPill` and this component's header toggle must be the SAME single source of truth (`prefs.codeWrap`), not two independent switches, so a controlled caller wires this straight to its own setter instead of the toggle silently doing nothing. Ignored when `wrap` is omitted (the internal `localWrap` toggle handles itself). */
  onWrapChange?: (next: boolean) => void;
  /** Extra text appended after the built-in "Showing the first N of M lines" notice — e.g. an editor-owned view can point at its own uncapped Source mode, which the public share reader (no such affordance) leaves unset. */
  truncatedHint?: ReactNode;
  /** The file's name/path, shown left of the toolbar in one compact 32px header row (filename mono/muted, wrap+copy icon buttons right) — the public share reader's code-file panel passes this instead of rendering its own separate filename row, so filename and toolbar are ONE row, not two. Omitted callers (e.g. `CodeView.tsx`'s app-side Rendered mode, already inside its own chrome) get the toolbar alone, right-aligned, as before. */
  filename?: string;
}

function clipboardAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
}

/** Static highlighted `<pre>` with line numbers. Degrades to plain escaped text for an unknown/unsupported language (no `language.parser` resolved), and never chokes on a very large file (see `capCodeLines`/`CODE_BLOCK_MAX_LINES`). */
export function CodeBlock({
  code,
  kind,
  path,
  maxLines = CODE_BLOCK_MAX_LINES,
  wrap: wrapProp,
  onWrapChange,
  truncatedHint,
  filename,
}: CodeBlockProps): ReactNode {
  const capped = capCodeLines(code, maxLines);
  const [language, setLanguage] = useState<Language | undefined>(undefined);
  const [localWrap, setLocalWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapControlled = wrapProp !== undefined;
  const wrap = wrapControlled ? wrapProp : localWrap;
  const canToggleWrap = !wrapControlled || onWrapChange !== undefined;
  function toggleWrap() {
    if (wrapControlled) {
      onWrapChange?.(!wrap);
    } else {
      setLocalWrap((w) => !w);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fileTypeForOrPlain(kind)
      .loadLanguage(path)
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
  }, [kind, path]);

  // Reset the transient "copied" glyph if the underlying code changes out
  // from under a still-mounted block (e.g. the file being shown reloads).
  // Same "adjust state during render, not in an effect" snapshot pattern
  // `PublishDialog.tsx`'s `lastRenderMode` uses (`react-hooks/refs` blocks
  // reading/writing a ref during render, and this avoids the
  // `react-hooks/set-state-in-effect` cascading-render warning entirely
  // rather than suppressing it).
  const [lastCode, setLastCode] = useState(code);
  if (lastCode !== code) {
    setLastCode(code);
    if (copied) setCopied(false);
  }

  async function handleCopy() {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) return;
    try {
      await clipboard.writeText(capped.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Permission denied, or the API vanished between the availability
      // check and the click — fail silently, never a crash or a stuck
      // "copied" state.
    }
  }

  const lines = buildHighlightedLines(capped.code, language);
  const lineNumberWidth = String(lines.length).length;
  const canCopy = clipboardAvailable();
  const showToolbar = canToggleWrap || canCopy;

  return (
    <div>
      {(filename || showToolbar) && (
        <div
          className="mk-static-codeblock__header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: filename ? "space-between" : "flex-end",
            gap: 6,
            height: 32,
            padding: "0 8px",
          }}
        >
          {filename && <span className="mk-static-codeblock__filename">{filename}</span>}
          {showToolbar && (
            <div className="mk-static-codeblock__toolbar" style={{ display: "flex", gap: 4 }}>
              {canToggleWrap && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={toggleWrap}
                  aria-pressed={wrap}
                  aria-label={wrap ? "Disable line wrap" : "Enable line wrap"}
                  title={wrap ? "Disable line wrap" : "Enable line wrap"}
                >
                  <WrapText size={14} aria-hidden />
                </Button>
              )}
              {canCopy && (
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => void handleCopy()} aria-label="Copy code" title="Copy code">
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <pre className="mk-static-codeblock" style={wrap ? { overflowX: "hidden" } : undefined}>
        <code>
          {lines.map((spans, index) => (
            <span className="mk-static-codeblock__line" key={index}>
              <span
                className="mk-static-codeblock__lineno"
                aria-hidden="true"
                style={{ minWidth: `${lineNumberWidth}ch`, userSelect: "none" }}
              >
                {index + 1}
              </span>
              <span className="mk-static-codeblock__text" style={wrap ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } : undefined}>
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
            {truncatedHint}
          </div>
        )}
      </pre>
    </div>
  );
}

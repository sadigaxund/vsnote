/**
 * Pure predicates for markii's directive grammar (docs/PLAN-2026-09-05-refresh.md
 * §6 Phase M2), lifted STRAIGHT from `@markii/core`'s own implementation so
 * the CM6-side recognizer degrades exactly the same way the real mdast
 * parser (`@markii/core`'s `parse.js`) does. No CM6/Lezer types here on
 * purpose — this file is the "could this be `@markii/core`'s own export"
 * half of the Phase M2 deliverable (see this package's README-equivalent,
 * `src/markdown/directiveLezer/index.ts`, and the Markii upstream findings
 * in `docs/ARCHITECTURE.md`'s markdown pipeline section).
 *
 * ---- Why these regexes are copied, not imported ----
 * `@markii/core@0.13.0` does not export `isRecognizedTextDirective`,
 * `STARTS_WITH_LETTER`, or `IS_WORD_CHARACTER` — `parse.js`'s
 * `demoteInvalidTextDirectives` keeps them module-private (verified against
 * `node_modules/@markii/core/dist/parse.js`). A CM6 recognizer needs the
 * exact same "is this colon a directive" answer BEFORE any mdast tree
 * exists (Lezer parses raw text, not a parsed AST), so the only faithful
 * option today is copying the two regexes verbatim. The upstream ask (see
 * ARCHITECTURE.md) is to export this predicate as
 * `isRecognizedTextDirective(name, colonOffset, source)` so a downstream
 * `@markii/codemirror` package can import it instead of re-deriving it by
 * hand and risking drift from the mdast parser's own behavior.
 */

/** ASCII letter check for a directive name's first character (`kbd`, not `34`). Verbatim copy of `@markii/core`'s `STARTS_WITH_LETTER`. */
const STARTS_WITH_LETTER = /^[A-Za-z]/;

/** ASCII letter-or-digit check for the character immediately before a candidate inline directive's colon. Verbatim copy of `@markii/core`'s `IS_WORD_CHARACTER`. */
const IS_WORD_CHARACTER = /[A-Za-z0-9]/;

/**
 * The inline (text) directive "word start" rule: recognized only when the
 * name starts with an ASCII letter AND the colon sits at a word start —
 * either offset 0 of the paragraph (no preceding character at all, in this
 * inline run) or immediately preceded by something other than an ASCII
 * letter/digit. `12:34`, `a:b`, and `word:kbd[x]` fail this test (colon
 * preceded by a digit/letter, or name doesn't start with a letter);
 * `**:badge[x]**` and a paragraph-initial `:kbd[x]` pass it.
 *
 * @param name Directive name as written after the colon (before `[`/`{`).
 * @param hasPrecedingChar Whether there is a character before the colon
 *   within the current inline run (false at the very start of a paragraph's
 *   inline content — the CM6 analogue of `@markii/core`'s `colonOffset === 0`
 *   document-start special case; a paragraph is always itself preceded by a
 *   line break or nothing, both non-word characters, so treating "start of
 *   this inline run" as an unconditional pass is behaviorally identical).
 * @param precedingChar The character immediately before the colon, when
 *   `hasPrecedingChar` is true. Ignored otherwise.
 */
export function isRecognizedInlineDirectiveStart(
  name: string,
  hasPrecedingChar: boolean,
  precedingChar: string,
): boolean {
  if (!STARTS_WITH_LETTER.test(name)) return false;
  if (!hasPrecedingChar) return true;
  return !IS_WORD_CHARACTER.test(precedingChar);
}

/** Directive name syntax shared by all three forms: an ASCII letter followed by letters, digits, `_`, or `-`. */
export const DIRECTIVE_NAME_SOURCE = "[A-Za-z][A-Za-z0-9_-]*";

/** `:name[label]{attrs}` — label and attrs both optional, neither spans a newline. Label brackets are not nesting-aware (matches `@markii/core`'s own micromark-based grammar, which does not support a `]` inside a text directive's label either). */
export const INLINE_DIRECTIVE_RE = new RegExp(
  `^:(${DIRECTIVE_NAME_SOURCE})(\\[[^\\]\\n]*\\])?(\\{[^}\\n]*\\})?`,
);

/** `::name{attrs}` at line start, nothing else on the line. */
export const LEAF_DIRECTIVE_RE = new RegExp(`^::(${DIRECTIVE_NAME_SOURCE})(\\{[^}\\n]*\\})?[ \\t]*$`);

/** `:::name{attrs}` (three or more colons) opening a container, at line start, nothing else on the line. Captures the colon run so the caller can compare nesting depth. */
export const CONTAINER_OPEN_RE = new RegExp(`^(:{3,})(${DIRECTIVE_NAME_SOURCE})(\\{[^}\\n]*\\})?[ \\t]*$`);

/** A line that is nothing but 3+ colons (a candidate closing fence for some open container). */
export const CONTAINER_CLOSE_RE = /^:{3,}$/;

/** A line that looks like a nested container's opening fence, for the purposes of the colon-count nesting scan below (name required, same as `CONTAINER_OPEN_RE`, but attrs/trailing text don't matter to the scan). */
export const NESTED_OPEN_RE = new RegExp(`^(:{3,})${DIRECTIVE_NAME_SOURCE}`);

/** A fenced code block delimiter line (backtick or tilde, 3+), trimmed. Content between two fences never contains directive syntax (spec: "directives never parse inside code fences"), so the container-close scan below must track fence state and ignore colon runs while "inside" one. */
export const CODE_FENCE_RE = /^(`{3,}|~{3,})/;

export interface ContainerScanResult {
  /** Document offset of the character right after the closing fence line (i.e. the end of that line, exclusive of its trailing newline). */
  end: number;
}

/**
 * Scans forward from `searchText` (everything in the document strictly
 * after the opening fence's own line) for the line that closes a container
 * opened with `openColons` colons, honoring:
 *   - nesting: a nested open is only valid when its colon run is STRICTLY
 *     FEWER colons than whatever it's nested inside (spec: "the OUTER fence
 *     must use strictly more colons than the inner"). A run that fails this
 *     (equal or more) is not treated as an open at all — it's just content,
 *     exactly like an ordinary line of text — so the enclosing container
 *     keeps scanning past it for ITS OWN close.
 *   - fenced code: colon-only/near-colon lines inside a ``` or ~~~ fence are
 *     never treated as directive syntax.
 *   - unterminated fences: if no matching close is found before `searchText`
 *     ends, this returns `null` — the caller must then decline to recognize
 *     the container at all (spec: "degrades to plain text, never an error").
 *
 * Returns a document offset (relative to `searchStart`, the absolute offset
 * of the first character of `searchText`) for the end of the match, or
 * `null` if unterminated.
 *
 * Known limitation (documented rather than silently wrong): indented code
 * blocks (4-space, no fence) are not tracked here, so a colon-only line
 * inside one could incorrectly be read as a closing fence. Fenced code (the
 * overwhelmingly common case, and the only one the spec calls out
 * explicitly) is handled correctly. See this file's Markii-upstream-findings
 * writeup in `docs/ARCHITECTURE.md` for why a full block-level tokenizer
 * wasn't justified for this scan (see module doc).
 */
export function scanForContainerClose(
  searchText: string,
  searchStart: number,
  openColons: number,
): ContainerScanResult | null {
  const stack: number[] = [openColons];
  let pos = searchStart;
  let codeFence: string | null = null;
  const lines = searchText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (codeFence !== null) {
      if (trimmed.startsWith(codeFence) && /^(`+|~+)\s*$/.test(trimmed)) codeFence = null;
    } else {
      const fenceMatch = CODE_FENCE_RE.exec(trimmed);
      if (fenceMatch) {
        codeFence = fenceMatch[1];
      } else if (CONTAINER_CLOSE_RE.test(trimmed)) {
        const colons = trimmed.length;
        const top = stack[stack.length - 1];
        if (colons >= top) {
          stack.pop();
          if (stack.length === 0) {
            return { end: pos + rawLine.length };
          }
        }
      } else {
        const nestedOpen = NESTED_OPEN_RE.exec(trimmed);
        if (nestedOpen) {
          const nestedColons = nestedOpen[1].length;
          if (nestedColons < stack[stack.length - 1]) stack.push(nestedColons);
          // else: insufficient nesting — not a recognized open, left as
          // ordinary content, the enclosing container keeps scanning.
        }
      }
    }
    pos += rawLine.length + 1; // +1 for the "\n" `split` consumed (harmless overshoot past EOF on the final line — nothing reads `pos` after the loop ends).
  }
  return null;
}

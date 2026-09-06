/**
 * A Lezer `MarkdownExtension` (docs/PLAN-2026-09-05-refresh.md §6 Phase M2,
 * deliverable 1) recognizing markii's three directive forms — inline
 * `:name[label]{attrs}`, leaf block `::name{attrs}`, and container block
 * `:::name{attrs} ... :::` — against `@lezer/markdown`'s parser, the same
 * one `@codemirror/lang-markdown` (and this repo's `.md`/`.mk.md` CM6
 * language extensions) already depend on.
 *
 * This module and `grammar.ts` have NO import from VSNote application
 * state, no app-shell coupling, and depend only on `@lezer/markdown` (a
 * dependency this repo already has) — deliberately so this pair could be
 * lifted out verbatim as the parser half of a standalone `@markii/codemirror`
 * package, per the plan's "contribute upstream to markii as
 * `@markii/codemirror` if it stabilizes." See `docs/ARCHITECTURE.md`'s
 * markdown pipeline section for the full Markii-upstream-findings writeup
 * (what's missing upstream, what this file had to build instead, and the
 * shape a real `@markii/codemirror` package should take).
 *
 * ---- Why this tree only records SPANS, not full directive structure ----
 * Nothing downstream needs a faithfully nested Lezer tree for a directive's
 * *contents* — `decorations.ts`'s widgets render a directive by re-parsing
 * its raw source slice with `@markii/core`'s own `parse` (via
 * `@markii/react`'s `renderMarkNode`), which already produces the correct
 * mdast tree (including arbitrarily nested containers, inline directives
 * inside container content, etc.) using the exact same grammar rules as
 * the rest of the app. This Lezer extension's only job is: find where each
 * top-level directive STARTS and ENDS in the live document, cheaply and
 * incrementally, so `decorations.ts` knows what span to hide/reveal — it is
 * a "where", not a "what". That is why `MkDirectiveContainer`'s children
 * are not recursively parsed as nested markdown blocks (see below), and why
 * a container's own scan for its closing fence (`scanForContainerClose`)
 * doesn't bother producing nodes for anything nested inside it either.
 *
 * ---- Container blocks: an eager, non-composite block parser ----
 * `@lezer/markdown`'s designed mechanism for a multi-line block whose
 * INTERIOR should still be parsed as ordinary nested markdown (paragraphs,
 * headings, even other block types) is the "composite block" pattern
 * (`NodeSpec.composite`, `BlockContext.startComposite`) that `Blockquote`
 * and list items use. That mechanism assumes a marker present on EVERY
 * line of the block (blockquote's `>`, a list item's indent) which
 * `composite()` strips line by line. A markii container fence has no such
 * per-line marker — only its opening and closing lines carry syntax — so
 * the composite mechanism doesn't fit, and per the "spans only" reasoning
 * above there's no need for it anyway: this uses a single eager `parse()`
 * (the same style `FencedCode` itself uses) that decides, on the opening
 * line, exactly where the container ends, then fast-forwards past it in
 * one go.
 *
 * That decision needs to look at every line up to the close BEFORE
 * committing (an unterminated fence must decline entirely and leave the
 * document unmodified — "degrades to plain text, never an error" — and a
 * block parser that returns `false` must not have consumed anything).
 * `BlockContext`'s PUBLIC API only exposes one line of lookahead
 * (`peekLine()`); multi-line lookahead has no supported entry point.
 * `BlockContext` does carry the underlying `Input` as a plain instance
 * property (`cx.input`, confirmed empirically against
 * `@lezer/markdown@1.7.2` — see this repo's Markii-upstream-findings
 * writeup) with a `.read(from, to)` method, which is exactly what's
 * needed; it just isn't declared in the package's public `.d.ts`. This
 * file accesses it through a narrow local interface (`ReadableInput`)
 * rather than `as any`, so a future @lezer/markdown release that stops
 * exposing it fails loudly (a type error) instead of silently. The
 * upstream ask (see ARCHITECTURE.md) is either to expose `BlockContext`'s
 * `input` field publicly, or add a dedicated `peekAhead(to: number): string`
 * method for exactly this "does this eager block terminate before EOF"
 * check.
 */
import type { BlockContext, InlineContext, Line, MarkdownExtension } from "@lezer/markdown";
import {
  CONTAINER_OPEN_RE,
  INLINE_DIRECTIVE_RE,
  LEAF_DIRECTIVE_RE,
  isRecognizedInlineDirectiveStart,
  scanForContainerClose,
} from "./grammar";

/** Node names this extension defines. Exported so `decorations.ts` (and tests) don't hardcode string literals independently. */
export const MK_DIRECTIVE_CONTAINER = "MkDirectiveContainer";
export const MK_DIRECTIVE_LEAF = "MkDirectiveLeaf";
export const MK_DIRECTIVE_TEXT = "MkDirectiveText";

/** See this file's module doc: `cx.input`/`cx.to` are real runtime properties of `BlockContext` (verified against the installed `@lezer/markdown` version) that just aren't part of its public `.d.ts` (both are declared `private` there, which is also why this can't be expressed as `BlockContext & {...}` — TypeScript rejects intersecting a type with a private member). Narrowed to only what's used here, read via a standalone shape rather than `as any`. */
interface ReadableInput {
  read(from: number, to: number): string;
}
interface InternalBlockContextBits {
  input: ReadableInput;
  to: number;
}

function readInternalBits(cx: BlockContext): InternalBlockContextBits | null {
  const bits = cx as unknown as { input?: unknown; to?: unknown };
  if (typeof bits.input !== "object" || bits.input === null) return null;
  if (typeof (bits.input as ReadableInput).read !== "function") return null;
  if (typeof bits.to !== "number") return null;
  return bits as unknown as InternalBlockContextBits;
}

/**
 * `::name{attrs}` — single line, line-start only (i.e. whatever's left
 * after any composite-context markup this line already had stripped, per
 * the existing `line.pos`/`line.basePos` convention every other block
 * parser in `@lezer/markdown` follows).
 */
function parseLeafDirective(cx: BlockContext, line: Line): boolean {
  const text = line.text.slice(line.pos);
  if (!LEAF_DIRECTIVE_RE.test(text)) return false;
  const from = cx.lineStart + line.pos;
  const to = cx.lineStart + line.text.length;
  cx.nextLine();
  cx.addElement(cx.elt(MK_DIRECTIVE_LEAF, from, to));
  return true;
}

/**
 * `:::name{attrs}` ... `:::` — see the module doc's "eager, non-composite
 * block parser" section for why this reads ahead via `cx.input` rather
 * than using `startComposite`/`cx.nextLine()` speculatively.
 */
function parseContainerDirective(cx: BlockContext, line: Line): boolean {
  const text = line.text.slice(line.pos);
  const openMatch = CONTAINER_OPEN_RE.exec(text);
  if (!openMatch) return false;
  const openColons = openMatch[1].length;
  const from = cx.lineStart + line.pos;
  const afterOpenLine = cx.lineStart + line.text.length;

  const bits = readInternalBits(cx);
  if (bits === null) return false; // see module doc — degrade gracefully rather than crash if a future @lezer/markdown release removes this.
  if (afterOpenLine >= bits.to) return false; // opening fence is the last line in the document — nothing left to close it.
  const rest = bits.input.read(afterOpenLine + 1, bits.to);
  const scan = scanForContainerClose(rest, afterOpenLine + 1, openColons);
  if (scan === null) return false; // unterminated — decline entirely, the opening line falls through to ordinary paragraph parsing.

  // Safe to commit now: advance line by line (required — `BlockContext`
  // has no "jump to offset" primitive) up to and including the close line.
  while (cx.lineStart < scan.end) {
    if (!cx.nextLine()) break;
  }
  cx.addElement(cx.elt(MK_DIRECTIVE_CONTAINER, from, scan.end));
  return true;
}

/** `:name[label]{attrs}` inline text directive — see `grammar.ts`'s `isRecognizedInlineDirectiveStart` for the word-start rule this enforces. */
function parseInlineDirective(cx: InlineContext, next: number, pos: number): number {
  if (next !== 58 /* ':' */) return -1;
  const rel = pos - cx.offset;
  const hasPrecedingChar = rel > 0;
  const precedingChar = hasPrecedingChar ? cx.text[rel - 1] : "";
  const m = INLINE_DIRECTIVE_RE.exec(cx.text.slice(rel));
  if (!m) return -1;
  if (!isRecognizedInlineDirectiveStart(m[1], hasPrecedingChar, precedingChar)) return -1;
  const end = pos + m[0].length;
  cx.addElement(cx.elt(MK_DIRECTIVE_TEXT, pos, end));
  return end;
}

/**
 * The exported `MarkdownExtension`. Pass this to `@codemirror/lang-markdown`'s
 * `markdown({ extensions: [markiiDirectiveGrammar] })` (or fold into any
 * other `@lezer/markdown` parser's `.configure()`).
 */
export const markiiDirectiveGrammar: MarkdownExtension = {
  defineNodes: [
    { name: MK_DIRECTIVE_CONTAINER, block: true },
    { name: MK_DIRECTIVE_LEAF, block: true },
    { name: MK_DIRECTIVE_TEXT },
  ],
  parseBlock: [
    { name: MK_DIRECTIVE_CONTAINER, parse: parseContainerDirective },
    { name: MK_DIRECTIVE_LEAF, parse: parseLeafDirective },
  ],
  parseInline: [{ name: MK_DIRECTIVE_TEXT, parse: parseInlineDirective }],
};

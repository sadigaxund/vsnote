/**
 * Vendored from markii-org/markii (MIT license), pinned to v0.13.0:
 * packages/markii-host/src/fences/container-fences.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/fences/container-fences.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. Copied verbatim (no
 * dependencies to trim — this module imports nothing). Re-fetch from
 * upstream on version bumps rather than hand-editing.
 *
 * Original file header:
 * Fence auto-extension on insert (editor quality of life, format
 * untouched): the pure logic behind "the outer fence pair grows when a
 * container is inserted inside another container".
 *
 * docs/format.md gives container directives a fence rule borrowed from
 * fenced code: nesting works only when the OUTER pair carries more colons
 * than the inner one, e.g. `::::center` around `:::narrow`. Written by
 * hand that is a chore, and getting it wrong renders the note wrong. Both
 * hosts therefore lengthen the enclosing fences for the author, in exactly
 * two places: the Insert Component command, and accepting a container
 * component from the completion popup. Never while typing.
 */

/** A container-directive fence pair enclosing an insertion point. */
export interface EnclosingContainerFence {
  /** Zero-based line of the opening fence, always strictly above the insertion line. */
  readonly openLine: number;
  /** Zero-based line of the closing fence, always strictly below the insertion line. */
  readonly closeLine: number;
  /** How many colons the pair is written with today (the same count on both lines). */
  readonly colonCount: number;
  /** Zero-based column of the first colon on the opening line. */
  readonly openColumn: number;
  /** Zero-based column of the first colon on the closing line. */
  readonly closeColumn: number;
  /** The directive name on the opening fence, e.g. `center`. */
  readonly directiveName: string;
}

/**
 * One fence line to rewrite, as data rather than an editor edit: a host
 * turns it into whatever its own API takes, and applies the whole set in
 * ONE undoable edit together with the insertion itself.
 */
export interface FenceLineEdit {
  /** Zero-based line to edit. */
  readonly line: number;
  /** Zero-based column where the colon run starts. */
  readonly column: number;
  /** The colon run as it stands today, e.g. `:::`. */
  readonly oldText: string;
  /** The lengthened colon run to put in its place, e.g. `::::`. */
  readonly newText: string;
}

const DIRECTIVE_FENCE_RE = /^( {0,3})(:{3,})(.*)$/;
const DIRECTIVE_NAME_RE = /^[A-Za-z0-9_-]+/;
const CODE_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  readonly line: number;
  readonly column: number;
  readonly colonCount: number;
  readonly directiveName: string;
}

interface CloseFence {
  readonly line: number;
  readonly column: number;
  readonly colonCount: number;
}

type ClassifiedFence =
  | { readonly kind: "open"; readonly fence: OpenFence }
  | { readonly kind: "close"; readonly fence: CloseFence }
  /** A `:::` run this module refuses to reason about, e.g. `:::{type=info}` with no name. */
  | { readonly kind: "ambiguous" };

function classifyFenceLine(text: string, line: number): ClassifiedFence | undefined {
  const match = DIRECTIVE_FENCE_RE.exec(text);
  if (!match) return undefined;

  const indent = match[1] ?? "";
  const colons = match[2] ?? "";
  const rest = match[3] ?? "";
  const column = indent.length;

  if (rest.trim() === "") {
    return {
      kind: "close",
      fence: { line, column, colonCount: colons.length },
    };
  }

  const nameMatch = DIRECTIVE_NAME_RE.exec(rest);
  if (!nameMatch) return { kind: "ambiguous" };

  return {
    kind: "open",
    fence: {
      line,
      column,
      colonCount: colons.length,
      directiveName: nameMatch[0],
    },
  };
}

interface CodeFenceState {
  readonly char: string;
  readonly length: number;
}

function stepCodeFence(
  state: CodeFenceState | undefined,
  text: string,
): { readonly state: CodeFenceState | undefined; readonly isCode: boolean } {
  const match = CODE_FENCE_RE.exec(text);

  if (state === undefined) {
    if (!match) return { state: undefined, isCode: false };
    const run = match[2] ?? "";
    const info = match[3] ?? "";
    if (run.startsWith("`") && info.includes("`")) {
      return { state: undefined, isCode: false };
    }
    return { state: { char: run[0] ?? "`", length: run.length }, isCode: true };
  }

  if (match) {
    const run = match[2] ?? "";
    const info = match[3] ?? "";
    const closes = run[0] === state.char && run.length >= state.length && info.trim() === "";
    if (closes) return { state: undefined, isCode: true };
  }
  return { state, isCode: true };
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * The container-directive fence pairs enclosing `insertionLine`, outermost
 * first, or `undefined` for "do not touch". See upstream's original
 * doc comment (this file's header link) for the full pairing rules.
 */
export function enclosingContainerFences(
  documentText: string,
  insertionLine: number,
): readonly EnclosingContainerFence[] | undefined {
  if (typeof documentText !== "string") return undefined;
  if (!Number.isInteger(insertionLine) || insertionLine < 0) return undefined;

  const lines = documentText.split("\n");
  const stack: OpenFence[] = [];
  const pairs: EnclosingContainerFence[] = [];
  let codeFence: CodeFenceState | undefined;

  for (let line = 0; line < lines.length; line++) {
    const text = stripCarriageReturn(lines[line] ?? "");

    const stepped = stepCodeFence(codeFence, text);
    codeFence = stepped.state;
    if (stepped.isCode) continue;

    if (line === insertionLine) continue;

    const classified = classifyFenceLine(text, line);
    if (classified === undefined) continue;
    if (classified.kind === "ambiguous") return undefined;

    if (classified.kind === "open") {
      const parent = stack[stack.length - 1];
      if (parent && classified.fence.colonCount >= parent.colonCount) {
        return undefined;
      }
      stack.push(classified.fence);
      continue;
    }

    const opener = stack.pop();
    if (!opener) return undefined;
    if (opener.colonCount !== classified.fence.colonCount) return undefined;
    pairs.push({
      openLine: opener.line,
      closeLine: classified.fence.line,
      colonCount: opener.colonCount,
      openColumn: opener.column,
      closeColumn: classified.fence.column,
      directiveName: opener.directiveName,
    });
  }

  if (stack.length > 0) return undefined;
  if (codeFence !== undefined) return undefined;

  return pairs
    .filter((pair) => pair.openLine < insertionLine && pair.closeLine > insertionLine)
    .sort((a, b) => a.openLine - b.openLine);
}

/**
 * How many colons a piece of about-to-be-inserted text opens a container
 * with, or `undefined` when it is not a container skeleton at all.
 */
export function insertedContainerColonCount(insertedText: string): number | undefined {
  if (typeof insertedText !== "string") return undefined;
  const match = /^(:{3,})[A-Za-z0-9_-]/.exec(insertedText);
  if (!match) return undefined;
  const run = match[1] ?? "";
  return insertedText.endsWith(`\n${run}`) ? run.length : undefined;
}

/**
 * The minimal set of fence lines to lengthen so that inserting
 * `insertedText` at `insertionLine` still nests legally, or an empty array
 * when there is nothing to do.
 */
export function fenceExtensionEdits(
  documentText: string,
  insertionLine: number,
  insertedText: string,
): readonly FenceLineEdit[] {
  const insertedColons = insertedContainerColonCount(insertedText);
  if (insertedColons === undefined) return [];

  const enclosing = enclosingContainerFences(documentText, insertionLine);
  if (enclosing === undefined || enclosing.length === 0) return [];

  const edits: FenceLineEdit[] = [];
  let deepestInside = insertedColons;

  for (let i = enclosing.length - 1; i >= 0; i--) {
    const pair = enclosing[i];
    if (!pair) continue;
    const nextCount = Math.max(pair.colonCount, deepestInside + 1);
    if (nextCount !== pair.colonCount) {
      const oldText = ":".repeat(pair.colonCount);
      const newText = ":".repeat(nextCount);
      edits.push({
        line: pair.openLine,
        column: pair.openColumn,
        oldText,
        newText,
      });
      edits.push({
        line: pair.closeLine,
        column: pair.closeColumn,
        oldText,
        newText,
      });
    }
    deepestInside = nextCount;
  }

  return edits.sort((a, b) => a.line - b.line);
}

/**
 * The "vsnote-code" directive's shared plumbing — split into its own
 * (component-free) module so `vsnoteCodeDirective.tsx` can export ONLY the
 * component (ESLint's `react-refresh/only-export-components`).
 *
 * See `render.tsx`'s header for the full design: a fenced code block is
 * NOT natively highlightable through `@markii/react`'s `renderMark`/
 * `renderMarkNode` (no component-override hook for a plain `<pre><code>`
 * hast element — Markii upstream finding #1). Worked around the same way
 * the link-map rewrite works around markii's missing `resolveHref`: before
 * rendering, every mdast `code` node is rewritten into a synthetic
 * `leafDirective` node named `vsnote-code`, whose registered component
 * (`vsnoteCodeDirective.tsx`'s `VSNoteCodeBlock`) renders `codeBlock.tsx`'s
 * `<CodeBlock>` — the SAME highlighter this app already built for
 * standalone code-file shares.
 *
 * The code body itself is NEVER serialized into the directive's
 * `data-mk-attrs` JSON attribute string — a long or attribute-hostile fence
 * body (unbalanced quotes, control characters) has no business round-
 * tripping through a directive's attribute grammar just to reach its own
 * component. Instead each render call builds a small side table (this
 * module's `CodeTableEntry[]`) and the directive attribute carries only
 * that entry's INDEX (`{idx: "0"}`); the table itself is threaded to the
 * component via `CodeTableContext`, not props, since a directive
 * component's only inputs are its own attributes/children
 * (`MarkComponentProps`).
 */
import { createContext } from "react";
import type { FileKind } from "../types";

/** The directive name a rewritten `code` mdast node becomes. Namespaced (`vsnote-`) so it can never collide with a real markii standard component or a future pack's directive name. */
export const VSNOTE_CODE_DIRECTIVE_NAME = "vsnote-code";

export interface CodeTableEntry {
  code: string;
  /** The fence's info-string language (e.g. `"ts"`), as written — `undefined` for a fence with none. */
  lang?: string;
}

/** One render call's code-fence side table, provided by `render.tsx`'s `renderMarkdown` around its output tree. Empty array default so a component rendered outside that provider (e.g. a unit test) degrades to "no entry found" rather than throwing. */
export const CodeTableContext = createContext<readonly CodeTableEntry[]>([]);

/** Fence info-string language names (as commonly written in markdown, lowercased) -> `filetypes/registry.ts`'s `FileKind`. Deliberately small: only the kinds VSNote's own registry has a CM6 language for. Anything else (python, rust, go, an unrecognized alias, or no language at all) returns `undefined`, and `codeBlock.tsx`'s `CodeBlock` already degrades an unrecognized kind to plain, correctly-escaped text — never a crash, never mis-highlighted output. */
const LANG_ALIASES: Record<string, FileKind> = {
  js: "js",
  javascript: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  json: "json",
  json5: "json",
  css: "css",
  html: "html",
  htm: "html",
  csv: "csv",
  md: "md",
  markdown: "md",
};

export function langToFileKind(lang: string | undefined): FileKind | undefined {
  if (!lang) return undefined;
  return LANG_ALIASES[lang.trim().toLowerCase()];
}

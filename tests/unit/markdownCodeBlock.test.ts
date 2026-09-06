/**
 * `src/markdown/codeBlock.tsx`'s pure pieces — DESIGN-SPEC item 33's
 * perf-cap convention (see `tests/unit/rendererBigFileCaps.test.ts`)
 * applied to static code output, plus the highlighter's degrade-to-plain-
 * text behavior for an unknown language. `CodeBlock` itself (the React
 * component) is exercised via `renderToStaticMarkup` in
 * `markdownRender.test.ts`-style node rendering is unnecessary here since
 * `capCodeLines`/`buildHighlightedLines` are already plain, exported
 * functions — testing them directly keeps this suite fast and DOM-free.
 */
import { describe, expect, it } from "vitest";
import { javascript } from "@codemirror/lang-javascript";
import { buildHighlightedLines, capCodeLines, CODE_BLOCK_MAX_LINES } from "../../src/markdown/codeBlockLogic";

describe("capCodeLines", () => {
  it("leaves a small file untouched (no cap, no truncation flag)", () => {
    const code = "a\nb\nc";
    const result = capCodeLines(code, 100);
    expect(result).toEqual({ code, totalLines: 3, truncated: false });
  });

  it("caps a huge file to at most maxLines, on a whole-line boundary", () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const code = lines.join("\n");
    const result = capCodeLines(code, CODE_BLOCK_MAX_LINES);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(20000);
    expect(result.code.split("\n").length).toBe(CODE_BLOCK_MAX_LINES);
    expect(result.code.split("\n")).toEqual(lines.slice(0, CODE_BLOCK_MAX_LINES));
  });

  it("is exact at the boundary (exactly maxLines lines is not truncated)", () => {
    const code = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
    const result = capCodeLines(code, 10);
    expect(result.truncated).toBe(false);
  });
});

describe("buildHighlightedLines (degrade to plain text for an unknown language)", () => {
  it("degrades to one unstyled span per line when language is undefined", () => {
    const lines = buildHighlightedLines("a\nb\n", undefined);
    expect(lines).toEqual([[{ text: "a", classes: "" }], [{ text: "b", classes: "" }], []]);
  });

  it("never chokes on a very large plain-text input", () => {
    const code = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const lines = buildHighlightedLines(code, undefined);
    expect(lines.length).toBe(5000);
  });
});

describe("buildHighlightedLines (real syntax highlighting via @lezer/highlight, print/share regression fix)", () => {
  it("produces a tok-keyword span for a recognized keyword, given a real CM6 language", () => {
    const language = javascript().language;
    const lines = buildHighlightedLines("const x = 1;", language);
    expect(lines.length).toBe(1);
    const keywordSpan = lines[0]!.find((span) => span.text === "const");
    expect(keywordSpan).toBeDefined();
    expect(keywordSpan!.classes).toContain("tok-keyword");
  });

  it("still reconstructs the exact original text across all spans on a line", () => {
    const language = javascript().language;
    const code = "const x: number = 1;";
    const lines = buildHighlightedLines(code, language);
    expect(lines[0]!.map((span) => span.text).join("")).toBe(code);
  });
});

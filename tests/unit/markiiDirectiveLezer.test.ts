/**
 * Unit tests for `src/markdown/directiveLezer` (docs/PLAN-2026-09-05-refresh.md
 * §6 Phase M2) — the word-start rule for inline directives is the subtle
 * part (mirrors `@markii/core`'s `demoteInvalidTextDirectives`, see
 * `grammar.ts`'s module doc), plus the three block forms and their
 * degrade-to-text edge cases. Runs the REAL `@lezer/markdown` parser
 * configured with `markiiDirectiveGrammar`, not a hand-rolled substitute —
 * this is the only way to be sure the extension actually plugs into
 * `@lezer/markdown`'s block/inline dispatch correctly.
 */
import { describe, expect, it } from "vitest";
import { parser as baseMarkdownParser } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  MK_DIRECTIVE_CONTAINER,
  MK_DIRECTIVE_LEAF,
  MK_DIRECTIVE_TEXT,
  markiiDirectiveGrammar,
} from "../../src/markdown/directiveLezer/extension";
import { isRecognizedInlineDirectiveStart } from "../../src/markdown/directiveLezer/grammar";

const parser = baseMarkdownParser.configure(markiiDirectiveGrammar);

function parse(text: string): Tree {
  return parser.parse(text);
}

function nodesOfType(tree: Tree, name: string): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name === name) {
      out.push({ from: cursor.from, to: cursor.to, text: "" });
    }
  } while (cursor.next());
  return out;
}

function textNodesOfType(text: string, tree: Tree, name: string) {
  return nodesOfType(tree, name).map((n) => ({ ...n, text: text.slice(n.from, n.to) }));
}

describe("isRecognizedInlineDirectiveStart (word-start rule)", () => {
  it("rejects a name that doesn't start with a letter", () => {
    expect(isRecognizedInlineDirectiveStart("34", true, " ")).toBe(false);
  });
  it("rejects when preceded by a letter or digit", () => {
    expect(isRecognizedInlineDirectiveStart("b", true, "a")).toBe(false); // a:b
    expect(isRecognizedInlineDirectiveStart("kbd", true, "d")).toBe(false); // word:kbd[x]
    expect(isRecognizedInlineDirectiveStart("34", true, "2")).toBe(false); // 12:34 (also fails the letter-start test)
  });
  it("accepts when preceded by punctuation", () => {
    expect(isRecognizedInlineDirectiveStart("badge", true, "*")).toBe(true); // **:badge[x]**
  });
  it("accepts at the start of the paragraph (no preceding character)", () => {
    expect(isRecognizedInlineDirectiveStart("kbd", false, "")).toBe(true);
  });
});

describe("inline text directive :name[label]{attrs}", () => {
  it("does NOT recognize 12:34 as a directive", () => {
    const tree = parse("Meet at 12:34 pm sharp.");
    expect(nodesOfType(tree, MK_DIRECTIVE_TEXT)).toHaveLength(0);
  });
  it("does NOT recognize a:b as a directive", () => {
    const tree = parse("a ratio of a:b here.");
    expect(nodesOfType(tree, MK_DIRECTIVE_TEXT)).toHaveLength(0);
  });
  it("does NOT recognize word:kbd[x] as a directive (letter precedes colon)", () => {
    const tree = parse("word:kbd[x] in prose.");
    expect(nodesOfType(tree, MK_DIRECTIVE_TEXT)).toHaveLength(0);
  });
  it("recognizes **:badge[x]** (colon preceded by *)", () => {
    const text = "**:badge[x]**";
    const tree = parse(text);
    const found = textNodesOfType(text, tree, MK_DIRECTIVE_TEXT);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(":badge[x]");
  });
  it("recognizes a paragraph-initial :kbd[x]", () => {
    const text = ":kbd[x] at the start of a line.";
    const tree = parse(text);
    const found = textNodesOfType(text, tree, MK_DIRECTIVE_TEXT);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(":kbd[x]");
  });
  it("does not parse inside a fenced code block", () => {
    const text = "```\n:kbd[x]\n```\n";
    const tree = parse(text);
    expect(nodesOfType(tree, MK_DIRECTIVE_TEXT)).toHaveLength(0);
  });
});

describe("leaf block directive ::name{attrs}", () => {
  it("recognizes a bare leaf directive line", () => {
    const text = "::divider{}\n";
    const tree = parse(text);
    const found = textNodesOfType(text, tree, MK_DIRECTIVE_LEAF);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("::divider{}");
  });
});

describe("container block directive :::name{attrs} ... :::", () => {
  it("recognizes a simple unnested container", () => {
    const text = ":::center\nhello\n:::\n";
    const tree = parse(text);
    const found = textNodesOfType(text, tree, MK_DIRECTIVE_CONTAINER);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(":::center\nhello\n:::");
  });

  it("recognizes correct nesting (outer strictly more colons than inner)", () => {
    const text = "::::center\n:::narrow\ninside\n:::\n::::\n";
    const tree = parse(text);
    const outer = textNodesOfType(text, tree, MK_DIRECTIVE_CONTAINER);
    // The outer eager scan doesn't emit a separate node for the nested
    // container (see extension.ts's module doc — spans only), but it must
    // still correctly find the OUTER close past the nested one.
    expect(outer).toHaveLength(1);
    expect(outer[0].text).toBe(text.trimEnd());
  });

  it("degrades on insufficient nesting (inner fence has >= colons than outer)", () => {
    // The inner ":::inner" has the SAME colon count as the outer, so per
    // spec it is not a valid nested open — it's just content, and the
    // outer container still needs its own ":::" to close.
    const text = ":::outer\n:::inner\nstuff\n:::\n:::\n";
    const tree = parse(text);
    const outer = textNodesOfType(text, tree, MK_DIRECTIVE_CONTAINER);
    expect(outer).toHaveLength(1);
    // The outer closes at the FIRST ":::" line at or above its own depth
    // once the (unrecognized) inner attempt is skipped as content — i.e.
    // the one right after "stuff".
    expect(outer[0].text).toBe(":::outer\n:::inner\nstuff\n:::");
  });

  it("degrades an unterminated container to plain text (no MkDirectiveContainer node)", () => {
    const text = ":::center\nhello, no closing fence\n";
    const tree = parse(text);
    expect(nodesOfType(tree, MK_DIRECTIVE_CONTAINER)).toHaveLength(0);
  });

  it("does not treat a directive-like line inside a code fence as closing/opening", () => {
    const text = ":::center\n```\n:::\n```\nhello\n:::\n";
    const tree = parse(text);
    const found = textNodesOfType(text, tree, MK_DIRECTIVE_CONTAINER);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(text.trimEnd());
  });
});

function firstNode(tree: Tree, name: string): SyntaxNode | null {
  const cursor = tree.cursor();
  do {
    if (cursor.name === name) return cursor.node;
  } while (cursor.next());
  return null;
}

describe("sanity: node presence doesn't require a match at every call site", () => {
  it("plain prose has no directive nodes at all", () => {
    const tree = parse("Just an ordinary paragraph with no directives in it.");
    expect(firstNode(tree, MK_DIRECTIVE_TEXT)).toBeNull();
    expect(firstNode(tree, MK_DIRECTIVE_LEAF)).toBeNull();
    expect(firstNode(tree, MK_DIRECTIVE_CONTAINER)).toBeNull();
  });
});

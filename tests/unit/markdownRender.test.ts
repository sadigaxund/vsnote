/**
 * `src/markdown/render.tsx` — the one static markdown renderer
 * (docs/PLAN-2026-09-05-refresh.md §6 Phase M1). Uses `react-dom/server`'s
 * `renderToStaticMarkup` (pure server-side rendering, no DOM required) so
 * this suite stays in `vitest.config.ts`'s node environment like every
 * other test here, per that file's own doc ("nothing under test renders
 * React" — this is the one exception, and it renders to a STRING, never a
 * live DOM, so the doc's spirit — no jsdom, no browser API dependency —
 * still holds).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAndRewriteLinks, renderMarkdown } from "../../src/markdown/render";

describe("parseAndRewriteLinks", () => {
  it("rewrites a link that resolves in the map to the mapped URL", () => {
    const root = parseAndRewriteLinks("[next](./part-2.md)", { links: { "./part-2.md": "/share/part-2" } });
    const paragraph = root.children[0] as { children: { type: string; url?: string }[] };
    expect(paragraph.children[0]).toMatchObject({ type: "link", url: "/share/part-2" });
  });

  it("degrades an unresolved relative .md link to a title-carrying, href-less sentinel", () => {
    const root = parseAndRewriteLinks("[missing](./nope.md)", { links: {} });
    const paragraph = root.children[0] as { children: { type: string; url?: string; title?: string | null }[] };
    const link = paragraph.children[0]!;
    expect(link.type).toBe("link");
    expect(link.title).toBe("Not shared");
    expect(link.url).toMatch(/^mk-unresolved:/);
  });

  it("leaves an absolute/external link untouched", () => {
    const root = parseAndRewriteLinks("[ex](https://example.com/x)", { links: {} });
    const paragraph = root.children[0] as { children: { type: string; url?: string }[] };
    expect(paragraph.children[0]).toMatchObject({ type: "link", url: "https://example.com/x" });
  });

  it("does not degrade a relative non-.md link (e.g. an image sibling path)", () => {
    const root = parseAndRewriteLinks("[img](./cover.png)", { links: {} });
    const paragraph = root.children[0] as { children: { type: string; url?: string; title?: string | null }[] };
    expect(paragraph.children[0]).toMatchObject({ type: "link", url: "./cover.png" });
  });

  it("respects degradeUnresolvedRelativeLinks: false (print/export has no link map at all)", () => {
    const root = parseAndRewriteLinks("[sibling](./other.md)", { degradeUnresolvedRelativeLinks: false });
    const paragraph = root.children[0] as { children: { type: string; url?: string }[] };
    expect(paragraph.children[0]).toMatchObject({ type: "link", url: "./other.md" });
  });

  it("degrades a raw unsafe URL (not our sentinel) to plain text", () => {
    const root = parseAndRewriteLinks("[click](javascript:alert(1))", { links: {} });
    const paragraph = root.children[0] as { children: { type: string; value?: string }[] };
    expect(paragraph.children[0]!.type).toBe("text");
  });
});

describe("renderMarkdown", () => {
  it("renders a resolved link as a real, clickable anchor", () => {
    const html = renderToStaticMarkup(renderMarkdown("[next](./part-2.md)", { links: { "./part-2.md": "/share/part-2" } }));
    expect(html).toContain('href="/share/part-2"');
  });

  it("renders an unresolved relative .md link with a title but no href (non-clickable)", () => {
    const html = renderToStaticMarkup(renderMarkdown("[missing](./nope.md)"));
    expect(html).toContain('title="Not shared"');
    expect(html).not.toMatch(/<a[^>]*href=/);
  });

  it("is directive-aware for plain .md too (the point of the extension): :kbd[Ctrl] renders a <kbd>", () => {
    const html = renderToStaticMarkup(renderMarkdown("Press :kbd[Ctrl]."));
    expect(html).toContain("<kbd");
    expect(html).toContain("Ctrl");
  });

  it("drops raw HTML rather than emitting live elements (remark-rehype without allowDangerousHtml)", () => {
    const html = renderToStaticMarkup(renderMarkdown("<script>window.pwned = true</script>"));
    expect(html).not.toMatch(/<script>window\.pwned/);
  });

  it("wraps output in the .mk-doc class the renderer's own CSS and print stylesheet target", () => {
    const html = renderToStaticMarkup(renderMarkdown("hello"));
    expect(html).toContain('class="mk-doc"');
  });

  it("routes a fenced code block through codeBlock.tsx's <CodeBlock>, via the vsnote-code directive rewrite (upstream finding #1 workaround)", () => {
    // `codeBlock.tsx`'s language resolution is a `useEffect` + dynamic
    // `import()` (client-only — SSR/`renderToStaticMarkup` never runs
    // effects at all), so the actual highlighted `tok-*` spans this
    // rewrite makes possible are covered directly against
    // `buildHighlightedLines` in `markdownCodeBlock.test.ts` instead; this
    // test proves the WIRING — a fenced block reaches `codeBlock.tsx`'s
    // own line-numbered `<pre>` wrapper (not a plain, markii-default
    // `<pre><code>`) with its exact source text intact.
    const html = renderToStaticMarkup(renderMarkdown("```ts\nconst x: number = 1;\n```"));
    expect(html).toContain("mk-static-codeblock");
    expect(html).toContain("mk-static-codeblock__lineno");
    expect(html).toContain("const x: number = 1;");
  });

  it("degrades an unrecognized fence language to plain, correctly-escaped text (still via the highlighter's own wrapper)", () => {
    const html = renderToStaticMarkup(renderMarkdown("```made-up-language\n<b>not html</b>\n```"));
    expect(html).toContain("mk-static-codeblock");
    expect(html).not.toContain("<b>not html</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("renders an unresolvable relative image as text, never a broken <img> (upstream finding: no post-render <img> fallback seam)", () => {
    const html = renderToStaticMarkup(renderMarkdown("![a screenshot](assets/shot.png)"));
    expect(html).not.toContain("<img");
    expect(html).toContain("Image: a screenshot");
  });

  it("falls back to the source when an unresolvable image has no alt text", () => {
    const html = renderToStaticMarkup(renderMarkdown("![](assets/shot.png)"));
    expect(html).toContain("Image: assets/shot.png");
  });

  it("renders an image whose resolver succeeds as a real <img>, not a placeholder", () => {
    const html = renderToStaticMarkup(renderMarkdown("![a](assets/shot.png)", { resolveImageSrc: () => "blob:resolved" }));
    expect(html).toContain("<img");
    expect(html).toContain('src="blob:resolved"');
  });

  it("leaves an absolute image URL alone even with no resolver", () => {
    const html = renderToStaticMarkup(renderMarkdown("![a](https://example.com/x.png)"));
    expect(html).toContain('src="https://example.com/x.png"');
  });

  describe("hideScriptBlocks (R5-9b — the Markii extension page's 'Hide script blocks' row)", () => {
    const SCRIPT_FENCE = "```lua {name=stars}\nreturn 1\n```";
    const ORDINARY_FENCE = "```lua\nreturn 1\n```";

    it("is a no-op by default: a Markii script block still renders", () => {
      const html = renderToStaticMarkup(renderMarkdown(SCRIPT_FENCE));
      expect(html).toContain("mk-static-codeblock");
      expect(html).toContain("return 1");
    });

    it("drops a Markii script block (fence meta carries a valid script name) when hideScriptBlocks is on", () => {
      const html = renderToStaticMarkup(renderMarkdown(SCRIPT_FENCE, { hideScriptBlocks: true }));
      expect(html).not.toContain("mk-static-codeblock");
      expect(html).not.toContain("return 1");
    });

    it("leaves an ordinary fenced code block (no {name=...}) alone even with hideScriptBlocks on", () => {
      const html = renderToStaticMarkup(renderMarkdown(ORDINARY_FENCE, { hideScriptBlocks: true }));
      expect(html).toContain("mk-static-codeblock");
      expect(html).toContain("return 1");
    });

    it("leaves a fence whose {...} name is not a legal script name alone (extractScripts' own rule — a dotted name is not a script)", () => {
      const html = renderToStaticMarkup(renderMarkdown("```lua {name=repo.stars}\nreturn 1\n```", { hideScriptBlocks: true }));
      expect(html).toContain("mk-static-codeblock");
      expect(html).toContain("return 1");
    });

    it("drops a script block that sits alongside ordinary prose, leaving the prose intact", () => {
      const html = renderToStaticMarkup(renderMarkdown(`Before.\n\n${SCRIPT_FENCE}\n\nAfter.`, { hideScriptBlocks: true }));
      expect(html).toContain("Before.");
      expect(html).toContain("After.");
      expect(html).not.toContain("mk-static-codeblock");
    });
  });
});

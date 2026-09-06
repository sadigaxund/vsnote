/**
 * The print-only markdown document for DESIGN-SPEC item 38's Export as PDF
 * — split out of `printExport.tsx` (which owns mount/print/teardown)
 * purely so this file's only export is a component (`PrintDocument`);
 * ESLint's `react-refresh/only-export-components` flags a module that
 * exports BOTH component and non-component bindings, and `printExport.tsx`
 * needs to export the plain `exportMarkdownAsPdf` function.
 *
 * docs/PLAN-2026-09-05-refresh.md §6 Phase M1 item 6: this used to be a
 * ~250-line hand-rolled block/inline markdown parser (headings, lists,
 * tables, blockquotes, code fences, `~~strike~~`) built on top of
 * `my-you-eye`'s `CodeBlock`/`Table`/`renderInline` primitives. It is now
 * `src/markdown/render.tsx`'s `renderMarkdown` — the ONE static renderer
 * every markdown-to-React consumer in the app shares (the public share
 * reader, this file, and `.mk.md`'s Rendered mode) — so print output gets
 * the exact same GFM/directive support as everywhere else instead of its
 * own second, drifting implementation. `degradeUnresolvedRelativeLinks:
 * false`: a printed page has no share link map at all (there is no
 * `links` option), so a relative link here is just an ordinary relative
 * link, not a "this file isn't shared" case — degrading it to muted text
 * would be wrong for a plain export of a note that links to sibling notes
 * in the same vault.
 *
 * Print output matches (or beats) the hand-rolled parser it replaced on
 * both fronts that parser used to own outright: fenced code blocks are
 * highlighted (`render.tsx`'s `vsnote-code` directive rewrite, on top of
 * `codeBlock.tsx`'s highlighter — see that file's header for why
 * `@markii/react` needed a workaround here at all: no component-override
 * hook for a plain `<pre><code>`), and an unresolvable relative image
 * (e.g. a vault-relative `![alt](assets/x.png)` a print window has no
 * `blob:` access to) renders as the same "Image: alt-or-source" text
 * placeholder the old parser produced, never a broken-image icon
 * (`render.tsx`'s image-node rewrite, since no `resolveImageSrc` is passed
 * here). See `docs/ARCHITECTURE.md`'s markdown-pipeline section, "Markii
 * upstream findings" #1, for the real (still-open) upstream gap this
 * works around — a rendering regression is not one of its consequences.
 */
import type { ReactNode } from "react";
import { renderMarkdown } from "../markdown/render";

export function PrintDocument({ title, content }: { title: string; content: string }): ReactNode {
  return (
    <article className="print-doc">
      <h1 className="print-doc-title">{title}</h1>
      {renderMarkdown(content, { degradeUnresolvedRelativeLinks: false })}
    </article>
  );
}

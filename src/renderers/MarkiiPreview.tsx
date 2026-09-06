/**
 * `.mk.md`'s Rendered mode (docs/PLAN-2026-09-05-refresh.md §6 Phase M1) —
 * a static, 200ms-debounced render through `src/markdown/render.tsx`'s
 * `renderMarkdown`. Deliberately NOT `editor/LivePreviewEditor` (plain
 * `.md`'s CM6 live-preview engine, unchanged by this phase per the plan):
 * this is the "toggle Source/Preview with a debounce" pattern the plan
 * calls out for M1, with Phase M2's in-editor live-preview decorations for
 * directives explicitly deferred.
 *
 * `@markii/react/doc.css` is imported here (not from `render.tsx` itself)
 * so the stylesheet only ever loads alongside a real markii consumer's own
 * lazy chunk — this component, the public share reader, and print/export
 * each pull it in independently the first time they actually render, never
 * as part of the app's cold-boot bundle (`EditorContent.tsx` already
 * `React.lazy`s every renderer, this one included).
 */
import { useEffect, useState } from "react";
import "@markii/react/doc.css";
import { renderMarkdown } from "../markdown/render";

const DEBOUNCE_MS = 200;

export interface MarkiiPreviewProps {
  content: string;
}

export function MarkiiPreview({ content }: MarkiiPreviewProps) {
  const [debounced, setDebounced] = useState(content);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(content), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [content]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "24px 32px",
        color: "var(--markdown-body)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {renderMarkdown(debounced)}
    </div>
  );
}

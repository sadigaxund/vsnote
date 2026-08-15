/**
 * `.html` Rendered mode — DESIGN-SPEC Modes table: "sandboxed iframe
 * preview". `sandbox=""` (no tokens at all) is the strictest sandbox CSP
 * allows: no scripts, no same-origin, no forms, no popups — an arbitrary
 * vault file can never reach the app's own origin/storage through this
 * iframe. Content is written via `srcDoc` (not a blob/data URL) so nothing
 * ever round-trips through the network layer.
 */
import { useMemo } from "react";

export interface HtmlPreviewProps {
  content: string;
}

export function HtmlPreview({ content }: HtmlPreviewProps) {
  // A fresh `srcDoc` string is fine to set on every render — React diffs it
  // like any other prop and only touches the DOM when it actually changes.
  const srcDoc = useMemo(() => content, [content]);
  return (
    <div style={{ flex: 1, minHeight: 0, background: "#ffffff" }}>
      <iframe
        title="HTML preview"
        srcDoc={srcDoc}
        sandbox=""
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      />
    </div>
  );
}

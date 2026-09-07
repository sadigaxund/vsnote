/**
 * Pure resolution logic for the public reader's per-share layout, split out
 * of `ShareApp.tsx` so it's directly unit-testable (no DOM/React needed) —
 * same "pure logic module next to the component" split every other
 * `*Logic.ts`/`*Resolve.ts` file in this repo already uses.
 *
 * feat(share) R4: `ReaderPrefs.column_width` is the OWNER's single,
 * share-wide choice — `null` means "never explicitly chosen", in which case
 * the reader falls back to a per-KIND default rather than one hardcoded
 * value: code/csv/json/html shares default to "wide"/"full" (they need the
 * room), markdown stays "narrow" (prose reads better in a narrower column).
 */
import type { RendererKind } from "../filetypes/registry";
import type { ReaderPrefs } from "./api";

/** The three coarse "how wide does this content want to be" buckets — kept
 * separate from `RendererKind` itself since several renderers (csv/json/
 * code) share the same "wide" default. feat(share) R6: now derived from
 * the registry's own `RendererKind` (`shareRendererResolve.ts`) instead of
 * the reader's old private isMarkdown/isHtml booleans. */
export type ShareContentClass = "markdown" | "html" | "code";

export function classifyShareContent(renderer: RendererKind): ShareContentClass {
  if (renderer === "livepreview") return "markdown";
  if (renderer === "html") return "html";
  return "code"; // csv, json, image, code
}

const PER_CLASS_DEFAULT_WIDTH: Record<ShareContentClass, "narrow" | "wide" | "full"> = {
  markdown: "narrow",
  html: "full",
  code: "wide",
};

/** Resolves the effective column width for one share: the owner's explicit
 * choice always wins; otherwise falls back to the content class's own
 * default. */
export function resolveReaderColumnWidth(contentClass: ShareContentClass, columnWidth: ReaderPrefs["column_width"]): "narrow" | "wide" | "full" {
  return columnWidth ?? PER_CLASS_DEFAULT_WIDTH[contentClass];
}

/** `data-reader-theme` attribute value — `undefined` for "system" so
 * `theme.css`'s media-query-driven default keeps doing the work (never
 * duplicated in JS); `"light"`/`"dark"` pass through unchanged as the
 * owner's explicit choice. */
export function resolveReaderThemeAttr(theme: ReaderPrefs["theme"]): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

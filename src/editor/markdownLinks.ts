/**
 * Resolves a markdown link's `href` against the note that contains it, for
 * Rendered mode's link-click handler (DESIGN-SPEC "Internal links
 * `[text](file.ext)` render accent-colored and open that file in a tab").
 * App.tsx hands the RAW href written in the source markdown here — the
 * editor component (`@atomic-editor/editor`) deliberately stays unopinionated
 * about vault paths. No `path`/`url` module exists in the browser bundle, so
 * relative segment resolution (`../`, `./`) is hand-rolled here rather than
 * pulling in a polyfill for a handful of lines of stack math.
 */
import { parentOfDisplayPath } from "../fs/paths";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export type ResolvedLink = { kind: "external"; href: string } | { kind: "internal"; path: string };

/** `fromDisplayPath` is the note containing the link (e.g.
 * `vault/notes/architecture.md`); `href` is the raw link target as written
 * in the markdown (e.g. `../src/indexer.ts`, `/vault/notes/x.md`, or
 * `https://example.com`). Anchors (`#section`) and query strings are
 * stripped before resolution — this app has no in-note heading anchors to
 * jump to yet. */
export function resolveMarkdownLink(fromDisplayPath: string, href: string): ResolvedLink {
  const trimmed = href.trim();
  if (SCHEME_RE.test(trimmed) || trimmed.startsWith("//")) {
    return { kind: "external", href: trimmed };
  }
  const withoutAnchor = trimmed.split("#")[0].split("?")[0];
  if (!withoutAnchor) return { kind: "external", href: trimmed };

  const baseDir = parentOfDisplayPath(fromDisplayPath);
  const isAbsolute = withoutAnchor.startsWith("/");
  const segments = (isAbsolute ? withoutAnchor.slice(1) : `${baseDir}/${withoutAnchor}`).split("/");

  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return { kind: "internal", path: stack.join("/") };
}

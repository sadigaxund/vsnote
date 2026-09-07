/**
 * feat(share) R6 — "a share renders what the editor's Rendered mode
 * renders": the public reader (`ShareApp.tsx`) used to hardcode its own
 * isMarkdown/isHtml/isCode dispatch, completely independent of
 * `filetypes/registry.ts` (the SAME table `EditorContent.tsx`'s Rendered
 * mode already reads) — so a new kind getting a real renderer added to the
 * registry (R3-7's code kinds, csv, json, ...) never automatically reached
 * the reader; someone had to remember to ALSO teach ShareApp.tsx about it.
 * This module is the one place that resolves "which renderer does this
 * kind use", read by both the reader and (indirectly, via the registry
 * itself) the app's own Rendered mode — there is no second table to drift.
 */
import { fileTypeForOrPlain, type RendererKind } from "../filetypes/registry";
import type { FileKind } from "../types";

/** The renderer a kind uses when shown "rendered" — mirrors
 * `filetypes/registry.ts::FileTypeEntry.renderer` exactly, falling back to
 * `"code"` (plain/unmodeled text, still readable as highlighted-or-plain
 * text with line numbers) for a kind with no registry entry at all (an
 * unrecognized extension) — the exact behavior the reader's old catch-all
 * `isCode` branch already had, just resolved through one shared function
 * now instead of re-derived locally. */
export function resolveShareRenderer(kind: FileKind | undefined): RendererKind {
  return fileTypeForOrPlain(kind).renderer ?? "code";
}

/** Only csv/json/html shares get a Rendered/Source switch in the reader:
 * their "rendered" view (a table/tree/iframe) and their "source" view (the
 * raw text, highlighted) are genuinely different presentations of the same
 * content. Markdown stays rendered-only (raw vs. rendered is a MODE chosen
 * at publish time, not a per-visit reader toggle) and every code kind's
 * "renderer" already IS `CodeBlock` — there is no second, different view to
 * switch to, so offering the switch there would be a no-op control. */
export function shareSupportsSourceToggle(renderer: RendererKind): boolean {
  return renderer === "html" || renderer === "csv" || renderer === "json";
}

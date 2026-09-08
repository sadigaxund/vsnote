/**
 * R5-4 — pure predicate for whether the public share reader's file header
 * shows a Download button, split out of `ShareApp.tsx` so it's directly
 * unit-testable (no DOM/React needed), same "pure logic module next to the
 * component" split `readerPrefsResolve.ts`/`shareRendererResolve.ts`
 * already use.
 *
 * Hidden for a markdown share (`renderer === "livepreview"` — rendered-
 * only content, raw vs. rendered is a MODE chosen at publish time, not a
 * per-visit reader affordance, and there's no "original file" distinct
 * from the rendered prose worth offering as a download) and for a binary
 * file (`isBinary` — the reader shows an "Binary file" `EmptyState` with no
 * header at all). Every other renderer (code/csv/json/html) downloads the
 * exact same raw bytes `GET /share/{id}?download=1` already serves for a
 * non-browser caller — see `server/app/routers/share_public.py`'s
 * `_wants_download`.
 *
 * `ShareApp.tsx`'s own branching already never constructs a `CodeBlock`/
 * `RenderedSourceHeader` for a markdown or binary share in the first
 * place, so this predicate is belt-and-suspenders there, not the only
 * thing keeping the button off — but it's still the ONE place that
 * decision is spelled out and tested, rather than left implicit in which
 * JSX branch happens to run.
 */
import type { RendererKind } from "../filetypes/registry";

export function canDownloadShare(renderer: RendererKind, isBinary: boolean): boolean {
  return !isBinary && renderer !== "livepreview";
}

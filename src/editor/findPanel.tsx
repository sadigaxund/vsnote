/**
 * `createFindPanel` — the `@codemirror/search` `SearchConfig.createPanel`
 * override that replaces the stock vanilla-JS find/replace panel with the
 * VSCode-style floating `FindWidget` (DESIGN-SPEC Amendments item 9).
 *
 * Two things this relies on, both verified by reading
 * `node_modules/@codemirror/search/dist/index.js` and
 * `node_modules/@codemirror/view/dist/index.js` directly (not just their
 * `.d.ts`s) before writing this:
 *
 * 1. **Native match highlighting is gated on the panel existing, not on any
 *    DOM shape.** `searchHighlighter`'s `highlight({query, panel})` bails
 *    to `Decoration.none` whenever `panel` is falsy — so as long as this
 *    module still returns a real `Panel` from `createPanel` (which
 *    `openSearchPanel`/`closeSearchPanel` toggle via the `togglePanel`
 *    effect, same as the vanilla panel), `.cm-searchMatch`/
 *    `.cm-searchMatch-selected` decorations keep rendering exactly as
 *    before — completely independent of what this Panel's `dom` looks like
 *    or contains. This is what makes "hand-roll the chrome, keep the
 *    highlighting native" possible at all.
 * 2. **`.cm-editor` is `position: relative !important` and the panel
 *    container CM6 mounts `dom` into (`.cm-panels`) is `position: sticky`
 *    — both valid containing blocks for an absolutely-positioned child.**
 *    The vanilla panel is a normal in-flow flex child of `.cm-editor`'s
 *    column layout, which is exactly what DESIGN-SPEC item 9 says NOT to
 *    do ("must NOT push the text down — it overlays"). Setting this
 *    module's own `dom` to `position: absolute` pulls it out of that flow
 *    entirely (an absolutely-positioned box contributes nothing to its
 *    parent's flex sizing), so `.cm-panels` collapses to zero height and
 *    the editor scroller never shifts — while the floating card still
 *    anchors to the editor's own top-right corner via the `.cm-editor`
 *    `position: relative` ancestor. No extra wrapper, no portal.
 *
 * One `Panel`/React root per `openSearchPanel(view)` call — destroyed and
 * recreated on every open/close cycle (CM6's own panel lifecycle), so
 * `FindWidget`'s local state (query fields, expanded/collapsed, preserve
 * case) naturally resets each time find re-opens, matching VSCode's own
 * find widget behavior.
 */
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { TooltipProvider } from "my-you-eye";
import { FindWidget } from "../components/local/FindWidget";

export function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-slate-find-panel";
  dom.style.position = "absolute";
  dom.style.top = "0";
  dom.style.left = "0";
  dom.style.right = "0";
  dom.style.zIndex = "50";
  dom.style.display = "flex";
  dom.style.justifyContent = "flex-end";
  // The outer strip spans the full editor width (so `justify-content:
  // flex-end` can push the card to the right edge) but must never itself
  // intercept clicks over the editor content below it — only the card
  // FindWidget renders re-enables pointer events (see its own root style).
  dom.style.pointerEvents = "none";

  let root: Root | null = null;
  let notify: ((update: ViewUpdate) => void) | null = null;

  return {
    dom,
    top: true,
    mount() {
      root = createRoot(dom);
      // `FindWidget` uses the library's `Tooltip`, which reads Radix
      // context from `<TooltipProvider>` — `main.tsx` wraps `<App>` in one,
      // but this is a SEPARATE React root (this module's own doc explains
      // why), so that provider's context doesn't reach here. Without this,
      // every `Tooltip` throws `"must be used within TooltipProvider"` on
      // mount — an uncaught render error with no error boundary here to
      // catch it, so React silently unmounts the WHOLE widget, which is
      // why this manifested as "the find widget never appears at all"
      // rather than "tooltips are broken" (caught via `page.on("pageerror")`
      // during verification, not visible from the DOM alone).
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(FindWidget, {
            view,
            registerUpdateListener: (fn) => {
              notify = fn;
            },
          }),
        ),
      );
    },
    update(update) {
      notify?.(update);
    },
    destroy() {
      root?.unmount();
      root = null;
    },
  };
}

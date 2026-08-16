/**
 * Rendered-markdown typography — DESIGN-SPEC "Rendered markdown typography
 * (match image)", reproduced from the same token values Phase 1's static
 * placeholder used in `EditorContent.tsx` (H1 `#d8dfe6` bold, H2 teal body
 * `#bac1c8` relaxed line-height, lime-green bare inline/fenced code with no
 * chip/border, italic muted blockquote with an accent left border) so the
 * live editor built this phase matches exactly what was already validated
 * against `app-preview.png`, just applied to CM6's DOM instead of static
 * JSX. No hex is invented here — every color is a `var(--...)` token.
 *
 * No `fontSize` here (Phase 5a removed the `"&": {fontSize: "17px"}}` rule
 * that used to live in this block): `LivePreviewEditor.tsx` now supplies it
 * via a `Prec.highest`-wrapped `fontSizeCompartment` so the Settings view's
 * font-size slider can reconfigure it live — a hardcoded rule here
 * would always lose that precedence fight anyway (dead, misleading weight).
 * `LivePreviewEditor.tsx`'s `RENDERED_BASE_FONT_SIZE` (17, unchanged from
 * this line) is the one place that number is defined now.
 *
 * Phase 6.5c (DESIGN-SPEC Amendments item 11, "Rendered view" category):
 * `.cm-content`'s `maxWidth`/`padding` (content column width + left/right
 * margins) and `.cm-scroller`'s `lineHeight` are gone from this static
 * block for the same reason `fontSize` already was — `LivePreviewEditor.tsx`'s
 * `renderedLayoutCompartment` is now their sole source, so the Settings
 * view's content-width/margin/line-spacing sliders take effect immediately
 * with no remount and no precedence fight (unlike `fontSize`, nothing else
 * in this file competes for these two selectors' remaining properties —
 * `.cm-content`'s `caretColor` and `.cm-scroller`'s `fontFamily` stay here
 * — so no `Prec.highest` wrapping is needed for this compartment either).
 */
import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.theme(
  {
    "&": {
      color: "var(--markdown-body)",
      // DESIGN-SPEC Amendments round 3 item 22(a) — same reasoning as
      // `editor/theme.ts`'s `&` rule: this is CodeMirror's own DOM,
      // painting over `EditorPane.tsx`'s `TexturedSurface` ancestor, so it
      // reads the canvas-specific token (transparent under every theme but
      // VSNote) instead of `--app-editor-bg` directly.
      backgroundColor: "var(--app-editor-canvas-bg)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-sans)",
    },
    ".cm-content": {
      margin: "0 auto",
      caretColor: "var(--color-primary)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-line": { padding: "0" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 25%, transparent)",
    },
    ".cm-cursor": { borderLeftColor: "var(--color-primary)" },
    // No `.cm-panels`/`.cm-panel` rules here — DESIGN-SPEC Amendments item 9:
    // `editor/findPanel.ts`'s `createFindPanel` replaces the vanilla find/
    // replace panel with the React `FindWidget` (own tokens, own card),
    // same reasoning as `editor/theme.ts`'s matching removal.

    // ---- Headings ----
    ".cm-md-h1": {
      fontSize: "32px",
      fontWeight: "700",
      color: "var(--color-fg)",
      lineHeight: "1.3",
      letterSpacing: "-0.01em",
      marginTop: "4px",
    },
    ".cm-md-h2": { fontSize: "19px", fontWeight: "700", color: "var(--color-primary)", lineHeight: "1.4", marginTop: "10px" },
    ".cm-md-h3": { fontSize: "17px", fontWeight: "700", color: "var(--color-primary)", lineHeight: "1.4", marginTop: "8px" },
    ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontSize: "17px", fontWeight: "700", color: "var(--color-primary)" },

    // ---- Inline marks (kept small/muted while raw so the "smallest
    // enclosing region" reveal reads as syntax, not more prose). ----
    ".cm-md-mark": { color: "var(--color-muted)", opacity: 0.75 },

    // ---- Emphasis ----
    ".cm-md-strong": { color: "var(--color-fg)", fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },

    // ---- Inline code — bare, no chip/border (DESIGN-SPEC correction).
    // DESIGN-SPEC Amendments round 3 item 22(b): follows the same
    // `--syntax-string` role token `editor/theme.ts`'s CM6 HighlightStyle
    // uses for Source-mode string/code tokens, rather than the separate
    // `--markdown-code-color` token — both resolve to the same value for
    // VSNote (no visual change) but now move together under every other
    // `data-theme`. ----
    ".cm-md-code": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.88em",
      color: "var(--syntax-string)",
    },

    // ---- Links ----
    ".cm-md-link": {
      color: "var(--color-primary)",
      textDecoration: "underline",
      textUnderlineOffset: "2px",
      cursor: "pointer",
    },

    // ---- Lists ----
    ".cm-md-list-item": {
      position: "relative",
      paddingLeft: "1.1em",
    },
    ".cm-md-list-item::before": {
      content: '"•"',
      position: "absolute",
      left: "0",
      color: "var(--color-primary)",
    },
    ".cm-md-task-item": { paddingLeft: "0.1em" },
    ".cm-md-ordered-item": { paddingLeft: "0.2em" },
    ".cm-md-strike": { textDecoration: "line-through", color: "var(--color-muted)" },
    ".cm-md-checkbox": {
      accentColor: "var(--color-primary)",
      marginRight: "8px",
      verticalAlign: "middle",
      cursor: "pointer",
      position: "relative",
      top: "-1px",
    },

    // ---- Blockquote ----
    ".cm-md-quote": {
      borderLeft: "3px solid var(--color-primary)",
      paddingLeft: "13px",
      fontStyle: "italic",
      color: "var(--color-muted)",
    },

    // ---- Fenced code block — flush on the editor background, no raised
    // surface/border (DESIGN-SPEC correction). Amendments round 3 item
    // 22(b): same `--syntax-string` role token as inline code above and
    // Source mode's real per-token highlighting — see that rule's doc. ----
    ".cm-md-fence": {
      fontFamily: "var(--font-mono)",
      fontSize: "15px",
      color: "var(--syntax-string)",
      whiteSpace: "pre",
    },
    ".cm-md-fence-first": { marginTop: "6px" },
    ".cm-md-fence-last": { marginBottom: "6px" },

    // ---- Horizontal rule ----
    ".cm-md-hr": {
      borderTop: "1px solid var(--app-chrome-border)",
      display: "block",
      height: "0",
      margin: "20px 0",
    },
  },
  { dark: true },
);

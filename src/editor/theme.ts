/**
 * CM6 theme — reads the same design tokens as every other component
 * (`src/theme.css`), per CLAUDE.md rule 1 ("restyle via CSS variables at
 * the root — never fork or wrap-override"): applied here to CodeMirror's
 * own DOM instead of a component fork, exactly as ARCHITECTURE.md's
 * "Theme" flow describes for the rest of the app. No hex value is invented
 * — every color below is a `var(--...)` reference into `src/theme.css`'s
 * pixel-sampled palette.
 *
 * The *shape* of `highlightStyle` (which `@lezer/highlight` tags get
 * grouped together — keywords with keywords, strings with strings, etc.)
 * follows the same tag-grouping CodeMirror's own official themes use
 * (e.g. `@codemirror/theme-one-dark`, MIT licensed, Marijn Haverbeke) —
 * adapted here with this app's own token colors substituted in, not that
 * theme's palette (CLAUDE.md rule 7: attribute adapted OSS patterns).
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const editorTheme = EditorView.theme(
  {
    "&": {
      color: "var(--color-fg)",
      // DESIGN-SPEC Amendments round 3 item 22(a): reads
      // `--app-editor-canvas-bg`, not `--app-editor-bg` directly — this is
      // CodeMirror's own DOM, which paints ON TOP of `EditorPane.tsx`'s
      // `TexturedSurface` ancestor, so under every theme except Slate this
      // resolves to `transparent` (letting that ancestor's opaque fill +
      // theme texture show through with zero attenuation) while staying
      // the exact opaque Slate hex for `data-theme` unset/`"dark"` — see
      // `src/theme.css`'s `.dark` block comment for the full reasoning.
      backgroundColor: "var(--app-editor-canvas-bg)",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "var(--color-primary)",
      padding: "12px 0",
    },
    // No `lineHeight` here (Phase 6.5c, DESIGN-SPEC Amendments item 11's
    // "Editor" line-spacing setting) — `baseExtensions.ts`'s
    // `lineHeightCompartment` is the sole source now, so a fresh setting
    // change always wins with no precedence fight (see that file's doc).
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 25%, transparent)",
    },
    ".cm-activeLine": { backgroundColor: "var(--color-surface-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-hover)" },
    ".cm-gutters": {
      // Same reasoning as `&` above — transparent under textured themes so
      // the gutter strip shows the same texture as the rest of the canvas
      // instead of a flat opaque seam down the left edge.
      backgroundColor: "var(--app-editor-canvas-bg)",
      color: "var(--color-muted)",
      border: "none",
      borderRight: "1px solid var(--app-chrome-border)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 6px" },
    ".cm-foldPlaceholder": {
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      color: "var(--color-muted)",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 20%, transparent)",
      outline: "1px solid var(--color-primary)",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in oklab, var(--git-modified) 35%, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 40%, transparent)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 15%, transparent)",
    },
    // No `.cm-panels`/`.cm-panel` rules here (DESIGN-SPEC Amendments item
    // 9): `editor/findPanel.ts`'s `createFindPanel` replaces the vanilla
    // find/replace panel's DOM entirely with the React `FindWidget`, which
    // draws its own card (background/border/shadow) from tokens directly —
    // these rules would target dead markup now. `.cm-panels`' own CM6-
    // supplied styling stays neutral (this app's find widget overrides
    // `position`/`pointer-events` itself; see that module's doc).
    ".cm-tooltip": {
      backgroundColor: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      color: "var(--color-fg)",
    },
    // @codemirror/merge's outer wrapper + each side's editor — sizing only
    // (baseTheme rules are unscoped, so this reaches `.cm-mergeView` even
    // though it's declared as an extension of one of the two child editors;
    // see DiffView.tsx for why this can't just be inline React style).
    ".cm-mergeView": { height: "100%" },
    ".cm-mergeView .cm-editor": { height: "100%" },
    ".cm-mergeViewEditor": { height: "100%" },
    ".cm-mergeViewEditors": { height: "100%" },
  },
  { dark: true },
);

// DESIGN-SPEC Amendments round 3 item 22(b): every color below reads a
// `--syntax-*` role token (src/theme.css) instead of a raw hex OR a
// general-purpose app token like `--color-primary`/`--git-modified` — the
// nine roles are defined once per `data-theme` in theme.css (Slate's exact
// current colors as the literal base, every other theme derived from its
// own palette), so switching themes now genuinely reflows CM6's syntax
// colors instead of only the chrome around it. `t.link`/`t.heading` keep
// reading `--color-primary` directly (unchanged from before this phase) —
// those aren't code-syntax roles, they're markdown-source-mode link/heading
// styling that intentionally matches the app's accent everywhere.
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--syntax-variable)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--syntax-function)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--syntax-punctuation)" },
  { tag: [t.typeName, t.className, t.self, t.namespace], color: "var(--syntax-type)" },
  { tag: [t.number, t.changed, t.annotation, t.modifier], color: "var(--syntax-number)" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--syntax-number)" },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: "var(--syntax-operator)",
  },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--syntax-string)" },
  { tag: [t.meta, t.comment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--color-primary)", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "var(--color-primary)" },
  { tag: t.invalid, color: "var(--git-deleted)" },
]);

export function editorExtensions() {
  return [editorTheme, syntaxHighlighting(highlightStyle)];
}

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
      backgroundColor: "var(--app-editor-bg)",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "var(--color-primary)",
      padding: "12px 0",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 25%, transparent)",
    },
    ".cm-activeLine": { backgroundColor: "var(--color-surface-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-hover)" },
    ".cm-gutters": {
      backgroundColor: "var(--app-editor-bg)",
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

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--color-primary)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--color-fg)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--color-primary)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--color-fg)" },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: "var(--git-modified)",
  },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--git-modified)" },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: "var(--markdown-code-color)",
  },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--markdown-code-color)" },
  { tag: [t.meta, t.comment], color: "var(--color-muted)", fontStyle: "italic" },
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

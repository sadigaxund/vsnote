/**
 * Barrel for the Phase M2 directive-live-preview module (see `extension.ts`
 * and `decorations.ts`'s own docs) — the two halves a standalone
 * `@markii/codemirror` package would export from its root.
 */
export {
  MK_DIRECTIVE_CONTAINER,
  MK_DIRECTIVE_LEAF,
  MK_DIRECTIVE_TEXT,
  markiiDirectiveGrammar,
} from "./extension";
export { markiiLivePreviewDecorations } from "./decorations";
export {
  CONTAINER_OPEN_RE,
  INLINE_DIRECTIVE_RE,
  LEAF_DIRECTIVE_RE,
  isRecognizedInlineDirectiveStart,
  scanForContainerClose,
} from "./grammar";

/**
 * Filetype registry — ARCHITECTURE.md's `filetypes/` module: "registry keyed
 * by extension: ... language extension for CM6 ... available modes +
 * default mode, renderer component ... Adding a file type = one entry."
 * Phase 3 populated the language half; Phase 4 (this change) adds the mode-
 * availability/renderer half per DESIGN-SPEC's "Modes" table, so every
 * caller that needs "what can this file type do" (App.tsx's segmented
 * control, `useTabsStore`'s default-mode-on-open) reads the same one place
 * instead of each hand-rolling its own copy of the table.
 *
 * Keyed directly by `FileKind` (already the extension-derived type every
 * other store uses — `useFsStore.inferFileKind`) rather than a second
 * extension-string table, so there's exactly one place a file's "kind" is
 * decided. `FileKind` gained `js`/`jsx`/`html` alongside this file (see
 * `useFsStore.inferFileKind`) since IMPLEMENTATION-PLAN.md Phase 3
 * explicitly calls for "ts/tsx, js/jsx, json, css, html, md, and
 * csv-as-text" — recorded in ARCHITECTURE.md's Deviations list.
 *
 * Every `loadLanguage` is a dynamic `import()` — Vite code-splits each
 * `@codemirror/lang-*` package into its own chunk, so opening a `.md` file
 * never pulls in the TypeScript/JSX parser (and vice versa), keeping the
 * cold-boot bundle from absorbing every language CM6 knows about. Every
 * `renderer` similarly names a lazy-loaded component (`EditorContent.tsx`
 * `React.lazy`s each of `renderers/*` and `editor/LivePreviewEditor` — none
 * of CM6, the live-preview plugin, or the renderers land in the cold-boot
 * bundle until a tab actually needs them).
 *
 * DESIGN-SPEC's Modes table marks a default mode explicitly for exactly
 * three rows (`.md`→Rendered, `.json`→Source, code→Source) and leaves
 * `.html`/`.csv` unmarked. Interpreted here as "Rendered is the default
 * whenever a renderer exists, except where the table explicitly overrides
 * it (json, code)" — html/csv default to Rendered (a live iframe preview /
 * data table is the more useful first view of a data/markup file, the same
 * reasoning the table already applies to md) — flagged here rather than
 * silently guessed, since the table's silence on those two rows is
 * genuinely ambiguous; worth confirming against DESIGN-SPEC in review.
 */
import type { Extension } from "@codemirror/state";
import type { EditorMode, FileKind } from "../types";

/** Which Rendered-mode component a kind uses, when "rendered" is one of
 * its `baseModes`. `EditorContent.tsx` switches on this to pick the lazy
 * component — the renderer's own file lives in `renderers/` (or
 * `editor/LivePreviewEditor` for markdown, which is CM6 itself, not a
 * separate renderer). */
export type RendererKind = "livepreview" | "html" | "csv" | "json" | "image";

export interface FileTypeEntry {
  /** Status-bar language id, e.g. "TS", "MD", "JSON" (DESIGN-SPEC's `Ln 14,
   * Col 32` / `UTF-8` / `LF` / `MD` status-bar cluster). */
  languageId: string;
  /** Lazily loads this file type's CM6 language support extension (Source
   * mode). Resolves to `null` for "no CM6 language mode" — csv-as-text per
   * IMPLEMENTATION-PLAN.md Phase 3 (plain text: still gets line numbers,
   * search, the git gutter — just no syntax highlighting). */
  loadLanguage: () => Promise<Extension | null>;
  /** Modes selectable for this kind before considering whether the active
   * file actually has a nonzero diff — "diff" is added dynamically by the
   * caller (`modeAvailabilityFor` below) only when `supportsDiff` and a
   * real diff exists, so the segmented control never offers a Diff view
   * with nothing to show. */
  baseModes: EditorMode[];
  defaultMode: EditorMode;
  /** Whether Diff is ever a meaningful mode for this kind — false for
   * images (DESIGN-SPEC: Diff disabled unconditionally, no text diff to
   * show for a binary asset). */
  supportsDiff: boolean;
  /** Present iff "rendered" is in `baseModes`. */
  renderer?: RendererKind;
}

const REGISTRY: Partial<Record<FileKind, FileTypeEntry>> = {
  md: {
    languageId: "MD",
    loadLanguage: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
    baseModes: ["rendered", "source"],
    defaultMode: "rendered",
    supportsDiff: true,
    renderer: "livepreview",
  },
  ts: {
    languageId: "TS",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
    baseModes: ["source"],
    defaultMode: "source",
    supportsDiff: true,
  },
  tsx: {
    languageId: "TSX",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
    baseModes: ["source"],
    defaultMode: "source",
    supportsDiff: true,
  },
  js: {
    languageId: "JS",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
    baseModes: ["source"],
    defaultMode: "source",
    supportsDiff: true,
  },
  jsx: {
    languageId: "JSX",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
    baseModes: ["source"],
    defaultMode: "source",
    supportsDiff: true,
  },
  json: {
    languageId: "JSON",
    loadLanguage: () => import("@codemirror/lang-json").then((m) => m.json()),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "json",
  },
  css: {
    languageId: "CSS",
    loadLanguage: () => import("@codemirror/lang-css").then((m) => m.css()),
    baseModes: ["source"],
    defaultMode: "source",
    supportsDiff: true,
  },
  html: {
    languageId: "HTML",
    loadLanguage: () => import("@codemirror/lang-html").then((m) => m.html()),
    baseModes: ["rendered", "source"],
    defaultMode: "rendered",
    supportsDiff: true,
    renderer: "html",
  },
  csv: {
    languageId: "CSV",
    loadLanguage: () => Promise.resolve(null),
    baseModes: ["rendered", "source"],
    defaultMode: "rendered",
    supportsDiff: true,
    renderer: "csv",
  },
  image: {
    languageId: "IMG",
    loadLanguage: () => Promise.resolve(null),
    baseModes: ["rendered"],
    defaultMode: "rendered",
    supportsDiff: false,
    renderer: "image",
  },
};

const PLAIN_TEXT: FileTypeEntry = {
  languageId: "PLAIN",
  loadLanguage: () => Promise.resolve(null),
  baseModes: ["source"],
  defaultMode: "source",
  supportsDiff: true,
};

export function fileTypeFor(kind: FileKind | undefined): FileTypeEntry | undefined {
  if (!kind) return undefined;
  return REGISTRY[kind];
}

/** Same lookup with a guaranteed (never-undefined) result — the plain-text
 * fallback every unrecognized/`unknown`/`folder` kind gets, so callers that
 * just need "some CM6 extension + a status-bar label + source-only modes"
 * never have to null-check. */
export function fileTypeForOrPlain(kind: FileKind | undefined): FileTypeEntry {
  return fileTypeFor(kind) ?? PLAIN_TEXT;
}

export function defaultModeFor(kind: FileKind | undefined): EditorMode {
  return fileTypeForOrPlain(kind).defaultMode;
}

/** The full set of modes selectable right now for `kind`, given whether the
 * active file currently has a nonzero diff vs HEAD. Single source for the
 * EditorHeader segmented control (App.tsx) — "folder"/no-kind (no tab, or a
 * tree folder row) has no editor surface at all, so it gets no modes. */
export function modeAvailabilityFor(kind: FileKind | undefined, hasDiff: boolean): EditorMode[] {
  // "settings" (Phase 6.5c, DESIGN-SPEC Amendments item 11) is a VIEW tab,
  // not a file with Rendered/Source/Diff representations — same "no editor
  // surface at all" treatment as "folder"/no-kind, so `EditorHeader`'s mode
  // toggle never renders for it (see `EditorPane.tsx`, which hides the
  // whole header row for this kind rather than showing an all-disabled
  // segmented control).
  if (!kind || kind === "folder" || kind === "settings") return [];
  const entry = fileTypeForOrPlain(kind);
  const modes = [...entry.baseModes];
  if (hasDiff && entry.supportsDiff) modes.push("diff");
  return modes;
}

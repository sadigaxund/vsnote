/**
 * Filetype registry — ARCHITECTURE.md's `filetypes/` module: "registry keyed
 * by extension: ... language extension for CM6 ... Adding a file type = one
 * entry." Phase 3 populates the language half of that (icon/color already
 * lives in `FileKind` + `FileIcon`'s Material Icon Theme resolution;
 * renderer wiring is Phase 4's job per IMPLEMENTATION-PLAN.md).
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
 * cold-boot bundle from absorbing every language CM6 knows about.
 */
import type { Extension } from "@codemirror/state";
import type { FileKind } from "../types";

export interface FileTypeEntry {
  /** Status-bar language id, e.g. "TS", "MD", "JSON" (DESIGN-SPEC's `Ln 14,
   * Col 32` / `UTF-8` / `LF` / `MD` status-bar cluster). */
  languageId: string;
  /** Lazily loads this file type's CM6 language support extension.
   * Resolves to `null` for "no CM6 language mode" — csv-as-text per
   * IMPLEMENTATION-PLAN.md Phase 3 (plain text: still gets line numbers,
   * search, the git gutter — just no syntax highlighting). */
  loadLanguage: () => Promise<Extension | null>;
}

const REGISTRY: Partial<Record<FileKind, FileTypeEntry>> = {
  md: {
    languageId: "MD",
    loadLanguage: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  ts: {
    languageId: "TS",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  },
  tsx: {
    languageId: "TSX",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  },
  js: {
    languageId: "JS",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  jsx: {
    languageId: "JSX",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  },
  json: {
    languageId: "JSON",
    loadLanguage: () => import("@codemirror/lang-json").then((m) => m.json()),
  },
  css: {
    languageId: "CSS",
    loadLanguage: () => import("@codemirror/lang-css").then((m) => m.css()),
  },
  html: {
    languageId: "HTML",
    loadLanguage: () => import("@codemirror/lang-html").then((m) => m.html()),
  },
  csv: {
    languageId: "CSV",
    loadLanguage: () => Promise.resolve(null),
  },
};

const PLAIN_TEXT: FileTypeEntry = {
  languageId: "PLAIN",
  loadLanguage: () => Promise.resolve(null),
};

export function fileTypeFor(kind: FileKind | undefined): FileTypeEntry | undefined {
  if (!kind) return undefined;
  return REGISTRY[kind];
}

/** Same lookup with a guaranteed (never-undefined) result — the plain-text
 * fallback every unrecognized/`unknown`/`folder`/`image` kind gets, so
 * callers that just need "some CM6 extension + a status-bar label" never
 * have to null-check. */
export function fileTypeForOrPlain(kind: FileKind | undefined): FileTypeEntry {
  return fileTypeFor(kind) ?? PLAIN_TEXT;
}

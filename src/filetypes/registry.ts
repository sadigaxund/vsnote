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
 *
 * R3-9: a `.py`/`.go`/`.rs`/`.sh`/`.yaml`/... file previously fell through
 * `lib/fileTree.ts::inferFileKind`'s switch to `"unknown"`, which has no
 * entry here at all — `fileTypeForOrPlain` silently gave it the
 * `PLAIN_TEXT` fallback (`baseModes: ["source"]` only, no highlighting,
 * no Rendered mode) EVERYWHERE a `FileKind` drives behavior: Source mode,
 * Diff, the public share reader's `CodeBlock`, and print/export. Fixed by
 * adding ONE new `FileKind` ("code", see `types.ts`'s doc) as the default
 * `inferFileKind` case instead of "unknown", and ONE new `REGISTRY` entry
 * for it below, whose `loadLanguage` defers to `loadCodeLanguageInfo` —
 * `@codemirror/language-data`'s ~180-language catalog, matched by
 * filename via `LanguageDescription.matchFilename` — as the fallback for
 * every extension this table doesn't hand-write its own case for. See
 * `loadCodeLanguageInfo`'s own doc below for the bundle-splitting
 * discipline that keeps this from bloating the boot chunk.
 */
import type { Extension } from "@codemirror/state";
import type { EditorMode, FileKind } from "../types";

/** Which Rendered-mode component a kind uses, when "rendered" is one of
 * its `baseModes`. `EditorContent.tsx` switches on this to pick the lazy
 * component — the renderer's own file lives in `renderers/` (or
 * `editor/LivePreviewEditor` for markdown, which is CM6 itself, not a
 * separate renderer).
 *
 * `"code"` (R3-7): a READ-ONLY static highlighted view (`renderers/
 * CodeView.tsx`, wrapping the same `markdown/codeBlock.tsx::CodeBlock` the
 * public share reader uses for a raw code file) — line numbers, a wrap
 * toggle, a copy button, NO CodeMirror editor instance. Every code kind
 * below (`ts`/`tsx`/`js`/`jsx`/`css`) lists this renderer so Rendered is a
 * real, selectable mode for them; `defaultMode` for all of them stays
 * `"source"` (DESIGN-SPEC's table marks code's default explicitly, same as
 * `json`) — Rendered is an option, never the first thing you see. */
export type RendererKind = "livepreview" | "html" | "csv" | "json" | "image" | "code";

export interface FileTypeEntry {
  /** Status-bar language id, e.g. "TS", "MD", "JSON" (DESIGN-SPEC's `Ln 14,
   * Col 32` / `UTF-8` / `LF` / `MD` status-bar cluster). Constant for every
   * hand-written kind; for the generic `code` kind this is a placeholder
   * ("CODE") — the REAL per-file id (e.g. "PYTHON") only exists once a
   * filename has been matched against `@codemirror/language-data`, which is
   * necessarily async (see `loadCodeLanguageInfo` below) — callers that
   * want the real label for a `code`-kind file (`App.tsx`'s status bar) use
   * that function directly instead of this static field. */
  languageId: string;
  /** Lazily loads this file type's CM6 language support extension (Source
   * mode). Resolves to `null` for "no CM6 language mode" — csv-as-text per
   * IMPLEMENTATION-PLAN.md Phase 3 (plain text: still gets line numbers,
   * search, the git gutter — just no syntax highlighting).
   *
   * Takes an optional `filename` (R3-9) — every hand-written entry ignores
   * it (the kind alone already determines the language), but the generic
   * `code` entry needs it: one `FileKind` ("code") covers arbitrarily many
   * actual languages, so which language to load can only be decided per
   * FILE, not per kind. Callers that have a real filename/path in scope
   * (`EditorContent.tsx`, `codeBlock.tsx`) pass it through; callers that
   * only ever handle a specific hand-written kind (none currently) may omit
   * it. */
  loadLanguage: (filename?: string) => Promise<Extension | null>;
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
  // Markii extension (docs/PLAN-2026-09-05-refresh.md §6). `loadLanguage`
  // is the ordinary CM6 markdown language PLUS `directiveLezer`'s Lezer
  // `MarkdownExtension` (Phase M2 deliverable 1) — Source mode and Diff
  // mode both get real `MkDirectiveContainer`/`MkDirectiveLeaf`/
  // `MkDirectiveText` syntax nodes this way, at zero extra cost to plain
  // `.md` (a separate dynamic import, never pulled in for that kind).
  // Rendered mode is `renderer: "livepreview"` as of Phase M2 — the SAME
  // `editor/LivePreviewEditor` plain `.md` uses, not the Phase M1 static/
  // debounced split view (`renderers/MarkiiPreview.tsx`, now unused and
  // removed): `LivePreviewEditor` itself detects a `.mk.md` path and layers
  // `directiveLezer`'s decorations extension on top of its own markdown
  // language via a `Prec.high` override (see that file's own doc for why).
  mkmd: {
    languageId: "MK.MD",
    loadLanguage: () =>
      Promise.all([import("@codemirror/lang-markdown"), import("../markdown/directiveLezer/extension")]).then(
        ([markdownMod, directiveMod]) =>
          markdownMod.markdown({ extensions: [directiveMod.markiiDirectiveGrammar] }),
      ),
    baseModes: ["rendered", "source"],
    defaultMode: "rendered",
    supportsDiff: true,
    renderer: "livepreview",
  },
  // R3-7: every code kind (ts/tsx/js/jsx/css below) now lists "rendered"
  // alongside "source" — the `code` renderer (`renderers/CodeView.tsx`) is
  // a read-only static highlighted view built on the exact same
  // `CodeBlock` the public share reader already uses for a raw code file,
  // reusing THIS entry's own `loadLanguage` (never a duplicate language
  // table). `defaultMode` is unchanged ("source": DESIGN-SPEC's table
  // marks code's default explicitly) — Rendered becomes a real, selectable
  // option instead of being unconditionally disabled, never the default.
  ts: {
    languageId: "TS",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
  },
  tsx: {
    languageId: "TSX",
    loadLanguage: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
  },
  js: {
    languageId: "JS",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
  },
  jsx: {
    languageId: "JSX",
    loadLanguage: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
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
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
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
  // R3-9: the generic fallback kind — every extension `inferFileKind`
  // doesn't have its own case for (`lib/fileTree.ts`). Same shape as the
  // hand-written code kinds above (`baseModes`/`defaultMode`/`supportsDiff`/
  // `renderer: "code"`, reusing the exact same `CodeView`/`CodeBlock`
  // Rendered-mode machinery) — the only difference is `loadLanguage` defers
  // to `loadCodeLanguageInfo` below, which needs the actual filename to
  // pick a language out of `@codemirror/language-data`'s ~180-language
  // catalog. `languageId` here is only the synchronous placeholder (see the
  // interface doc) — never shown once a real match resolves.
  code: {
    languageId: "CODE",
    loadLanguage: (filename) => loadCodeLanguageInfo(filename).then((info) => info.extension),
    baseModes: ["rendered", "source"],
    defaultMode: "source",
    supportsDiff: true,
    renderer: "code",
  },
};

/** R3-9 fallback path: matches `filename` against every language
 * `@codemirror/language-data` knows (CM6's own `@codemirror/lang-*`
 * packages PLUS its legacy `@codemirror/legacy-modes` `StreamLanguage`
 * wrappers) via `LanguageDescription.matchFilename` — the same resolution
 * VSCode/CodeMirror's own demo use for "what language is this file",
 * covering both ordinary extensions (`.py`, `.go`, `.rs`, `.sh`, `.yaml`,
 * `.toml`, `.sql`, `.java`, `.c`/`.cpp`, `.rb`, `.php`, `.xml`, `.ini`, ...)
 * and filename patterns with no extension at all (`Dockerfile`, `Makefile`).
 *
 * Bundle discipline (CLAUDE.md rule 3 / the arc's boot-chunk rules): BOTH
 * `@codemirror/language-data` (a ~32KB metadata module: language names,
 * extensions, and a `load()` closure per language — no parser code itself)
 * and `@codemirror/language` (needed only for the `LanguageDescription`
 * class's `matchFilename` static method) are reached through dynamic
 * `import()` here, same as every `loadLanguage` in the table above reaches
 * its own `@codemirror/lang-*` package — neither module is imported
 * statically anywhere in this file, so nothing new lands in the chunk that
 * contains `REGISTRY`/`fileTypeFor` (which IS boot-loaded — `App.tsx` and
 * `EditorContent.tsx` both import from this module eagerly). A matched
 * language's OWN package (e.g. `@codemirror/lang-python`, or
 * `@codemirror/legacy-modes/mode/ruby` for a StreamLanguage entry) is
 * itself behind the matched `LanguageDescription`'s own `load()` — Vite
 * code-splits per-language exactly as it already does for `lang-markdown`/
 * `lang-javascript`/etc, so opening a `.py` file never pulls in the Rust,
 * Go, YAML, or any other language's parser.
 *
 * Verify post-build with: no `@codemirror/language-data` / `@codemirror/
 * lang-python` etc. source strings inside the entry/boot chunk — see this
 * file's `RendererKind` doc area / the module header for the exact grep.
 */
async function loadCodeLanguageInfo(
  filename: string | undefined,
): Promise<{ extension: Extension | null; languageId: string }> {
  if (!filename) return { extension: null, languageId: "PLAIN" };
  try {
    const [{ languages }, { LanguageDescription }] = await Promise.all([
      import("@codemirror/language-data"),
      import("@codemirror/language"),
    ]);
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (!desc) return { extension: null, languageId: "PLAIN" };
    const support = await desc.load();
    return { extension: support, languageId: desc.name.toUpperCase() };
  } catch {
    // A language's own chunk failing to load (offline, a stale deployed
    // bundle after a redeploy) degrades to plain text — never a crash, same
    // contract every other `loadLanguage` in this file already has.
    return { extension: null, languageId: "PLAIN" };
  }
}

/** Real per-FILE status-bar language id for a `code`-kind file (R3-9) —
 * `fileTypeFor("code")?.languageId` is only ever the "CODE" placeholder
 * (see the interface doc), since the actual language depends on the
 * filename, not the kind. Falls straight through to the ordinary
 * synchronous `languageId` for every other kind (including `undefined`),
 * so a caller (`App.tsx`'s status bar) can call this unconditionally for
 * whatever tab is active rather than branching on kind itself. */
export async function languageIdFor(kind: FileKind | undefined, path: string | undefined): Promise<string> {
  if (kind !== "code") return fileTypeForOrPlain(kind).languageId;
  const info = await loadCodeLanguageInfo(path);
  return info.languageId;
}

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
  if (!kind || kind === "folder" || kind === "settings" || kind === "shared") return [];
  const entry = fileTypeForOrPlain(kind);
  const modes = [...entry.baseModes];
  if (hasDiff && entry.supportsDiff) modes.push("diff");
  return modes;
}

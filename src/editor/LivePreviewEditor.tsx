/**
 * "Rendered" mode for `.md` files — the Obsidian-style live-preview editor
 * (DESIGN-SPEC "Markdown live preview ... non-negotiable"). As of 2026-08-21
 * the decoration engine itself is no longer hand-rolled: this wraps
 * **@atomic-editor/editor** (MIT, github.com/kenforthewin/atomic-editor),
 * the hardened CM6 live-preview component this repo's own `editor/livepreview/`
 * plugin was patterned after (see ARCHITECTURE.md's Deviations entry for the
 * full swap rationale — caret-geometry bugs in vertical motion across
 * hidden fence lines were the trigger).
 *
 * The contract with the rest of the app is UNCHANGED from the previous
 * hand-rolled version, so `EditorContent.tsx`, `ShareApp.tsx`,
 * `activeView.ts`, and the settings store all keep working untouched:
 *
 * - One real, editable CM6 `EditorView` per open file whose document is
 *   always raw markdown; rendered appearance is decorations only.
 *   atomic-editor remounts its view when `documentId` changes, mirroring
 *   this file's old mount-per-path pattern (`key={path}` upstream does the
 *   equivalent at the React layer).
 * - `onChange`/`onCursorChange`/`onOpenLink` keep their previous semantics:
 *   raw-markdown strings out, `{line, column}` (1-based) cursor reports,
 *   and RAW link hrefs handed to App.tsx's resolver
 *   (`editor/markdownLinks.ts`) exactly like the old LinkWidget did.
 * - The underlying view is captured through a tiny `ViewPlugin` passed via
 *   atomic-editor's documented `extensions` escape hatch, which keeps
 *   `activeView.ts`'s pane registration (⌘F, format actions) working and
 *   gives the external-content sync effect below the same `viewRef` access
 *   the hand-rolled version had.
 *
 * External content changes (second pane editing the same shared buffer, an
 * external discard) are applied as a full-document dispatch — NOT a remount
 * — with the same `lastEmittedRef` echo-suppression trick as before: the
 * last string THIS editor emitted via `onMarkdownChange` is recognized when
 * it echoes back through `useBufferStore`, skipping a redundant
 * `doc.toString()` + dispatch round-trip on every keystroke.
 *
 * Theming/settings: atomic-editor reads CSS custom properties, so VSNote's
 * DESIGN-SPEC look is restored by mapping tokens onto its variables on the
 * wrapper element (never forking library CSS): canvas/body/muted/accent
 * colors, sans/mono fonts, selection tint, transparent code background
 * (spec: fences sit flush on the editor surface), and the Settings-dialog
 * sliders — font size as the same 17px-based OFFSET as before
 * (`RENDERED_BASE_FONT_SIZE`), line spacing as `--atomic-editor-body-leading`,
 * content width as `--atomic-editor-measure`. The margin slider applies as
 * horizontal wrapper padding now (atomic-editor owns vertical rhythm via
 * line padding; see ARCHITECTURE.md's deviation note).
 *
 * ⌘F note: Rendered mode now uses atomic-editor's own find panel (its
 * `search()` extension ships one). App.tsx still owns the global Mod-f
 * handler and calls `openSearchPanel` on the registered view — that opens
 * the panel this view was configured with, i.e. atomic-editor's — instead
 * of Source/Diff mode's React `FindWidget`. Documented in ARCHITECTURE.md.
 *
 * ---- `.mk.md` live preview (Phase M2, docs/PLAN-2026-09-05-refresh.md §6) ----
 * Markii directive live-preview decorations
 * (`markdown/directiveLezer/decorations.ts`) plug into THIS component,
 * gated on `path.endsWith(".mk.md")` — the only VSNote-specific fact this
 * file adds to `directiveLezer`'s otherwise app-state-free extension pair.
 * Three things are needed for `.mk.md`, all applied only when that check
 * passes:
 *
 * 1. The decorations `ViewPlugin` itself (`markiiLivePreviewDecorations()`)
 *    — an ordinary member of the `extraExtensions` array below, no
 *    different from `CaptureView`/`EscapeClosesPanel`.
 * 2. A markdown LANGUAGE that actually contains `MkDirectiveContainer`/
 *    `MkDirectiveLeaf`/`MkDirectiveText` nodes for those decorations to
 *    find
 * 3. (R3-12) The SAME directive completion/hover/insert bundle
 *    (`editor/markiiCompletion.ts`'s `markiiEditorExtensions()`) Source
 *    mode already gets via `CodeMirrorEditor`'s `extraExtensions` — the
 *    owner's report that Rendered mode had none of it was this ticket.
 *    Loaded through its OWN compartment (`mkMdCompletionCompartmentRef`
 *    below), independent of the language/decorations compartments: unlike
 *    `markiiLivePreviewDecorations`'s `StateField`, nothing in
 *    `markiiEditorExtensions()` reads the syntax tree — `markiiCompletionSource`/
 *    `markiiHoverTooltip` work off raw `(lineText, column)` pairs off
 *    `state.doc` directly — so it carries none of the "two compartments,
 *    two dispatches" ordering hazard the language/decorations pair
 *    documents below, and can be installed in its own effect with no
 *    dependency on the other two having landed first. The completion
 *    popup positions itself off `state.doc` coordinates the same way CM6's
 *    autocomplete always does, and the hover tooltip's `pos`/`end` are doc
 *    offsets too — both resolve correctly against whatever the live-preview
 *    decorations plugin currently has on screen (a revealed raw fence line
 *    under the cursor, or collapsed elsewhere) because neither one inspects
 *    decorations at all, only the document. — atomic-editor builds its own `markdown({ base: markdownLanguage,
 *    codeLanguages, extensions: highlightMarkdown })` internally (see
 *    `@atomic-editor/editor`'s `AtomicCodeMirrorEditor.js`, MIT, and this
 *    file's `mkMdLanguageOverride` below, adapted from that exact call so
 *    `.mk.md` keeps every one of atomic-editor's own features — GFM,
 *    tables, task lists, its inline image/table widgets, fenced-code
 *    grammars — and gains `directiveLezer`'s grammar on top) with no
 *    Compartment exposed for a consumer to reconfigure. CM6's `language`
 *    facet resolves to its FIRST value by source order/precedence
 *    (`@codemirror/language`'s `combine(languages) { return languages[0]
 *    ?? null }`), and atomic-editor's own `markdown(...)` call is placed
 *    ahead of `...extensions` (the consumer escape hatch) in its own
 *    `EditorState.create` — so a same-precedence override placed in
 *    `extraExtensions` would lose. Wrapping this file's override in
 *    `Prec.high(...)` makes it win instead, without needing to fork or
 *    reach into atomic-editor's internals (CLAUDE.md rule 1's spirit,
 *    applied to a CM6 package instead of a `my-you-eye` component): every
 *    other atomic-editor extension (`tables`, `inlinePreview`,
 *    `imageBlocks`) reads whatever language facet value wins at query
 *    time, so they keep working against the overridden tree unchanged.
 *
 * Both are loaded via a dynamic `import()` (this file's
 * `loadMkMdLivePreviewExtensions`) behind a `Compartment` this component
 * owns itself, reconfigured once the import resolves — the same
 * "Compartment + dynamic loader" pattern `editor/CodeMirrorEditor.tsx`
 * already uses for `.mk.md` Source mode's completion/hover bundle
 * (`loadExtraExtensions`), so plain `.md` never pays for
 * `directiveLezer`'s chunk (or a second markdown-language chunk) at all —
 * only a `.mk.md` tab's first mount does.
 */
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { EditorView, ViewPlugin, type PluginValue } from "@codemirror/view";
import { Compartment, Prec, type Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { closeSearchPanel } from "@codemirror/search";
import {
  AtomicCodeMirrorEditor,
  highlightMarkdown,
  type AtomicCodeMirrorEditorHandle,
} from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import "./livepreview-theme.css";
import {
  getActiveEditorView,
  setActiveEditorView,
} from "./activeView";
import {
  useSettingsStore,
  DEFAULT_EDITOR_FONT_SIZE,
  RENDERED_CONTENT_WIDTH_FULL,
} from "../stores/useSettingsStore";
import { useMarkiiStore, selectEnabledPacks } from "../stores/useMarkiiStore";
import { useMarkiiExtensionSettingsStore } from "../stores/useMarkiiExtensionSettingsStore";
import { loadPersistedValues } from "../markii/platform/browser";
import { hydrateValueStore } from "../markii/host/valuePersistence";
import type { EnabledPack } from "../markii/host/packs";
import type { CursorPos } from "./CodeMirrorEditor";

/** Matches the pre-swap `RENDERED_BASE_FONT_SIZE` (17px prose baseline) —
 * the Settings slider applies `(settingFontSize - DEFAULT_EDITOR_FONT_SIZE)`
 * as an offset around it, keeping the default boot state pixel-identical to
 * the hand-rolled implementation while still scaling both modes by the same
 * delta. */
const RENDERED_BASE_FONT_SIZE = 17;

function renderedFontSize(settingFontSize: number): number {
  return RENDERED_BASE_FONT_SIZE + (settingFontSize - DEFAULT_EDITOR_FONT_SIZE);
}

/** Fenced-code grammars for languages this vault actually contains, wired
 * through atomic-editor's lazy-loading `codeLanguages` (each grammar is
 * dynamically imported on first use by a matching fence — no cost until
 * then). Kept to packages already in `dependencies`; more can be added the
 * same way. */
const codeLanguages = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["javascript", "js", "jsx", "mjs", "cjs"],
    extensions: ["js", "jsx", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["typescript", "ts", "tsx"],
    extensions: ["ts", "tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "css",
    alias: ["css"],
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["html", "htm"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "json",
    alias: ["json"],
    extensions: ["json", "map"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
];

/** True for a `.mk.md` file (case-sensitive, matching `useFsStore.inferFileKind`'s own double-extension check) — the only place this component decides "is this the Markii extension's filetype". */
function isMkMdPath(path: string): boolean {
  return path.endsWith(".mk.md");
}

/**
 * `.mk.md`'s overridden markdown language — atomic-editor's own GFM/
 * highlight setup (see this file's module doc) plus `directiveLezer`'s
 * grammar. Dynamically imported so plain `.md` never loads it.
 */
/**
 * R5-9 — `includeDirectives` is the Markii Extensions row's master
 * `Enabled` switch (`useMarkiiExtensionSettingsStore`): off means this
 * `.mk.md` tab gets the SAME grammar a plain `.md` file would (no
 * `markiiDirectiveGrammar`), which is what turns off directive syntax AND
 * fence sugar together — both come from that one grammar chunk, so there
 * is no finer split to gate them independently (see that store's module
 * doc for exactly what's real vs. state-only this round).
 */
async function loadMkMdLanguage(includeDirectives: boolean): Promise<Extension> {
  const { markdown, markdownLanguage } = await import("@codemirror/lang-markdown");
  if (!includeDirectives) {
    return Prec.high(markdown({ base: markdownLanguage, codeLanguages, extensions: [highlightMarkdown] }));
  }
  const { markiiDirectiveGrammar } = await import("../markdown/directiveLezer/extension");
  return Prec.high(
    markdown({
      base: markdownLanguage,
      codeLanguages,
      extensions: [highlightMarkdown, markiiDirectiveGrammar],
    }),
  );
}

/**
 * `.mk.md`'s directive live-preview decorations — see `decorations.ts`'s
 * own doc. Dynamically imported so plain `.md` never loads it.
 *
 * `enabledPacks` (worker 2) and `valueStore` (worker 3) are threaded
 * through unchanged to `markiiLivePreviewDecorations` — see that
 * function's own doc for both. `valueStore` is built by THIS component
 * (below) from `loadPersistedValues` + `hydrateValueStore`, a pure read
 * of a previous run's cached values; nothing here ever calls `runScripts`.
 */
async function loadMkMdDecorations(
  enabledPacks: readonly EnabledPack[],
  valueStore: ReturnType<typeof hydrateValueStore> | undefined,
  revealHintEnabled: boolean,
): Promise<Extension[]> {
  const { markiiLivePreviewDecorations } = await import("../markdown/directiveLezer/decorations");
  return markiiLivePreviewDecorations(enabledPacks, valueStore, revealHintEnabled);
}

/**
 * `.mk.md`'s directive completion/hover/insert bundle — see this file's
 * module doc, point 3. Dynamically imported for the same reason as the
 * language/decorations loaders above: a plain `.md` tab never pays for
 * `markiiCompletion.ts` (or, transitively, the vendored `@markii/host`
 * chunk it pulls in).
 */
async function loadMkMdCompletionExtensions(fenceSugarEnabled: boolean): Promise<Extension[]> {
  const { markiiEditorExtensions } = await import("./markiiCompletion");
  return markiiEditorExtensions(fenceSugarEnabled);
}

export interface LivePreviewEditorProps {
  /** Which pane this instance belongs to — see `editor/activeView.ts`'s
   * module doc (Phase 6: one registered view per pane, not one global). */
  paneId: string;
  path: string;
  content: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (pos: CursorPos) => void;
  onOpenLink?: (href: string) => void;
}

export function LivePreviewEditor({
  paneId,
  path,
  content,
  readOnly = false,
  onChange,
  onCursorChange,
  onOpenLink,
}: LivePreviewEditorProps) {
  // The underlying CM6 view, captured via the `CaptureView` plugin below
  // (atomic-editor's handle doesn't expose the view itself). Drives the
  // external-content sync effect; pane registration happens in the plugin
  // so ⌘F/format-actions resolve this pane's Rendered view like before.
  const viewRef = useRef<EditorView | null>(null);
  const handleRef = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  // The LAST content string this editor itself emitted — lets the sync
  // effect tell our own edit's echo apart from an external change (same
  // mechanism as the pre-swap implementation; see its notes in git history
  // and ARCHITECTURE.md).
  const lastEmittedRef = useRef<string | null>(null);
  // `.mk.md` only (see this file's module doc) — reconfigured once
  // `loadMkMdLanguage`/`loadMkMdDecorations` resolve. Empty for a plain
  // `.md` tab for the component's entire lifetime, so the two
  // Compartments cost nothing beyond their own allocation there.
  //
  // TWO separate compartments, dispatched in two SEPARATE transactions
  // (see the effect below) rather than one combined reconfigure: CM6's
  // `@codemirror/language` derives a `Language.state` field from whatever
  // the `language` facet currently resolves to, and that derived field is
  // only guaranteed up to date for transactions AFTER the one that
  // installed the new language — a `StateField.create()` that reads
  // `syntaxTree`/`ensureSyntaxTree` in the SAME transaction that also
  // installs the language (verified empirically: two Playwright debug
  // runs, `console.log`ing the tree from inside `create()` vs. from a
  // microtask right after `dispatch()` returned) can still see the OLD
  // language's tree. Installing the language first, then the decorations
  // in a follow-up `dispatch()`, sidesteps the race entirely — see the
  // Markii-upstream-findings writeup in `docs/ARCHITECTURE.md` for the
  // upstream ask this points at (`@codemirror/language`'s own docs don't
  // call out this ordering requirement for a from-scratch language swap).
  const mkMdLanguageCompartmentRef = useRef(new Compartment());
  const mkMdDecorationsCompartmentRef = useRef(new Compartment());
  // (R3-12) `.mk.md` only — see this file's module doc, point 3. No
  // ordering dependency on the two compartments above (nothing in
  // `markiiEditorExtensions()` reads the syntax tree), so it gets its own
  // effect below rather than being folded into either existing dispatch.
  const mkMdCompletionCompartmentRef = useRef(new Compartment());
  // R5-9 — the language effect's own in-flight (or already-settled)
  // dispatch, so the decorations effect can `await` it before reading the
  // syntax tree. Needed once the Markii `Enabled` switch can flip AFTER
  // mount (both effects re-run together, not just once at mount like
  // before): without this, a re-enable's decorations dispatch could race
  // ahead of the language reconfigure that puts `markiiDirectiveGrammar`
  // back — same stale-tree hazard `mkMdLanguageCompartmentRef`'s own doc
  // above describes, just triggered by a toggle instead of first mount.
  // Effects in the same commit run in declaration order, so by the time
  // the decorations effect below reads this ref, the language effect
  // (declared first) has already assigned this render's promise into it.
  const languageReadyRef = useRef<Promise<void>>(Promise.resolve());

  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
    onOpenLinkRef.current = onOpenLink;
  });

  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const contentWidth = useSettingsStore((s) => s.renderedContentWidth);
  const margin = useSettingsStore((s) => s.renderedMargin);
  const lineSpacing = useSettingsStore((s) => s.renderedLineSpacing);

  // Stable across the document's lifetime: atomic-editor captures the
  // `extensions` array once per `documentId`, so these are constructed once
  // per mount (paneId is fixed for a given mounted instance — upstream keys
  // the whole component by `path`).
  const extraExtensions = useMemo<Extension[]>(() => {
    let registered: EditorView | null = null;
    class CaptureView implements PluginValue {
      constructor(view: EditorView) {
        viewRef.current = view;
        registered = view;
        setActiveEditorView(paneId, view);
      }
      destroy() {
        if (viewRef.current === registered) viewRef.current = null;
        if (getActiveEditorView(paneId) === registered) setActiveEditorView(paneId, null);
      }
    }
    // Upstream gap workaround (fixed here, not forked): atomic-editor's
    // search panel doesn't bind Escape on its own DOM, so Esc while typing
    // in the find field did nothing (CM6's default panel closes; theirs
    // forgot the listener). Keydowns inside `.cm-panels` bubble through the
    // editor root, so one capture listener on `view.dom` closes the panel —
    // and only the panel — from anywhere inside it. (This can't be an
    // `EditorView.domEventHandlers` entry: those bind to the CONTENT dom,
    // which the panel is not part of.)
    class EscapeClosesPanel implements PluginValue {
      private readonly view: EditorView;
      private readonly handler = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".cm-panels")) return;
        event.preventDefault();
        closeSearchPanel(this.view);
      };
      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener("keydown", this.handler);
      }
      destroy() {
        this.view.dom.removeEventListener("keydown", this.handler);
      }
    }
    return [
      ViewPlugin.fromClass(CaptureView),
      ViewPlugin.fromClass(EscapeClosesPanel),
      // Same Ln/Col reporting contract as the pre-swap updateListener
      // (1-based column; fires on doc or selection changes).
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          onCursorChangeRef.current?.({ line: line.number, column: head - line.from + 1 });
        }
      }),
      mkMdLanguageCompartmentRef.current.of([]),
      mkMdDecorationsCompartmentRef.current.of([]),
      mkMdCompletionCompartmentRef.current.of([]),
    ];
  }, [paneId]);

  // `.mk.md` live preview (see `mkMdLanguageCompartmentRef`'s own doc for
  // why this is two dispatches, not one). `EditorContent.tsx` keys this
  // whole component by `path` (`key={path}`), so a path change always
  // remounts — this effect's empty dep array runs it exactly once for
  // this mount's fixed `path`, no need to guard against `path` changing
  // under it.
  // R5-9 — the Markii extension's master `Enabled` switch. Not a hook
  // dependency array oversight: this DOES need to re-run the language
  // effect below when the switch flips (unlike `path`, which is fixed for
  // this mount), so it's listed explicitly in that effect's deps.
  const markiiEnabled = useMarkiiExtensionSettingsStore((s) => s.enabled);
  const directiveRenderingEnabled = useMarkiiExtensionSettingsStore((s) => s.directiveRenderingEnabled);
  const completionEnabled = useMarkiiExtensionSettingsStore((s) => s.completionEnabled);
  // R5-9b — Editor section's "Fence sugar" row; see `markiiEditorExtensions`'s
  // own doc in `markiiCompletion.ts` for exactly what it gates.
  const fenceSugarEnabled = useMarkiiExtensionSettingsStore((s) => s.fenceSugarEnabled);
  // R5-9b — Editor section's "Reveal hint" row; see `decorations.ts`'s
  // `maybePushRevealHint` doc for exactly what it gates.
  const revealHintEnabled = useMarkiiExtensionSettingsStore((s) => s.revealHintEnabled);

  useEffect(() => {
    if (!isMkMdPath(path)) return;
    let cancelled = false;
    const ready = loadMkMdLanguage(markiiEnabled).then((language) => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: mkMdLanguageCompartmentRef.current.reconfigure(language) });
    });
    languageReadyRef.current = ready;
    return () => {
      cancelled = true;
    };
  }, [path, markiiEnabled]);

  // `.mk.md` directive decorations, threaded with the currently ENABLED
  // packs and this note's already-persisted script values (Phase M3,
  // worker 3 — see `loadMkMdDecorations`'s own doc). Runs once at mount
  // (alongside the language effect above — a fresh mount always has no
  // syntax tree yet either way, so there is no ordering hazard between
  // the two on FIRST load) and again every time `runVersion` bumps (a
  // manual run just finished for this exact path, `useMarkiiStore
  // .runNote`) or the enabled-packs set changes — never on any other
  // render, and never as a side effect of anything but a real run/pack
  // change, per this file's and `runScripts.ts`'s "rendering is pure"
  // rule.
  const runVersion = useMarkiiStore((s) => s.runVersions[path] ?? 0);
  const enabledPacks = useMarkiiStore(useShallow(selectEnabledPacks));
  useEffect(() => {
    if (!isMkMdPath(path)) return;
    let cancelled = false;
    // R5-9 — the master `Enabled` switch OR the finer "directive rendering
    // in live preview" toggle (Rendering section of the extension page)
    // being off both mean: no decorations, full stop. Skip the persisted-
    // values load entirely rather than compute decorations nobody sees.
    if (!markiiEnabled || !directiveRenderingEnabled) {
      const view = viewRef.current;
      if (view) view.dispatch({ effects: mkMdDecorationsCompartmentRef.current.reconfigure([]) });
      return;
    }
    (async () => {
      // R5-9 — wait for this render's language reconfigure to actually
      // land before reading the syntax tree (see `languageReadyRef`'s own
      // doc above for the race this avoids).
      await languageReadyRef.current;
      if (cancelled) return;
      const persisted = await loadPersistedValues(path).catch(() => undefined);
      if (cancelled) return;
      const valueStore = hydrateValueStore(persisted);
      const decorations = await loadMkMdDecorations(enabledPacks, valueStore, revealHintEnabled);
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: mkMdDecorationsCompartmentRef.current.reconfigure(decorations) });
    })();
    return () => {
      cancelled = true;
    };
    // `path` is fixed for this mount (see the comment above); `runVersion`,
    // `enabledPacks`, and the two Markii extension toggles are what
    // legitimately change under a live instance and must re-trigger this
    // effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runVersion, enabledPacks, markiiEnabled, directiveRenderingEnabled, revealHintEnabled]);

  // `.mk.md` directive completion/hover/insert (R3-12) — see this file's
  // module doc, point 3. Runs once at mount, same "`path` fixed for this
  // mount" reasoning as the language effect above; no dependency on
  // `runVersion`/`enabledPacks` (pack-awareness for completion/hover is
  // module-level state inside `markiiCompletion.ts` itself, set by
  // `setMarkiiDiscoveredPacks` and read fresh on every keystroke/hover —
  // this bundle doesn't need to be re-installed when packs change).
  useEffect(() => {
    if (!isMkMdPath(path)) return;
    // R5-9 — same master switch, plus the Editor section's own
    // "Completion" toggle: either off means no directive completion/hover.
    if (!markiiEnabled || !completionEnabled) {
      const view = viewRef.current;
      if (view) view.dispatch({ effects: mkMdCompletionCompartmentRef.current.reconfigure([]) });
      return;
    }
    let cancelled = false;
    loadMkMdCompletionExtensions(fenceSugarEnabled).then((extensions) => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: mkMdCompletionCompartmentRef.current.reconfigure(extensions) });
    });
    return () => {
      cancelled = true;
    };
  }, [path, markiiEnabled, completionEnabled, fenceSugarEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Our own last edit echoing back through `useBufferStore` — skip the
    // redundant re-serialize + dispatch (see `lastEmittedRef` above).
    if (content === lastEmittedRef.current) {
      lastEmittedRef.current = null;
      return;
    }
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  // DESIGN-SPEC token mapping onto atomic-editor's CSS variables — restyle
  // at the variable layer only, never by overriding library rules (repo
  // rule 1). Recomputed per render; the vars cascade into the editor DOM.
  const wrapperStyle = {
    paddingInline: `${margin}px`,
    "--atomic-editor-font": "var(--font-sans)",
    "--atomic-editor-font-mono": "var(--font-mono)",
    "--atomic-editor-body-size": `${renderedFontSize(fontSize)}px`,
    "--atomic-editor-body-leading": String(lineSpacing),
    // R5-7: same value, under the token name `.mk-doc` (the static
    // renderer — `theme.css`, `index.css`'s `:root` default) and
    // `.mk-live-preview-block` (this file's own directive widgets) read —
    // see `index.css`'s `--mk-line-height` doc for why this is the single
    // source of truth both surfaces derive from, and `theme.css`'s Tier 2
    // markii-token block for why the derivation is scoped per-element
    // rather than at a single root.
    "--mk-line-height": String(lineSpacing),
    // Amendments round 4 item 25: "Full" removes the cap entirely rather
    // than clamping to a large ch value.
    "--atomic-editor-measure":
      contentWidth === RENDERED_CONTENT_WIDTH_FULL ? "none" : `${contentWidth}ch`,
    "--atomic-editor-fg": "var(--markdown-body)",
    "--atomic-editor-fg-muted": "var(--color-muted)",
    "--atomic-editor-accent": "var(--color-primary)",
    "--atomic-editor-accent-bright": "var(--color-primary)",
    "--atomic-editor-link": "var(--color-accent-text, var(--color-primary))",
    "--atomic-editor-selection-bg":
      "color-mix(in oklab, var(--color-primary) 25%, transparent)",
    // Spec correction: fenced code sits flush on the editor surface — no
    // raised panel behind it.
    "--atomic-editor-code-bg": "transparent",
    // Code token color follows the same `--syntax-string` role token Source
    // mode highlights with (Amendments round 3 item 22(b)).
    "--atomic-editor-hl-string": "var(--syntax-string)",
  } as CSSProperties;

  return (
    <div className="vsnote-live-preview" style={wrapperStyle} data-testid="live-preview-root">
      <AtomicCodeMirrorEditor
        documentId={path}
        markdownSource={content}
        readOnly={readOnly}
        codeLanguages={codeLanguages}
        extensions={extraExtensions}
        editorHandleRef={handleRef}
        onMarkdownChange={(md) => {
          lastEmittedRef.current = md;
          onChangeRef.current?.(md);
        }}
        onLinkClick={(url) => onOpenLinkRef.current?.(url)}
      />
    </div>
  );
}

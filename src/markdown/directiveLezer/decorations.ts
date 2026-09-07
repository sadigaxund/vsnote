/**
 * CM6 decorations for markii's three directive forms (docs/PLAN-2026-09-05-refresh.md
 * §6 Phase M2, deliverables 2 and 3) — the Obsidian live-preview rule
 * (DESIGN-SPEC item 61 and earlier: "raw syntax revealed only around the
 * cursor, instant re-render on leave") applied to `MkDirectiveContainer`/
 * `MkDirectiveLeaf` (block widgets) and `MkDirectiveText` (inline widgets),
 * the node types `extension.ts`'s Lezer grammar produces.
 *
 * Like `extension.ts`, this file imports only CM6 + markii packages, no
 * VSNote application state — the other half of the "could be lifted out as
 * `@markii/codemirror`" deliverable. `src/editor/LivePreviewEditor.tsx` is
 * the one integration point that wires this into the app, gated to
 * `.mk.md` (see that file's own doc).
 *
 * ---- Two providers, not one: CM6 forbids block decorations from a plugin ----
 * The first working version of this file used a single `ViewPlugin` for
 * both block and inline decorations. CM6 throws at runtime — "Block
 * decorations may not be specified via plugins" — the moment a
 * `Decoration.replace({..., block: true})` comes from a `ViewPlugin`'s
 * `decorations` facet provider; block-level decorations are only accepted
 * from a `StateField` (undocumented in `@codemirror/view`'s own `.d.ts`,
 * confirmed by hitting the runtime error). So this file provides two
 * independent decoration sources, combined by `markiiLivePreviewDecorations`:
 *
 *   - `MK_DIRECTIVE_CONTAINER`/`MK_DIRECTIVE_LEAF` (block widgets) via a
 *     `StateField`, recomputed on any transaction that changes the
 *     document or the selection.
 *   - `MK_DIRECTIVE_TEXT` (inline widgets) via a `ViewPlugin`, which CAN
 *     use `view.visibleRanges` (a `StateField` has no `EditorView` to ask)
 *     since ordinary (non-block) decorations from a plugin are fine.
 *
 * ---- Rendering: `renderMark` + `renderToStaticMarkup`, never a React root ----
 * Requirement 5 ("rendering inside a decoration must stay side-effect-free:
 * it reads cached values only and never executes anything") is met by
 * rendering each directive's raw source through `@markii/react`'s
 * `renderMark` (parse -> hast -> React, the same pipeline
 * `src/markdown/render.tsx` uses for the rest of the app) and then
 * `react-dom/server`'s `renderToStaticMarkup` — a pure, synchronous
 * string-in/string-out call with no commit phase, no effects, no event
 * handlers attached, and (critically, since M3's scripts are explicitly
 * NOT part of render) no possibility of executing anything: static markup
 * has nowhere for a script to run. The resulting HTML string becomes a
 * widget DOM node's `innerHTML` directly — no React root is ever mounted
 * inside a CM6 decoration, so there's no lifecycle to keep in sync with
 * CM6's own reconciliation (a real risk `Decoration.widget` + a live React
 * root would otherwise carry).
 *
 * `defaultRegistry` (no VSNote-specific directives merged in, unlike
 * `render.tsx`'s full pipeline) is used here on purpose: this module has no
 * VSNote app-state coupling, so it cannot reach VSNote's own `vsnote-code`
 * directive (fenced code -> `CodeBlock` swap) or link-map resolution
 * without breaking that constraint. A fenced code block INSIDE a directive
 * shown in a collapsed live-preview widget therefore renders as a plain,
 * unhighlighted `<pre><code>` rather than through VSNote's syntax
 * highlighter — see `docs/ARCHITECTURE.md`'s markdown pipeline section for
 * this documented as a known scope limitation, not an oversight.
 *
 * ---- Performance ----
 * The inline `ViewPlugin` walks `syntaxTree(state)` ONLY across
 * `view.visibleRanges` (CM6's own viewport-tracking, already incremental).
 * The block `StateField` cannot do the same (no viewport to ask), so it
 * walks the whole tree — still not a re-PARSE (the tree itself is already
 * incrementally maintained by `@codemirror/language`; this file does no
 * parsing of its own), just an O(node count) traversal, which is the
 * accepted cost of a `StateField`-provided block decoration in CM6 (the
 * same cost code-folding and `@codemirror/merge`'s own gutter markers pay).
 * Both providers share one `renderedHtmlCache` (`Map`, created once per
 * `markiiLivePreviewDecorations()` call — i.e. once per `.mk.md` editor
 * instance, see `LivePreviewEditor.tsx`), keyed by the exact source slice,
 * so an unrelated edit elsewhere in the document can't invalidate an
 * unrelated directive's cached render, and a cursor moving in and out of a
 * directive (or the viewport scrolling past one repeatedly) never re-runs
 * `renderMark`/`renderToStaticMarkup` for unchanged source text.
 * `MAX_CACHE_ENTRIES` bounds it the same way `csvLogic.ts`/`jsonLogic.ts`
 * bound their DOM output (see `tests/unit/rendererBigFileCaps.test.ts`'s
 * "caps convention") — a large `.mk.md` with thousands of distinct
 * directives scrolled through in one session evicts the oldest entries
 * rather than growing unbounded.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "@markii/core";
import { createRegistry, renderMark, renderMarkNode, type Registry } from "@markii/react";
import { defaultRegistry } from "@markii/react/components";
import type { ValueStore } from "@markii/runtime";
import "@markii/react/doc.css";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { EditorSelection, Prec, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { MK_DIRECTIVE_CONTAINER, MK_DIRECTIVE_LEAF, MK_DIRECTIVE_TEXT } from "./extension";
import { buildPackRegistry, type PackForRegistry } from "../packPlaceholderLogic";

/**
 * Builds the registry used for every directive rendered by a live-preview
 * widget: `defaultRegistry` alone (see module doc for why this file has no
 * VSNote app-state coupling), plus (worker 2, Phase M3) a placeholder entry
 * per enabled pack's declared component, so a `:::ns_component` directive
 * shows the SAME labelled "not rendered (JS component)" box the static
 * renderer shows, never a raw unknown-directive box that gives no reason.
 * `enabledPacks` is a plain data array the CALLER (`LivePreviewEditor.tsx`)
 * supplies per editor instance — this module still reaches no app store or
 * global state of its own.
 */
function buildRegistry(enabledPacks: readonly PackForRegistry[]): Registry {
  if (enabledPacks.length === 0) return createRegistry(defaultRegistry);
  const packInstall = buildPackRegistry(enabledPacks);
  const packRegistry = packInstall.ok ? packInstall.registry : {};
  return createRegistry({ ...defaultRegistry, ...packRegistry });
}

/** Caps convention (see module doc) — an editor session touching more distinct directive source strings than this within one document evicts its oldest cache entries rather than growing unbounded. Generous: a real `.mk.md` file has, realistically, tens of directives, not thousands. */
const MAX_CACHE_ENTRIES = 500;

function cacheAndReturn(cache: Map<string, string>, source: string, html: string): string {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(source, html);
  return html;
}

/**
 * Renders a container/leaf directive's raw source (the whole span
 * `renderMark` would parse as one or more top-level block nodes) to a
 * static HTML string, memoized by the exact source text. Never throws —
 * `renderMark` itself never throws (see its own doc), and this function
 * does nothing else that could.
 *
 * `valueStore` (Phase M3, worker 3 — a note's previously-persisted script
 * values, never live-executed here, see this file's own doc and
 * `runScripts.ts`'s "rendering is pure" rule) deliberately bypasses the
 * memoization cache: a `ValueStore` is a mutable object whose CONTENTS can
 * change between two calls with the exact same `source` string (a run
 * just produced a new value for the SAME `:value[name]` directive), and
 * this file has no cheap way to detect that from the source text alone.
 * Recompute is rare in practice — it only happens when the whole
 * decorations extension is reconfigured after a real run, not on every
 * cursor move/keystroke — so paying the render cost fresh each time a
 * value store is present is the simpler, correct choice over inventing a
 * version-keyed cache.
 */
function renderBlockDirectiveHtml(cache: Map<string, string>, source: string, registry: Registry, valueStore: ValueStore | undefined): string {
  if (valueStore) return renderToStaticMarkup(renderMark(source, registry, valueStore));
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  return cacheAndReturn(cache, source, renderToStaticMarkup(renderMark(source, registry)));
}

/**
 * Renders an INLINE text directive's raw source (e.g. `:badge[New]{}`
 * alone, with nothing else around it). `renderMark` always parses its
 * input as a full document, so handing it a bare inline directive's source
 * produces a `paragraph` wrapping it — a `<p>` in the output, which is
 * invalid inside the inline `<span>` this widget renders into (and visibly
 * broke the layout: the directive forced a line break before and after
 * itself). Parsing with `@markii/core`'s own `parse` and pulling the
 * directive node back out of that synthetic paragraph before handing it to
 * `renderMarkNode` (the block-level twin of `renderMark` that takes an
 * already-parsed node — see `render.tsx`'s own doc for why `renderMarkNode`
 * takes one `RootContent`, not a `Root`) renders just the directive itself,
 * with no wrapper. Falls back to the `renderMark` behavior (still safe,
 * just visually wrong, never a crash) if the parse doesn't come back in
 * the exact shape expected — belt and braces, not because this has been
 * observed to happen.
 */
function renderInlineDirectiveHtml(cache: Map<string, string>, source: string, registry: Registry, valueStore: ValueStore | undefined): string {
  if (!valueStore) {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
  }
  const root = parse(source);
  const firstChild = root.children[0];
  const directiveNode =
    firstChild && "children" in firstChild && Array.isArray(firstChild.children) ? firstChild.children[0] : undefined;
  const html = renderToStaticMarkup(
    directiveNode ? renderMarkNode(directiveNode, registry, valueStore) : renderMark(source, registry, valueStore),
  );
  if (valueStore) return html;
  return cacheAndReturn(cache, source, html);
}

/** Shared by both widget classes below — a `<div>`/`<span>` whose content is the cached static markup, nothing else attached. */
function buildWidgetDom(tag: "div" | "span", html: string, className: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  // `renderMark` already runs every render through `@markii/core`'s
  // URL/attribute sanitizer (see render.tsx's own doc) before this string
  // exists at all — the same trust boundary the rest of the app's static
  // renderer relies on, just serialized to a string instead of React
  // elements (see this file's module doc for why a string, not a mounted
  // React root).
  el.innerHTML = html;
  return el;
}

class MkBlockDirectiveWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly cache: Map<string, string>,
    private readonly registry: Registry,
    private readonly valueStore: ValueStore | undefined,
  ) {
    super();
  }
  eq(other: MkBlockDirectiveWidget): boolean {
    // A live value store means this widget's rendered HTML can change
    // between two decoration recomputes even when `source`/`registry`
    // didn't (see `renderBlockDirectiveHtml`'s doc) — never claim equal
    // (i.e. never skip a DOM rebuild) whenever either side has one.
    if (this.valueStore || other.valueStore) return false;
    return other.source === this.source && other.registry === this.registry;
  }
  toDOM(): HTMLElement {
    return buildWidgetDom("div", renderBlockDirectiveHtml(this.cache, this.source, this.registry, this.valueStore), "mk-live-preview-block");
  }
  ignoreEvent(): boolean {
    return false; // let clicks land normally (e.g. a link inside the rendered directive) rather than swallowing every interaction.
  }
}

/**
 * R3-11 — a small muted inline hint shown at the END of a revealed
 * directive/fence, reading "rendered when the cursor leaves", so the
 * Obsidian live-preview rule (raw source only while the caret is inside,
 * instant re-render on leave — item 61) is discoverable rather than a
 * silent behavior a user has to notice on their own. `aria-hidden` + a
 * no-op `ignoreEvent`/ `coordsAt`-inert `WidgetType`: it's a passing visual
 * aid, never a focusable or announced element, so it adds nothing for the
 * accessibility/reflow audit (`tests/e2e/ui-audit.spec.ts`) to flag.
 *
 * Module-level `hintShownThisSession` (not per-editor-instance, not
 * persisted) — "ONCE PER SESSION" per the task brief: the first time ANY
 * `.mk.md` editor in this browser tab reveals a directive, the hint
 * appears once and never again for the rest of the session (a reload
 * resets it, same as any other "seen this already" in-memory flag in this
 * codebase). Set synchronously inside the (pure, synchronous) decoration
 * build itself — the same place that decides a reveal is happening at all
 * — rather than from some separate effect, so there's no window where two
 * simultaneous reveals (two split panes on two different `.mk.md` files)
 * could each show it once.
 */
let hintShownThisSession = false;

class RevealHintWidget extends WidgetType {
  eq(): boolean {
    return true; // stateless — any two instances render identically.
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "mk-reveal-hint";
    el.setAttribute("aria-hidden", "true");
    el.textContent = "rendered when the cursor leaves";
    return el;
  }
  ignoreEvent(): boolean {
    return true; // purely decorative — never intercepts a click/selection.
  }
}

/** Pushes the once-per-session reveal hint at `pos` (a directive/fence's
 * end) onto `decorations`, iff it hasn't been shown yet this session.
 * Shared by both the block `StateField` and the inline `ViewPlugin` below. */
function maybePushRevealHint(decorations: Range<Decoration>[], pos: number): void {
  if (hintShownThisSession) return;
  hintShownThisSession = true;
  decorations.push(Decoration.widget({ widget: new RevealHintWidget(), side: 1 }).range(pos));
}

class MkInlineDirectiveWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly cache: Map<string, string>,
    private readonly registry: Registry,
    private readonly valueStore: ValueStore | undefined,
  ) {
    super();
  }
  eq(other: MkInlineDirectiveWidget): boolean {
    if (this.valueStore || other.valueStore) return false;
    return other.source === this.source && other.registry === this.registry;
  }
  toDOM(): HTMLElement {
    return buildWidgetDom("span", renderInlineDirectiveHtml(this.cache, this.source, this.registry, this.valueStore), "mk-live-preview-inline");
  }
}

/**
 * `syntaxTree(state)` returns the parser's best-effort CURRENT tree —
 * `@codemirror/language` reparses incrementally on an idle callback, so
 * immediately after a language reconfigure (exactly what
 * `LivePreviewEditor.tsx`'s `.mk.md` override does) it can still be the
 * OLD language's tree until that background work catches up, with no
 * `docChanged`/`selectionSet` transaction along the way to prompt a
 * recompute. `ensureSyntaxTree(state, to, timeout)` forces a synchronous
 * parse up to `to` within a small budget instead of waiting — the
 * documented way to get a complete-enough tree "now" rather than
 * "eventually" for exactly this kind of one-shot read. `SYNTAX_TREE_TIMEOUT_MS`
 * is generous for a live-preview editor's realistic document sizes; for a
 * document too large to finish in the budget this falls back to whatever
 * `syntaxTree` already has, same as before this fix — a directive whose
 * span hasn't been reached yet just doesn't get a widget until parsing
 * catches up, never a hang.
 */
const SYNTAX_TREE_TIMEOUT_MS = 50;

function treeFor(state: EditorState, to: number) {
  return ensureSyntaxTree(state, to, SYNTAX_TREE_TIMEOUT_MS) ?? syntaxTree(state);
}

/** Does any selection range overlap `[from, to]` (inclusive of both edges — placing the cursor exactly at a directive's boundary counts as "inside", matching Obsidian's own live-preview feel: you can arrow-key right up to the edge and immediately see raw source). */
function cursorTouches(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true;
  }
  return false;
}

/**
 * `pos`'s enclosing `MK_DIRECTIVE_CONTAINER`/`MK_DIRECTIVE_LEAF` node, if
 * `pos` sits STRICTLY inside it (excluding both boundaries — a boundary
 * position already satisfies `cursorTouches` and gets the raw-source
 * decoration on its own, so vertical motion landing exactly on `from`/`to`
 * needs no correction). Used only by `mkBlockVerticalNavigation` below.
 */
function findEnclosingBlockRange(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = treeFor(state, state.doc.length);
  let found: { from: number; to: number } | null = null;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (node.name !== MK_DIRECTIVE_CONTAINER && node.name !== MK_DIRECTIVE_LEAF) return undefined;
      if (pos > node.from && pos < node.to) found = { from: node.from, to: node.to };
      return false; // never need to descend into a directive's own children for this check.
    },
  });
  return found;
}

/**
 * ArrowUp/ArrowDown into a collapsed directive container/leaf (the block
 * widget from `buildBlockDecorations` above) — without this, the caret gets
 * visually stuck at the widget's right/bottom edge instead of entering it.
 *
 * Root cause: `Decoration.replace({..., block: true})` swaps the directive's
 * source lines for ONE widget `<div>` with no text nodes inside. CM6's
 * default `cursorLineDown`/`cursorLineUp` (`@codemirror/commands`) resolve
 * vertical motion by asking the CURRENT (pre-transaction) layout for the
 * document position nearest the target y/x — decorations haven't been
 * recomputed against the new selection yet (the `blockField` `StateField`
 * above only reacts to a transaction AFTER it's dispatched), so that lookup
 * still sees the collapsed widget's row. With no glyph to land the caret's
 * x-preserving column on, the browser/CM6 resolve it to whichever real text
 * boundary is nearest on that row — empirically the range's END (`to`),
 * i.e. visually the widget's right edge, stretched to the whole widget's
 * height since that's the row's only box. This is the block decoration
 * making the range act atomic for cursor placement, without it being
 * listed in `EditorView.atomicRanges` (that facet isn't involved here —
 * plain vertical motion through a `block: true` replace decoration exhibits
 * the same "no text to land in" problem `atomicRanges` is normally used to
 * paper over).
 *
 * The fix extends the existing cursor-reveal predicate (`cursorTouches`,
 * used by `buildBlockDecorations`/`buildInlineDecorations` to decide when
 * to show raw source) to this case: run CM6's default vertical motion
 * first, then check whether the result landed strictly inside a directive
 * range while the ORIGINAL position was outside it (i.e. this keypress is
 * what's crossing the boundary). If so, snap the selection to the range's
 * `from` (entering from above — lands on the directive's own first/opening
 * fence line) or `to` (entering from below — lands on its last/closing
 * fence line) instead of wherever the pre-decoration-update motion guessed.
 * That dispatches a second, selection-only transaction, which the block
 * `StateField` DOES see before rendering (its `update` recomputes on any
 * selection change), so the directive is already showing raw, editable
 * source lines by the time this command returns — the caret lands on real
 * text, not the widget.
 */
function mkBlockVerticalNavigation(direction: 1 | -1) {
  return (view: EditorView): boolean => {
    const before = view.state.selection.main.head;
    const ran = direction === 1 ? cursorLineDown(view) : cursorLineUp(view);
    if (!ran) return ran;
    const after = view.state.selection.main;
    if (!after.empty) return true; // a shift-selection variant isn't this command's concern.
    const range = findEnclosingBlockRange(view.state, after.head);
    if (!range) return true;
    // Only correct a genuine crossing INTO the range from outside it — a
    // move that already started inside (or on its edge) already has real,
    // revealed source lines to navigate within, and needs no help.
    const enteredFromOutside = direction === 1 ? before <= range.from : before >= range.to;
    if (!enteredFromOutside) return true;
    const target = direction === 1 ? range.from : range.to;
    if (after.head !== target) {
      view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
    }
    return true;
  };
}

/**
 * `Prec.highest` so this always gets first crack at ArrowUp/ArrowDown
 * ahead of `@codemirror/commands`' `standardKeymap`/`defaultKeymap`
 * (`cursorLineDown`/`cursorLineUp` themselves, or atomic-editor's own copy
 * of them) — those bind the same keys at ordinary precedence, and CM6's
 * keymap facet tries higher-precedence handlers first, falling through to
 * the next one whenever a `run` returns `false`. `mkBlockVerticalNavigation`
 * always returns whatever the default command returned (`true` once the
 * document has any content, since a no-op default already reports that as
 * "handled"), so plain ArrowUp/ArrowDown everywhere else in the document —
 * every position with no enclosing directive — behaves exactly as before;
 * this only ever changes the RESULT of the default motion when it lands
 * inside a directive block per `mkBlockVerticalNavigation`'s own doc.
 */
const mkBlockNavigationKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: mkBlockVerticalNavigation(1) },
    { key: "ArrowUp", run: mkBlockVerticalNavigation(-1) },
  ]),
);

function buildBlockDecorations(state: EditorState, cache: Map<string, string>, registry: Registry, valueStore: ValueStore | undefined): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = treeFor(state, state.doc.length);
  const doc = state.doc;

  tree.iterate({
    enter(node) {
      if (node.name !== MK_DIRECTIVE_CONTAINER && node.name !== MK_DIRECTIVE_LEAF) return undefined;
      const { from, to } = node;
      if (cursorTouches(state, from, to)) {
        // Reveal raw source; still skip descending, nothing nested needs
        // its own decoration. R3-11: the discoverability hint goes here —
        // this IS "a revealed directive or fence."
        maybePushRevealHint(decorations, to);
        return false;
      }
      const source = doc.sliceString(from, to);
      decorations.push(
        Decoration.replace({
          widget: new MkBlockDirectiveWidget(source, cache, registry, valueStore),
          block: true,
          inclusive: false,
        }).range(from, to),
      );
      return false;
    },
  });

  return Decoration.set(decorations, true);
}

function buildInlineDecorations(view: EditorView, cache: Map<string, string>, registry: Registry, valueStore: ValueStore | undefined): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const state = view.state;
  const doc = state.doc;

  for (const { from: rangeFrom, to: rangeTo } of view.visibleRanges) {
    const tree = treeFor(state, rangeTo);
    tree.iterate({
      from: rangeFrom,
      to: rangeTo,
      enter(node) {
        if (node.name !== MK_DIRECTIVE_TEXT) return undefined;
        const { from, to } = node;
        if (cursorTouches(state, from, to)) {
          maybePushRevealHint(decorations, to);
          return undefined;
        }
        const source = doc.sliceString(from, to);
        decorations.push(
          Decoration.replace({
            widget: new MkInlineDirectiveWidget(source, cache, registry, valueStore),
            inclusive: false,
          }).range(from, to),
        );
        return false;
      },
    });
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

const mkLivePreviewTheme = EditorView.baseTheme({
  ".mk-live-preview-block": {
    display: "block",
    padding: "2px 0",
  },
  ".mk-live-preview-inline": {
    display: "inline",
  },
  // R3-11's once-per-session reveal hint (see `RevealHintWidget`) — muted
  // and small enough to read as a caption, never mistaken for document
  // content; `user-select: none` so it can't end up copied into a paste.
  ".mk-reveal-hint": {
    display: "inline",
    marginLeft: "0.5em",
    fontSize: "0.85em",
    fontStyle: "italic",
    color: "var(--color-muted, #888)",
    userSelect: "none",
  },
});

/**
 * The full decorations extension for `.mk.md` live preview. Combine with a
 * language whose parser includes `markiiDirectiveGrammar` (`extension.ts`)
 * — without that, `syntaxTree` never has `MkDirective*` nodes to find and
 * this extension is a harmless no-op. Call once per editor instance (see
 * module doc's cache-sharing note) — `LivePreviewEditor.tsx` does this
 * exactly once per `.mk.md` mount.
 *
 * `enabledPacks` (worker 2, Phase M3, default `[]`) is plain data the
 * caller already has (e.g. from `platform/browser`'s `PackStore.list()`)
 * — see `buildRegistry`'s doc comment above for why this file still takes
 * it as a parameter rather than reaching for app state itself.
 *
 * `valueStore` (worker 3, Phase M3) is likewise plain data the caller
 * already loaded (`LivePreviewEditor.tsx`: `loadPersistedValues` +
 * `hydrateValueStore`, a pure READ of a previous run's cached values,
 * never a script execution — see `runScripts.ts`'s "rendering is pure"
 * rule). Passed straight through to every directive render so a
 * `:value[name]` directive resolves against it; omitted, `:value[]`
 * renders its own built-in "missing" marker, unchanged from before this
 * parameter existed. Because `LivePreviewEditor.tsx` calls this function
 * again (with a freshly-hydrated store) every time a run finishes for the
 * open note — reconfiguring the whole decorations `Extension` via its own
 * `Compartment`, the SAME mechanism it already uses for the initial
 * language/decorations load — a stale store is never held onto past a
 * real run.
 */
export function markiiLivePreviewDecorations(enabledPacks: readonly PackForRegistry[] = [], valueStore?: ValueStore): Extension[] {
  const cache = new Map<string, string>();
  const registry = buildRegistry(enabledPacks);

  const blockField = StateField.define<DecorationSet>({
    create(state) {
      return buildBlockDecorations(state, cache, registry, valueStore);
    },
    update(value, tr) {
      if (!tr.docChanged && tr.startState.selection.eq(tr.state.selection)) return value;
      return buildBlockDecorations(tr.state, cache, registry, valueStore);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const inlinePlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInlineDecorations(view, cache, registry, valueStore);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildInlineDecorations(update.view, cache, registry, valueStore);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [blockField, inlinePlugin, mkLivePreviewTheme, mkBlockNavigationKeymap];
}

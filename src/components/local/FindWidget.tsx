/**
 * FindWidget — VSCode-style floating find/replace card (DESIGN-SPEC
 * Amendments item 9, matched against `search.png`). Replaces
 * `@codemirror/search`'s stock vanilla-JS `SearchPanel` (the "old looking"
 * panel the user called out) with a React component composed from
 * `my-you-eye`'s `Input`/`Button`/`Tooltip`, mounted by `editor/findPanel.ts`
 * as that same extension's `createPanel` override.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("FindWidget", status `built-locally`,
 * used by `editor/findPanel.ts`). Nothing in the catalog composes a floating
 * find/replace card with live match counting bound to a CodeMirror search
 * state — this is a genuinely new UI shape, not a restyle of an existing
 * primitive.
 *
 * Deliberately still drives the REAL `@codemirror/search` state (`search-
 * State`/`setSearchQuery`/`findNext`/`findPrevious`/`replaceNext`/
 * `replaceAll`/`selectMatches`) instead of hand-rolling match highlighting —
 * `@codemirror/search`'s own `searchHighlighter` plugin (Prec.low,
 * `.cm-searchMatch`/`.cm-searchMatch-selected`) renders decorations purely
 * from that shared state field, so as long as this component only ever
 * *dispatches* into it, highlighting stays native and free. The one place
 * this component computes its own state is the "1 of N" counter (not part
 * of `@codemirror/search`'s public surface at all) via `SearchQuery
 * .getCursor()`, the same public API `find`/`replace` commands use
 * internally.
 *
 * Mounted in its OWN React root (`editor/findPanel.ts`'s `createRoot`), NOT
 * inside the app's main tree — every keystroke typed into the Find/Replace
 * inputs re-renders only this isolated root, never `App` (DESIGN-SPEC
 * Amendments item 16's perf contract: "a keystroke must be handled without
 * re-rendering the React shell" — extended here to the find widget's own
 * typing, not just the editor buffer's).
 *
 * "Preserve case" (the `AB` toggle, row 2): a real, working feature layered
 * OUTSIDE `@codemirror/search`'s public replace path rather than a static
 * label pretending to work — `SearchQuery` has no `getReplacement` in its
 * public API (checked `@codemirror/search/dist/index.d.ts`; it's used
 * internally by `replaceNext`/`replaceAll` but not exported), so this
 * component can't ask the library to case-adjust each match's replacement
 * text on the way in. Implemented instead as a small, self-contained
 * heuristic (upper/lower/capitalized/mixed, the same four buckets VSCode's
 * own Preserve Case uses) applied per match via `query.getCursor()` +
 * `view.dispatch({changes})` directly — scoped to non-regex searches only
 * (a regex match's replacement can reference capture groups, which this
 * heuristic doesn't attempt to parse; native `replaceNext`/`replaceAll`
 * stay wired for every other case, including preserve-case OFF, so the
 * common path is always the fully-native one).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { Button, Input, Tooltip } from "my-you-eye";
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";

const MATCH_COUNT_CAP = 2000;

interface QueryFields {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

function readQuery(view: EditorView): QueryFields {
  const q = getSearchQuery(view.state);
  return { search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, regexp: q.regexp };
}

type CasePattern = "upper" | "lower" | "capital" | "mixed";

function caseOf(word: string): CasePattern {
  if (!word) return "mixed";
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return "upper";
  if (word === word.toLowerCase()) return "lower";
  if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) return "capital";
  return "mixed";
}

function applyCase(replacement: string, pattern: CasePattern): string {
  switch (pattern) {
    case "upper":
      return replacement.toUpperCase();
    case "lower":
      return replacement.toLowerCase();
    case "capital":
      return replacement.length ? replacement[0].toUpperCase() + replacement.slice(1).toLowerCase() : replacement;
    default:
      return replacement;
  }
}

/** Mirrors `findNext`'s own "search forward from the selection, wrap at the
 * end" semantics (`@codemirror/search`'s private `nextMatch`), built only
 * from the public `SearchQuery.getCursor()` — needed here (rather than just
 * calling `findNext`) because Preserve Case must see the match's text
 * BEFORE replacing it. */
function findNextMatchRange(view: EditorView, query: SearchQuery): { from: number; to: number } | null {
  const { state } = view;
  const { to } = state.selection.main;
  let cursor = query.getCursor(state, to);
  let res = cursor.next();
  if (!res.done) return res.value;
  cursor = query.getCursor(state, 0, to);
  res = cursor.next();
  return res.done ? null : res.value;
}

function performReplaceOne(view: EditorView, preserveCase: boolean): void {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return;
  if (!preserveCase || query.regexp) {
    replaceNext(view);
    return;
  }
  const match = findNextMatchRange(view, query);
  if (!match) return;
  const matched = view.state.sliceDoc(match.from, match.to);
  const replacement = applyCase(query.replace, caseOf(matched));
  view.dispatch({
    changes: { from: match.from, to: match.to, insert: replacement },
    selection: { anchor: match.from, head: match.from + replacement.length },
    scrollIntoView: true,
    userEvent: "input.replace",
  });
}

function performReplaceAll(view: EditorView, preserveCase: boolean): void {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return;
  if (!preserveCase || query.regexp) {
    replaceAll(view);
    return;
  }
  const { state } = view;
  const cursor = query.getCursor(state);
  const changes: { from: number; to: number; insert: string }[] = [];
  let res = cursor.next();
  while (!res.done && changes.length < MATCH_COUNT_CAP) {
    const { from, to } = res.value;
    changes.push({ from, to, insert: applyCase(query.replace, caseOf(state.sliceDoc(from, to))) });
    res = cursor.next();
  }
  if (!changes.length) return;
  view.dispatch({ changes, userEvent: "input.replace.all" });
}

export interface FindWidgetProps {
  view: EditorView;
  /** Called by `editor/findPanel.ts`'s Panel `update(update)` hook on every
   * CM6 view update while this widget is mounted — the bridge that lets a
   * doc edit typed directly into the editor (or a native `findNext`/
   * `replaceAll` dispatch) refresh this component's match count without
   * this component needing its own `EditorView.updateListener` extension
   * (adding one after the view already exists would need a `Compartment`
   * this component doesn't own). */
  registerUpdateListener: (fn: (update: ViewUpdate) => void) => void;
}

export function FindWidget({ view, registerUpdateListener }: FindWidgetProps) {
  // DiffView's two read-only panes (`readOnlyBaseExtensions`, "a viewer, not
  // a revert tool") never get a replace row at all — read straight off the
  // view's own state rather than a separate prop `editor/findPanel.ts` would
  // otherwise have to thread through.
  const readOnly = view.state.readOnly;
  const initial = useMemo(() => readQuery(view), [view]);
  const [search, setSearch] = useState(initial.search);
  const [replace, setReplace] = useState(initial.replace);
  const [caseSensitive, setCaseSensitive] = useState(initial.caseSensitive);
  const [wholeWord, setWholeWord] = useState(initial.wholeWord);
  const [regexp, setRegexp] = useState(initial.regexp);
  const [preserveCase, setPreserveCase] = useState(false);
  // Row 2 (replace) only when the chevron is expanded — DESIGN-SPEC item 9.
  const [expanded, setExpanded] = useState(false);
  // Bumped by `registerUpdateListener` on any doc/selection change so the
  // match counter recomputes after a native findNext/replace dispatch (its
  // own `useMemo` below can't see those otherwise, since they don't flow
  // through this component's own state setters).
  const [version, setVersion] = useState(0);

  // `HTMLInputElement | null` (not just `HTMLInputElement`) so this is a
  // mutable `MutableRefObject` — the imperative ref callback below writes
  // `.current` itself (to also set the `main-field` attribute), which
  // React's `RefObject<T>` overload (inferred from `useRef<T>(null)` with a
  // non-nullable `T`) makes read-only.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  useEffect(() => {
    registerUpdateListener((update: ViewUpdate) => {
      let queryChanged = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) queryChanged = true;
        }
      }
      if (queryChanged) {
        // An external `setSearchQuery` dispatch (e.g. `openSearchPanel`'s
        // "already open, re-focus + refresh from the new selection" branch
        // when ⌘F is pressed again with different text selected) — resync
        // every field from CM6's own state so this widget never drifts from
        // what's actually driving the highlighter.
        const q = readQuery(view);
        setSearch(q.search);
        setReplace(q.replace);
        setCaseSensitive(q.caseSensitive);
        setWholeWord(q.wholeWord);
        setRegexp(q.regexp);
      }
      if (queryChanged || update.docChanged || update.selectionSet) {
        setVersion((v) => v + 1);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dispatchQuery(patch: Partial<QueryFields>) {
    const merged: QueryFields = {
      search: patch.search ?? search,
      replace: patch.replace ?? replace,
      caseSensitive: patch.caseSensitive ?? caseSensitive,
      wholeWord: patch.wholeWord ?? wholeWord,
      regexp: patch.regexp ?? regexp,
    };
    // Local state updates synchronously below too (not just via the update
    // listener's resync) so the controlled inputs never lag a frame behind
    // what was just typed.
    setSearch(merged.search);
    setReplace(merged.replace);
    setCaseSensitive(merged.caseSensitive);
    setWholeWord(merged.wholeWord);
    setRegexp(merged.regexp);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery(merged)) });
  }

  const { total, current, showNoResults } = useMemo(() => {
    if (!search) return { total: 0, current: 0, showNoResults: false };
    let query: SearchQuery;
    try {
      query = new SearchQuery({ search, caseSensitive, wholeWord, regexp });
    } catch {
      return { total: 0, current: 0, showNoResults: true };
    }
    if (!query.valid) return { total: 0, current: 0, showNoResults: true };
    try {
      const state = view.state;
      const from = state.selection.main.from;
      const cursor = query.getCursor(state);
      let total = 0;
      let current = 0;
      let res = cursor.next();
      while (!res.done && total < MATCH_COUNT_CAP) {
        total++;
        if (current === 0 && res.value.from >= from) current = total;
        res = cursor.next();
      }
      if (current === 0 && total > 0) current = 1;
      return { total, current, showNoResults: total === 0 };
    } catch {
      return { total: 0, current: 0, showNoResults: true };
    }
    // `version` deliberately included: it's the only thing that changes on a
    // doc edit typed directly into the editor or a native findNext/replace
    // dispatch, neither of which touches search/caseSensitive/wholeWord/regexp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, caseSensitive, wholeWord, regexp, version, view]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  }

  function onReplaceKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      performReplaceOne(view, preserveCase);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  }

  // DESIGN-SPEC Amendments item 24 ("Find widget 30-40% smaller"): every
  // literal dimension below (padding, gaps, control sizes, icon sizes, font
  // sizes) was cut ~30-40% from Phase 6.5b's original values — SAME layout,
  // SAME features, just smaller, matched against `search.png`. Measured
  // before this change (Playwright `boundingBox()` on the mounted widget):
  // row 1 (collapsed) 474×38px, expanded (with replace row) 474×67px. The
  // values below target ~66% width / ~68-70% height of those numbers — see
  // ARCHITECTURE.md's Deviations entry for the exact before/after
  // measurements taken from the real e2e suite.
  const NAV_BTN = 13;
  const TOGGLE_BTN = 14;

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    width: TOGGLE_BTN,
    height: TOGGLE_BTN,
    padding: 0,
    color: active ? "var(--color-primary)" : "var(--color-muted)",
    background: active ? "color-mix(in oklab, var(--color-primary) 18%, transparent)" : "transparent",
  });

  return (
    <div
      data-testid="find-widget"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeSearchPanel(view);
        }
      }}
      style={{
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        marginTop: 6,
        marginRight: 8,
        padding: "3px 6px",
        width: "fit-content",
        background: "var(--app-titlebar-bg)",
        border: "1px solid var(--app-chrome-border)",
        borderLeft: "2px solid var(--color-primary)",
        borderRadius: "var(--radius-ui-sm)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      {/* Row 1: chevron, find input, toggles, counter, nav, close. */}
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {readOnly ? (
          <span style={{ width: NAV_BTN, flexShrink: 0 }} aria-hidden />
        ) : (
          <Tooltip content={expanded ? "Hide replace" : "Show replace"} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={expanded ? "Hide replace" : "Show replace"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)", flexShrink: 0 }}
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </Button>
          </Tooltip>
        )}

        <Input
          ref={(el) => {
            searchInputRef.current = el;
            // `openSearchPanel`'s "already open, refocus + refresh from the
            // new selection" branch (`@codemirror/search`'s own, unmodified
            // code, fired when ⌘F is pressed again with different text
            // selected) queries `panel.dom.querySelector("[main-field]")` —
            // a literal DOM attribute, not a React prop — to find the input
            // to focus/select. Set imperatively via the ref rather than as a
            // JSX prop so this stays outside `Input`'s typed prop surface.
            el?.setAttribute("main-field", "true");
          }}
          size="sm"
          placeholder="Find"
          aria-label="Find"
          value={search}
          onChange={(e) => dispatchQuery({ search: e.target.value })}
          onKeyDown={onSearchKeyDown}
          style={{ width: 118, height: 17, fontFamily: "var(--font-mono)", fontSize: 11 }}
        />

        <Tooltip content="Match case" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={caseSensitive}
            aria-label="Match case"
            onClick={() => dispatchQuery({ caseSensitive: !caseSensitive })}
            style={toggleBtnStyle(caseSensitive)}
          >
            <CaseSensitive size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Match whole word" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={wholeWord}
            aria-label="Match whole word"
            onClick={() => dispatchQuery({ wholeWord: !wholeWord })}
            style={toggleBtnStyle(wholeWord)}
          >
            <WholeWord size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Use regular expression" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={regexp}
            aria-label="Use regular expression"
            onClick={() => dispatchQuery({ regexp: !regexp })}
            style={toggleBtnStyle(regexp)}
          >
            <Regex size={12} />
          </Button>
        </Tooltip>

        <span
          data-testid="find-widget-count"
          style={{
            minWidth: 40,
            textAlign: "center",
            fontSize: 10,
            color: showNoResults ? "var(--git-deleted)" : "var(--color-muted)",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {search ? (showNoResults ? "No results" : `${current} of ${total}`) : ""}
        </span>

        <Tooltip content="Previous match (⇧Enter)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous match"
            disabled={total === 0}
            onClick={() => findPrevious(view)}
            style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
          >
            <ArrowUp size={10} />
          </Button>
        </Tooltip>
        <Tooltip content="Next match (Enter)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next match"
            disabled={total === 0}
            onClick={() => findNext(view)}
            style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
          >
            <ArrowDown size={10} />
          </Button>
        </Tooltip>
        <Tooltip content="Select all matches" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Select all matches"
            disabled={total === 0}
            onClick={() => selectMatches(view)}
            style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
          >
            <AlignJustify size={10} />
          </Button>
        </Tooltip>
        <Tooltip content="Close (Esc)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => closeSearchPanel(view)}
            style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
          >
            <X size={11} />
          </Button>
        </Tooltip>
      </div>

      {/* Row 2: replace — only when expanded, and never for a read-only view
          (DiffView's panes; @codemirror/merge's `EditorState.readOnly`). */}
      {expanded && !readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: NAV_BTN, flexShrink: 0 }} aria-hidden />
          <Input
            size="sm"
            placeholder="Replace"
            aria-label="Replace"
            value={replace}
            onChange={(e) => dispatchQuery({ replace: e.target.value })}
            onKeyDown={onReplaceKeyDown}
            style={{ width: 118, height: 17, fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          <Tooltip content="Preserve case" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={preserveCase}
              aria-label="Preserve case"
              disabled={regexp}
              onClick={() => setPreserveCase((v) => !v)}
              style={{ ...toggleBtnStyle(preserveCase), width: "auto", padding: "0 3px", fontSize: 9, fontWeight: 700 }}
            >
              AB
            </Button>
          </Tooltip>
          <Tooltip content="Replace" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Replace"
              disabled={total === 0}
              onClick={() => performReplaceOne(view, preserveCase)}
              style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
            >
              <Replace size={11} />
            </Button>
          </Tooltip>
          <Tooltip content="Replace all" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Replace all"
              disabled={total === 0}
              onClick={() => performReplaceAll(view, preserveCase)}
              style={{ width: NAV_BTN, height: NAV_BTN, padding: 0, color: "var(--color-muted)" }}
            >
              <ReplaceAll size={11} />
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/**
 * Git gutter — VSCode-style change bars in the margin, driven by
 * `git/diff.ts`'s `FileDiffResult` (ARCHITECTURE.md "Key flows": "single
 * `git/diff.ts` API used by gutter, diff stats chip, and status bar so
 * numbers always agree"). `CodeMirrorEditor.tsx` feeds this the exact same
 * `useGitStore` diff-cache entry the `+12 -5` chip and status bar read —
 * not a separate live diff against the in-editor buffer — so the gutter can
 * never show a different change set than the numbers next to it. This does
 * mean the gutter reflects the file *as of the last save* (`diffFileVsHead`
 * reads from disk) rather than un-saved keystrokes; it updates the moment
 * ⌘S writes to fs and `useGitStore.refresh()` invalidates the cache, which
 * is the same instant the chip/status-bar numbers change too. A gutter that
 * lived off the live unsaved buffer instead would routinely show a
 * different +/- than the chip while a file is dirty, which is exactly the
 * disagreement ARCHITECTURE.md's invariant rules out.
 *
 * Marker vocabulary per DESIGN-SPEC "Git features": green bar = added line,
 * amber bar = modified line (a hunk with both removed and added lines),
 * red triangle = a deletion anchored at the line it would reappear before.
 */
import { RangeSet, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { EMPTY_DIFF, type FileDiffResult } from "../git/diff";

type MarkKind = "added" | "modified" | "deleted";

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: MarkKind) {
    super();
  }
  eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-git-gutter-mark cm-git-gutter-mark--${this.kind}`;
    return el;
  }
}

/** Walks the flat `DiffLine[]` (a run of removed lines, then a run of added
 * lines, then a matched context line, repeating — see `git/diff.ts`'s
 * `toDiffLines`) into one marker per affected *current* line. */
function computeMarks(lines: FileDiffResult["lines"]): { line: number; kind: MarkKind }[] {
  const marks: { line: number; kind: MarkKind }[] = [];
  let i = 0;
  while (i < lines.length) {
    const entry = lines[i];
    if (entry.type === "context") {
      i++;
      continue;
    }
    let removed = 0;
    while (i < lines.length && lines[i].type === "removed") {
      removed++;
      i++;
    }
    const addedLines: number[] = [];
    while (i < lines.length && lines[i].type === "added") {
      const added = lines[i];
      if (added.newLine !== undefined) addedLines.push(added.newLine);
      i++;
    }
    if (addedLines.length > 0) {
      const kind: MarkKind = removed > 0 ? "modified" : "added";
      for (const line of addedLines) marks.push({ line, kind });
    } else if (removed > 0) {
      // A pure deletion has no line of its own in the new document — anchor
      // the triangle at whatever line follows it (where the deleted content
      // used to sit relative to the surrounding context). A deletion at
      // end-of-file (no following line) has nothing to anchor to and is
      // skipped rather than guessed at.
      const next = lines[i];
      if (next?.newLine !== undefined) marks.push({ line: next.newLine, kind: "deleted" });
    }
  }
  return marks;
}

function buildMarkers(doc: Text, diff: FileDiffResult): RangeSet<GutterMarker> {
  const marks = computeMarks(diff.lines);
  const ranges = marks
    .filter((m) => m.line >= 1 && m.line <= doc.lines)
    .map((m) => new ChangeMarker(m.kind).range(doc.line(m.line).from));
  return RangeSet.of(ranges, true);
}

export const setGitDiff = StateEffect.define<FileDiffResult>();

const gitDiffField = StateField.define<{ diff: FileDiffResult; markers: RangeSet<GutterMarker> }>({
  create() {
    return { diff: EMPTY_DIFF, markers: RangeSet.empty };
  },
  update(value, tr) {
    let diff = value.diff;
    let diffChanged = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitDiff)) {
        diff = effect.value;
        diffChanged = true;
      }
    }
    if (!diffChanged && !tr.docChanged) return value;
    return { diff, markers: buildMarkers(tr.state.doc, diff) };
  },
});

const gutterTheme = EditorView.baseTheme({
  ".cm-git-gutter": { width: "4px" },
  ".cm-git-gutter .cm-gutterElement": { padding: 0 },
  ".cm-git-gutter-mark": { height: "100%", width: "4px" },
  ".cm-git-gutter-mark--added": { background: "var(--git-added)" },
  ".cm-git-gutter-mark--modified": { background: "var(--git-modified)" },
  ".cm-git-gutter-mark--deleted": { position: "relative" },
  ".cm-git-gutter-mark--deleted::before": {
    content: '""',
    position: "absolute",
    top: "-4px",
    left: "0",
    width: "0",
    height: "0",
    borderTop: "5px solid var(--git-deleted)",
    borderRight: "5px solid transparent",
  },
});

/** Dispatches the current diff into a mounted editor's gutter — called from
 * `CodeMirrorEditor.tsx` on mount and whenever the cached diff changes. */
export function dispatchGitDiff(view: EditorView, diff: FileDiffResult): void {
  view.dispatch({ effects: setGitDiff.of(diff) });
}

export function gitGutter(): Extension {
  return [
    gitDiffField,
    gutter({
      class: "cm-git-gutter",
      markers: (view) => view.state.field(gitDiffField).markers,
    }),
    gutterTheme,
  ];
}

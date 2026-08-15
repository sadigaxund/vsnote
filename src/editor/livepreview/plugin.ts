/**
 * The Obsidian-style live-preview decoration plugin — DESIGN-SPEC "Markdown
 * live preview (the Obsidian behavior — non-negotiable)": headings/bold/
 * italic/links/lists/quotes/inline code styled in place; fenced code
 * flush-styled; raw syntax markers (`#`, `**`, `[]()`, `` ` ``, `>`, code
 * fences) hidden by decoration EXCEPT in the smallest node whose range
 * contains the cursor or selection, so `**append-only**` reveals its own
 * marks and nothing else in the surrounding line/paragraph.
 *
 * Adapted pattern (not copied source): the general approach here — walk the
 * `@lezer/markdown` syntax tree already built by `@codemirror/lang-markdown`
 * (no second parser, per ARCHITECTURE.md), classify each node as
 * "structural" (headings/emphasis/code/links/quotes: style the whole node,
 * hide its mark children only when the selection doesn't overlap the
 * node's own range) or "always-widget" (task checkboxes: replace
 * unconditionally, since Obsidian keeps the checkbox interactive even
 * while editing the item's text) — is the documented technique used by
 * live-preview CodeMirror 6 markdown editors such as **ixora**
 * (github.com/ali-master/ixora, MIT) and **codemirror-rich-markdoc**
 * (github.com/andrewbranch/codemirror-rich-markdoc, MIT); both hide
 * "mark" node types via `Decoration.replace` gated on
 * `selection intersects node.from..node.to`, exactly the check
 * `overlapsSelection` implements below. No code from either project is
 * copied here (this file is an independent implementation written against
 * this app's own token/CSS system), but the shape of the technique is
 * theirs — hence the attribution per CLAUDE.md rule 7.
 */
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { CheckboxWidget, LinkWidget } from "./widgets";

export interface LivePreviewOptions {
  onOpenLink?: (href: string) => void;
}

/** `focused` gates every reveal: DESIGN-SPEC's exit criterion literally
 * names "blur" — "moving the cursor away (blur) re-renders it immediately"
 * — so hiding depends on more than the selection's position. A freshly
 * mounted, unfocused editor always has a selection at document start (CM6's
 * default), which would otherwise permanently reveal the first heading's
 * `#` even before the user ever clicks in; requiring DOM focus too is what
 * makes an untouched note render exactly like the static target image, and
 * what makes tabbing/clicking away from a still-selected span re-hide it. */
function overlapsSelection(state: EditorState, focused: boolean, from: number, to: number): boolean {
  if (!focused) return false;
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

const HEADING_RE = /^ATXHeading([1-6])$/;

export function buildLivePreviewDecorations(state: EditorState, focused: boolean, opts: LivePreviewOptions): DecorationSet {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const lineClasses = new Map<number, string[]>();

  function addLineClass(pos: number, cls: string) {
    const line = doc.lineAt(pos);
    const list = lineClasses.get(line.from);
    if (list) list.push(cls);
    else lineClasses.set(line.from, [cls]);
  }

  function hide(from: number, to: number) {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to));
  }

  /** Removes an entire line, including its trailing newline, so a
   * pure-syntax line (a fence delimiter) collapses rather than leaving a
   * blank row — the same "replace across the line break" idiom CM6's own
   * fold ranges use. */
  function hideWholeLine(lineNumber: number) {
    const line = doc.line(lineNumber);
    const nextFrom = lineNumber < doc.lines ? doc.line(lineNumber + 1).from : line.to;
    if (nextFrom > line.from) ranges.push(Decoration.replace({}).range(line.from, nextFrom));
  }

  syntaxTree(state).iterate({
    enter(nodeRef: SyntaxNodeRef) {
      const { name, from, to } = nodeRef;
      const headingMatch = HEADING_RE.exec(name);

      if (headingMatch) {
        const level = headingMatch[1];
        addLineClass(from, `cm-md-h${level}`);
        if (!overlapsSelection(state, focused, from, to)) {
          const marker = nodeRef.node.getChild("HeaderMark");
          if (marker) {
            const line = doc.lineAt(from);
            let end = marker.to;
            while (end < line.to && doc.sliceString(end, end + 1) === " ") end++;
            hide(marker.from, end);
          }
        }
        return;
      }

      switch (name) {
        case "StrongEmphasis":
        case "Emphasis": {
          const cls = name === "StrongEmphasis" ? "cm-md-strong" : "cm-md-em";
          ranges.push(Decoration.mark({ class: cls }).range(from, to));
          if (!overlapsSelection(state, focused, from, to)) {
            for (const mark of nodeRef.node.getChildren("EmphasisMark")) hide(mark.from, mark.to);
          }
          return;
        }
        case "Strikethrough": {
          ranges.push(Decoration.mark({ class: "cm-md-strike" }).range(from, to));
          if (!overlapsSelection(state, focused, from, to)) {
            for (const mark of nodeRef.node.getChildren("StrikethroughMark")) hide(mark.from, mark.to);
          }
          return;
        }
        case "InlineCode": {
          ranges.push(Decoration.mark({ class: "cm-md-code" }).range(from, to));
          if (!overlapsSelection(state, focused, from, to)) {
            for (const mark of nodeRef.node.getChildren("CodeMark")) hide(mark.from, mark.to);
          }
          return;
        }
        case "Link": {
          const marks = nodeRef.node.getChildren("LinkMark");
          const urlNode = nodeRef.node.getChild("URL");
          if (marks.length >= 2 && !overlapsSelection(state, focused, from, to)) {
            const [openBracket, closeBracket] = marks;
            const text = doc.sliceString(openBracket.to, closeBracket.from);
            const href = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : "";
            ranges.push(
              Decoration.replace({ widget: new LinkWidget({ text, href, onOpenLink: opts.onOpenLink }) }).range(from, to),
            );
          } else {
            ranges.push(Decoration.mark({ class: "cm-md-link" }).range(from, to));
          }
          return;
        }
        case "TaskMarker": {
          const text = doc.sliceString(from, to);
          const checked = /\[[xX]\]/.test(text);
          ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to));
          return;
        }
        case "ListItem": {
          const parentName = nodeRef.node.parent?.name;
          const isTask = nodeRef.node.getChild("Task") != null;
          const marker = nodeRef.node.getChild("ListMark");
          if (parentName === "BulletList") {
            addLineClass(from, isTask ? "cm-md-task-item" : "cm-md-list-item");
            if (marker) {
              let end = marker.to;
              if (doc.sliceString(end, end + 1) === " ") end++;
              hide(marker.from, end);
            }
          } else {
            // Ordered list — keep the "1." marker visible; it carries real
            // information (sequence) that a bullet glyph would destroy.
            addLineClass(from, "cm-md-ordered-item");
          }
          return;
        }
        case "Blockquote": {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(Math.max(from, to - 1)).number;
          for (let ln = startLine; ln <= endLine; ln++) addLineClass(doc.line(ln).from, "cm-md-quote");
          if (!overlapsSelection(state, focused, from, to)) {
            for (const mark of nodeRef.node.getChildren("QuoteMark")) {
              const line = doc.lineAt(mark.from);
              let end = mark.to;
              if (doc.sliceString(end, end + 1) === " ") end++;
              hide(mark.from, Math.min(end, line.to));
            }
          }
          return;
        }
        case "FencedCode": {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(Math.max(from, to - 1)).number;
          for (let ln = startLine; ln <= endLine; ln++) addLineClass(doc.line(ln).from, "cm-md-fence");
          addLineClass(doc.line(startLine).from, "cm-md-fence-first");
          addLineClass(doc.line(endLine).from, "cm-md-fence-last");
          if (!overlapsSelection(state, focused, from, to) && endLine > startLine) {
            hideWholeLine(startLine);
            hideWholeLine(endLine);
          }
          return;
        }
        case "HorizontalRule": {
          addLineClass(from, "cm-md-hr");
          if (!overlapsSelection(state, focused, from, to)) hide(from, to);
          return;
        }
        default:
          return;
      }
    },
  });

  for (const [pos, classes] of lineClasses) {
    ranges.push(Decoration.line({ class: classes.join(" ") }).range(pos, pos));
  }

  return Decoration.set(ranges, true);
}

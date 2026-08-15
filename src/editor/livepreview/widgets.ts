/**
 * Inline widget decorations for the live-preview markdown editor:
 * `CheckboxWidget` (GFM task list items → a real clickable `<input
 * type=checkbox>`, DESIGN-SPEC "Checkbox list items render as toggle
 * widgets") and `LinkWidget` (`[text](file.ext)` → accent-colored clickable
 * text that opens the target in a tab, DESIGN-SPEC "Internal links ... open
 * that file in a tab when clicked").
 *
 * Both widgets recompute their document position at click time via
 * `view.posAtDOM` rather than trusting a position captured at construction
 * time — `plugin.ts` rebuilds the whole decoration set (and therefore
 * fresh widget instances) on every doc/selection change, but CM6 is free to
 * *reuse* an old widget's DOM when two instances compare `eq`, so a stale
 * closed-over offset would silently drift out of sync after enough
 * elsewhere-in-the-document edits. Reading the position live from the DOM
 * on the actual click sidesteps that class of bug entirely.
 */
import { EditorView, WidgetType } from "@codemirror/view";

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-checkbox";
    box.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = view.posAtDOM(box);
      // The widget always replaces an exact 3-char `[ ]`/`[x]` TaskMarker
      // range (see plugin.ts) — flip only the middle character.
      const marker = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[.\]$/.test(marker)) return;
      const nowChecked = /\[[xX]\]/.test(marker);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: nowChecked ? " " : "x" } });
    });
    return box;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export interface LinkWidgetOptions {
  text: string;
  href: string;
  onOpenLink?: (href: string) => void;
}

export class LinkWidget extends WidgetType {
  constructor(private readonly opts: LinkWidgetOptions) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return other.opts.text === this.opts.text && other.opts.href === this.opts.href;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-link";
    span.textContent = this.opts.text;
    span.title = this.opts.href;
    span.setAttribute("role", "link");
    span.addEventListener("mousedown", (event) => {
      // Prevent CM6 from placing the cursor via the click that's about to
      // navigate — a plain click on a *rendered* link should open it, not
      // start editing it (matches Obsidian: clicking into already-revealed
      // raw text moves the caret; clicking a still-hidden link navigates).
      event.preventDefault();
      this.opts.onOpenLink?.(this.opts.href);
    });
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

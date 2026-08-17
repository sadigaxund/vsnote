/**
 * OverflowMenuItems — DESIGN-SPEC item 38's Format submenu (bold, italic,
 * strikethrough, inline code, link), Insert submenu (table, code block,
 * horizontal rule), and Export as PDF, as menu CONTENT for an existing
 * dropdown rather than a standalone `⋯` trigger. Round 6 item 16 relocated
 * these: the Phase 15 title-bar `⋯` (and the per-pane `EditorHeader` copy)
 * are gone; the one home is now each pane's tab bar `…` menu
 * (`EditorTabBar`'s `documentActions` slot, filled by `EditorPane.tsx`) —
 * the editor area's pre-existing overflow menu, exactly where the user
 * asked for it. Item 37 (WITHDRAWN, same day): there is NO editor
 * right-click context menu — these Format/Insert actions live ONLY here,
 * not on a `ContextMenu.tsx` this component does NOT build.
 *
 * Format/Insert operate on the REAL focused CM6 view via
 * `editor/activeView.ts`'s `getActiveEditorView(paneId)` — the same
 * mechanism `⌘F` already uses to reach "the" editor without prop-drilling a
 * view reference — dispatched through `editor/formatActions.ts`'s pure CM6
 * command layer. Both submenus are gated identically: enabled only for a
 * markdown file (`kind === "md"`) in an editable mode (Rendered's
 * live-preview CM6 view or Source — never Diff, which is read-only) with a
 * present buffer; disabled (never hidden, so a user always sees the
 * capability exists) otherwise, via the submenu TRIGGER's own `disabled`
 * (Radix announces `aria-disabled` and blocks keyboard/pointer opening,
 * satisfying item 38's a11y bar without disabling every leaf item
 * individually). Export as PDF is gated on file kind alone (`kind ===
 * "md"`, buffer present) — it re-renders the file's Rendered view fresh
 * through `lib/printExport.tsx` regardless of which mode happens to be on
 * screen right now, so it isn't mode-gated.
 *
 * Scope note (recorded here per the CLAUDE.md rule 4 "if you must deviate,
 * say why" — not a DESIGN-SPEC deviation itself, since item 38 doesn't
 * specify PDF export for non-markdown kinds, but worth being explicit
 * about): Export as PDF ships for `.md` only this phase. Building an
 * equivalent print-clean pipeline for `.html`/`.csv`/`.json`'s renderers
 * (`renderers/HtmlPreview.tsx`'s sandboxed iframe, `CsvTable`, `JsonView`)
 * is real, separate work with its own print-layout questions per renderer —
 * out of scope for the "long note paginates correctly" bar item 38's exit
 * criterion actually tests. The menu item still exists for every other
 * kind, just disabled, so the affordance is discoverable rather than
 * silently absent.
 *
 * `DropdownMenuItem`/`DropdownMenuSeparator` are the library's own
 * (CLAUDE.md rule 1); the `Format`/`Insert` submenus use the local
 * `DropdownSubmenu` (Phase 15's missing-primitive addition, see that
 * file's doc + docs/COMPONENT-BACKLOG.md). The hosting `DropdownMenu`
 * root/trigger/content belong to the tab bar.
 */
import { Bold, Code, FileDown, Italic, Link2, Minus, SquareCode, Strikethrough, Table2 } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "my-you-eye";
import { DropdownSubmenu, DropdownSubmenuContent, DropdownSubmenuTrigger } from "./DropdownSubmenu";
import { applyFormatAction, applyInsertAction, type FormatActionId, type InsertActionId } from "../../editor/formatActions";
import { getActiveEditorView } from "../../editor/activeView";
import { exportMarkdownAsPdf } from "../../lib/printExport";
import { useBufferStore } from "../../stores/useBufferStore";
import type { EditorMode, FileKind } from "../../types";

export interface OverflowMenuItemsProps {
  /** Which pane's editor these Format/Insert actions target —
   * `editor/activeView.ts`'s per-pane view registry key. Each tab bar
   * passes its OWN pane's id, so acting from a background pane's `…` menu
   * never edits a different pane's buffer. */
  paneId: string;
  kind: FileKind | undefined;
  mode: EditorMode | undefined;
  path: string | undefined;
  /** Buffer's `missing` flag (file absent from fs) — same signal
   * `EditorContent.tsx` uses to pass `readOnly` to the CM6 view, so Format/
   * Insert never look enabled over a view that's actually locked read-only. */
  missing: boolean;
}

const FORMAT_ITEMS: { id: FormatActionId; label: string; icon: typeof Bold }[] = [
  { id: "bold", label: "Bold", icon: Bold },
  { id: "italic", label: "Italic", icon: Italic },
  { id: "strikethrough", label: "Strikethrough", icon: Strikethrough },
  { id: "code", label: "Inline code", icon: Code },
  { id: "link", label: "Link", icon: Link2 },
];

const INSERT_ITEMS: { id: InsertActionId; label: string; icon: typeof Table2 }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "codeblock", label: "Code block", icon: SquareCode },
  { id: "hr", label: "Horizontal rule", icon: Minus },
];

export function OverflowMenuItems({ paneId, kind, mode, path, missing }: OverflowMenuItemsProps) {
  const canFormatInsert = kind === "md" && (mode === "rendered" || mode === "source") && !missing;
  const canExportPdf = kind === "md" && !missing;

  function handleFormat(id: FormatActionId): void {
    const view = getActiveEditorView(paneId);
    if (view) applyFormatAction(view, id);
  }

  function handleInsert(id: InsertActionId): void {
    const view = getActiveEditorView(paneId);
    if (view) applyInsertAction(view, id);
  }

  function handleExportPdf(): void {
    if (!path) return;
    const content = useBufferStore.getState().buffers[path]?.content ?? "";
    const fileName = path.split("/").pop() || path;
    exportMarkdownAsPdf(fileName, content);
  }

  // NOTE for the mounting menu (see EditorTabBar.tsx): a Format/Insert
  // action calls `view.focus()` (in formatActions.ts) so the user can keep
  // typing right where they picked the menu item from — Radix's default
  // post-close behavior would otherwise steal focus BACK to the trigger
  // button once the whole menu tree closes, undoing that. The hosting
  // `DropdownMenuContent` must therefore set
  // `onCloseAutoFocus={(e) => e.preventDefault()}`; a submenu closing on
  // its own (hover away, Escape) never steals focus the way the top-level
  // Content's close does, so that one guard is enough.
  return (
    <>
        <DropdownSubmenu>
          <DropdownSubmenuTrigger disabled={!canFormatInsert} data-testid="overflow-menu-format">
            Format
          </DropdownSubmenuTrigger>
          <DropdownSubmenuContent>
            {FORMAT_ITEMS.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onSelect={() => handleFormat(id)}>
                <Icon size={14} aria-hidden />
                <span style={{ marginLeft: 8 }}>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownSubmenuContent>
        </DropdownSubmenu>
        <DropdownSubmenu>
          <DropdownSubmenuTrigger disabled={!canFormatInsert} data-testid="overflow-menu-insert">
            Insert
          </DropdownSubmenuTrigger>
          <DropdownSubmenuContent>
            {INSERT_ITEMS.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onSelect={() => handleInsert(id)}>
                <Icon size={14} aria-hidden />
                <span style={{ marginLeft: 8 }}>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownSubmenuContent>
        </DropdownSubmenu>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canExportPdf} onSelect={handleExportPdf} data-testid="overflow-menu-export-pdf">
          <FileDown size={14} aria-hidden />
          <span style={{ marginLeft: 8 }}>Export as PDF</span>
        </DropdownMenuItem>
    </>
  );
}

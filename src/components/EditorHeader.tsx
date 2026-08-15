/**
 * Editor header row: breadcrumbs (left) + diff stat chip + mode segmented
 * control + zen-mode toggle (right). Composition over the library's
 * `Breadcrumbs`/`Button`/`Tooltip` and the local `DiffStatChip`/
 * `SegmentedControl`.
 */
import { Breadcrumbs, Button, Tooltip } from "my-you-eye";
import { Eye, FileCode, GitCompareArrows, Maximize2 } from "lucide-react";
import { DiffStatChip } from "./local/DiffStatChip";
import { SegmentedControl } from "./local/SegmentedControl";
import type { DiffStat, EditorMode } from "../types";

export interface EditorHeaderProps {
  breadcrumb: string[];
  diff: DiffStat;
  mode: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  /** Which segments are selectable for the active file — DESIGN-SPEC
   * "Modes" table. Phase 2 only has a real renderer for Rendered/`.md`
   * (Phase 1's static placeholder) and the crude Source textarea; Diff is
   * enabled whenever the file has a nonzero computed diff. Full per-type
   * availability (json tree view, csv DataTable, html iframe) lands with
   * their renderers in Phase 4. */
  availableModes?: EditorMode[];
  /** DESIGN-SPEC Amendments item 4 ("Zen mode ... a command + a toolbar
   * affordance + a shortcut"). This IS the toolbar affordance; the command
   * lives in the command palette and the shortcut (⌘⇧Z) in App.tsx's
   * global keydown handler — all three call the same `App.tsx` toggle. */
  onEnterZen?: () => void;
}

export function EditorHeader({
  breadcrumb,
  diff,
  mode,
  onModeChange,
  availableModes = ["rendered", "source", "diff"],
  onEnterZen,
}: EditorHeaderProps) {
  const has = (m: EditorMode) => availableModes.includes(m);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--app-chrome-editorheader-h)",
        padding: "0 14px",
        background: "var(--app-editor-bg)",
        borderBottom: "1px solid var(--app-chrome-border)",
        flexShrink: 0,
      }}
    >
      <Breadcrumbs
        items={breadcrumb.map((label) => ({ label }))}
        style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {(diff.added > 0 || diff.removed > 0) && (
          <DiffStatChip added={diff.added} removed={diff.removed} />
        )}
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "rendered", label: "Rendered", icon: <Eye size={13} />, disabled: !has("rendered") },
            { value: "source", label: "Source", icon: <FileCode size={13} />, disabled: !has("source") },
            { value: "diff", label: "Diff", icon: <GitCompareArrows size={13} />, disabled: !has("diff") },
          ]}
        />
        <Tooltip content="Zen mode (⌘⇧Z)" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Enter zen mode"
            onClick={onEnterZen}
            style={{ width: 26, height: 26, color: "var(--color-muted)" }}
          >
            <Maximize2 size={13} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

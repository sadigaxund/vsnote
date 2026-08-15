/**
 * Editor header row: breadcrumbs (left) + diff stat chip + mode segmented
 * control (right). Composition over the library's `Breadcrumbs` and the
 * local `DiffStatChip`/`SegmentedControl`.
 */
import { Breadcrumbs } from "my-you-eye";
import { Eye, FileCode, GitCompareArrows } from "lucide-react";
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
}

export function EditorHeader({
  breadcrumb,
  diff,
  mode,
  onModeChange,
  availableModes = ["rendered", "source", "diff"],
}: EditorHeaderProps) {
  const has = (m: EditorMode) => availableModes.includes(m);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 38,
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
      </div>
    </div>
  );
}

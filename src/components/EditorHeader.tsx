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
}

export function EditorHeader({ breadcrumb, diff, mode, onModeChange }: EditorHeaderProps) {
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
        <DiffStatChip added={diff.added} removed={diff.removed} />
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "rendered", label: "Rendered", icon: <Eye size={13} /> },
            { value: "source", label: "Source", icon: <FileCode size={13} /> },
            { value: "diff", label: "Diff", icon: <GitCompareArrows size={13} /> },
          ]}
        />
      </div>
    </div>
  );
}

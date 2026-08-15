/**
 * Editor header row: breadcrumbs (left) + diff stat chip + mode segmented
 * control (right). Composition over the library's `Breadcrumbs` and the
 * local `DiffStatChip`/`SegmentedControl`.
 *
 * DESIGN-SPEC Amendments round 3 item 18 ("Header consolidation") reshaped
 * this component's role: the title bar (`components/TitleBar.tsx`) now
 * ALWAYS carries this same breadcrumb/diff-chip/mode-toggle/diff-layout
 * cluster for the FOCUSED pane, and mounts it exclusively when there's only
 * one pane. This component (`EditorHeader`) is only rendered at all when
 * `EditorArea.tsx` has MORE than one pane open — each pane's own SLIM
 * header (a visibly shorter `--app-chrome-paneheader-h` band, not the old
 * single 34px band every pane used to get) — so per-pane Rendered/Source/
 * Diff still works when comparing the same file two ways side-by-side.
 * The zen button that used to live here moved entirely into the title bar
 * (it always operates on the focused pane regardless of which pane's own
 * header, if any, is visible) — this component no longer renders one.
 */
import { Breadcrumbs } from "my-you-eye";
import { AlignJustify, Columns2, Eye, FileCode, GitCompareArrows } from "lucide-react";
import { DiffStatChip } from "./local/DiffStatChip";
import { SegmentedControl } from "./local/SegmentedControl";
import type { DiffLayout, DiffStat, EditorMode } from "../types";

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
  /** DESIGN-SPEC Amendments item 13: only rendered when `mode === "diff"` —
   * the compact icon-only unified/split toggle, "next to the mode toggle,
   * same visual language" — owned by `EditorPane.tsx`, replacing the ad-hoc
   * `SegmentedControl` that used to live inside `editor/DiffView.tsx`. */
  diffLayout?: DiffLayout;
  onDiffLayoutChange?: (layout: DiffLayout) => void;
}

export function EditorHeader({
  breadcrumb,
  diff,
  mode,
  onModeChange,
  availableModes = ["rendered", "source", "diff"],
  diffLayout = "split",
  onDiffLayoutChange,
}: EditorHeaderProps) {
  const has = (m: EditorMode) => availableModes.includes(m);
  return (
    <div
      data-testid="editor-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "var(--app-chrome-paneheader-h)",
        padding: "0 12px",
        background: "var(--app-editor-bg)",
        borderBottom: "1px solid var(--app-chrome-border)",
        flexShrink: 0,
      }}
    >
      <Breadcrumbs
        items={breadcrumb.map((label) => ({ label }))}
        style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {(diff.added > 0 || diff.removed > 0) && (
          <DiffStatChip added={diff.added} removed={diff.removed} />
        )}
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "rendered", label: "Rendered", icon: <Eye size={11} />, disabled: !has("rendered") },
            { value: "source", label: "Source", icon: <FileCode size={11} />, disabled: !has("source") },
            { value: "diff", label: "Diff", icon: <GitCompareArrows size={11} />, disabled: !has("diff") },
          ]}
        />
        {mode === "diff" && (
          <SegmentedControl
            size="xs"
            iconOnly
            aria-label="Diff layout"
            value={diffLayout}
            onChange={onDiffLayoutChange}
            options={[
              { value: "split", label: "Split", icon: <Columns2 size={11} /> },
              { value: "unified", label: "Unified", icon: <AlignJustify size={11} /> },
            ]}
          />
        )}
      </div>
    </div>
  );
}

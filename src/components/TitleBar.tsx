/**
 * App title bar — DESIGN-SPEC Amendments round 3 item 18 ("Header
 * consolidation"). Absorbs the FOCUSED pane's controls that used to live in
 * a separate `EditorHeader` row: breadcrumbs, the diff-stat chip, the
 * Rendered/Source/Diff mode toggle, and (Diff mode only) the unified/split
 * layout toggle. The centered global-search `Input` from every phase before
 * this one shrank to a plain icon button in the right-hand cluster — its
 * only job is opening the command palette (verified against
 * `CommandPaletteHost.tsx`: the palette itself already handles both file
 * jump and commands, this button is purely the affordance that opens it,
 * same as the shortcut). DESIGN-SPEC's own brief for this item describes
 * "icon + `⌘K` hint"; built that way first, then simplified to icon-only
 * after review — a magnifier glyph next to a literal "⌘K" badge says the
 * same thing twice (both read as "this is the search/command shortcut"),
 * and every sibling action in this cluster (sidebar toggle, split,
 * settings) is already a bare icon button with the shortcut living only in
 * its tooltip; this button now matches that pattern instead of being the
 * one exception. See DESIGN-SPEC.md's Amendments round 3 note on item 18
 * for the same deviation recorded there per CLAUDE.md rule 4.
 *
 * Layout, left → right: glyph/title/breadcrumbs (left cluster); diff chip,
 * mode toggle, diff layout toggle (diff mode only), zen, sidebar toggle,
 * split, command-palette, settings (right cluster) — exactly the order
 * DESIGN-SPEC's brief specifies. The bar's own height
 * (`--app-chrome-titlebar-h`) is unchanged by any of this — see
 * `local/TitleBar.tsx`'s doc for why moving from a 3-column grid to a
 * simple 2-zone flex row was enough room.
 *
 * Pane-tree awareness: this component always mirrors the FOCUSED pane
 * (`App.tsx` computes `breadcrumb`/`diff`/`mode`/`availableModes`/
 * `diffLayout` from `useTabsStore`'s `activePaneId`, the same "whichever
 * pane the user last interacted with" the rest of the app already treats as
 * canonical) — with >1 pane open, `EditorPane.tsx`'s own slim per-pane
 * header ALSO shows this same cluster for its own pane; with exactly one
 * pane, this is the ONLY place it appears at all (`EditorPane.tsx`'s
 * `multiPane` gate).
 */
import { Breadcrumbs, Button, Tooltip } from "my-you-eye";
import {
  AlignJustify,
  Columns2,
  Eye,
  FileCode,
  GitCompareArrows,
  Layout,
  Maximize2,
  PanelLeft,
  Search,
  Settings,
  SquareSplitHorizontal,
} from "lucide-react";
import { TitleBar as TitleBarShell } from "./local/TitleBar";
import { DiffStatChip } from "./local/DiffStatChip";
import { SegmentedControl } from "./local/SegmentedControl";
import type { DiffLayout, DiffStat, EditorMode } from "../types";

export interface AppTitleBarProps {
  vaultName: string;
  /** The focused pane's active tab path, split on `/` — omitted (no
   * breadcrumb rendered at all) when no tab is open or the focused tab is
   * the virtual Settings view (same "no editor surface" treatment
   * `filetypes/registry.ts`'s `modeAvailabilityFor` already gives it). */
  breadcrumb?: string[];
  diff: DiffStat;
  mode?: EditorMode;
  availableModes: EditorMode[];
  onModeChange?: (mode: EditorMode) => void;
  diffLayout: DiffLayout;
  onDiffLayoutChange?: (layout: DiffLayout) => void;
  onEnterZen?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onToggleSplit?: () => void;
  onOpenPalette?: () => void;
  onOpenSettings?: () => void;
}

export function AppTitleBar({
  vaultName,
  breadcrumb,
  diff,
  mode,
  availableModes,
  onModeChange,
  diffLayout,
  onDiffLayoutChange,
  onEnterZen,
  sidebarCollapsed,
  onToggleSidebar,
  onToggleSplit,
  onOpenPalette,
  onOpenSettings,
}: AppTitleBarProps) {
  const has = (m: EditorMode) => availableModes.includes(m);
  const showPaneControls = !!breadcrumb && availableModes.length > 0;

  return (
    <TitleBarShell
      glyph={
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, #7c6cf0))",
            color: "var(--color-primary-fg)",
          }}
        >
          <Layout size={12} strokeWidth={2.5} />
        </span>
      }
      title="Slate"
      subtitle={vaultName}
      breadcrumb={
        breadcrumb ? (
          <Breadcrumbs
            items={breadcrumb.map((label) => ({ label }))}
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        ) : undefined
      }
      actions={
        <>
          {showPaneControls && (
            <div data-testid="titlebar-pane-controls" style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 4 }}>
              {(diff.added > 0 || diff.removed > 0) && <DiffStatChip added={diff.added} removed={diff.removed} />}
              <SegmentedControl
                size="sm"
                value={mode ?? "source"}
                onChange={onModeChange}
                options={[
                  { value: "rendered", label: "Rendered", icon: <Eye size={13} />, disabled: !has("rendered") },
                  { value: "source", label: "Source", icon: <FileCode size={13} />, disabled: !has("source") },
                  { value: "diff", label: "Diff", icon: <GitCompareArrows size={13} />, disabled: !has("diff") },
                ]}
              />
              {mode === "diff" && (
                <SegmentedControl
                  size="sm"
                  iconOnly
                  aria-label="Diff layout"
                  value={diffLayout}
                  onChange={onDiffLayoutChange}
                  options={[
                    { value: "split", label: "Split", icon: <Columns2 size={13} /> },
                    { value: "unified", label: "Unified", icon: <AlignJustify size={13} /> },
                  ]}
                />
              )}
            </div>
          )}
          <Tooltip content="Zen mode (⌘⇧Z)" side="bottom">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Enter zen mode" onClick={onEnterZen}>
              <Maximize2 size={15} />
            </Button>
          </Tooltip>
          <Tooltip content={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle sidebar"
              aria-pressed={!sidebarCollapsed}
              onClick={onToggleSidebar}
            >
              <PanelLeft size={15} />
            </Button>
          </Tooltip>
          <Tooltip content="Split editor" side="bottom">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Split editor" onClick={onToggleSplit}>
              <SquareSplitHorizontal size={15} />
            </Button>
          </Tooltip>
          <Tooltip content="Command palette (⌘K)" side="bottom">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Command palette" onClick={onOpenPalette}>
              <Search size={15} />
            </Button>
          </Tooltip>
          <Tooltip content="Settings" side="bottom">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpenSettings}>
              <Settings size={15} />
            </Button>
          </Tooltip>
        </>
      }
    />
  );
}

/**
 * Extensions activity view — a documented stub (DESIGN-SPEC "Activity bar":
 * "Extensions (stub)"; ARCHITECTURE.md's non-goals list: "extensions
 * marketplace (icon is a stub)"). Course-correction to DESIGN-SPEC
 * Amendments round 3 item 20: before this, clicking the Extensions rail
 * icon rendered nothing at all — `App.tsx` had no `activePanel ===
 * "extensions"` branch — leaving a blank gap where the sidebar region
 * should be. A stub is the documented, correct behavior; a blank gap isn't.
 * Renders inside the shared `local/SidebarContainer` region shell, same as
 * every other activity view, so the region's width/collapse state stays
 * consistent even here.
 */
import { EmptyState } from "my-you-eye";
import { Blocks } from "lucide-react";
import { SidebarContainer } from "./local/SidebarContainer";

export interface ExtensionsPanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function ExtensionsPanel({ width, onWidthChange, collapsed, onCollapsedChange }: ExtensionsPanelProps) {
  return (
    <SidebarContainer
      testId="extensions-panel"
      label="EXTENSIONS"
      width={width}
      onWidthChange={onWidthChange}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
    >
      <div style={{ padding: "24px 16px" }}>
        <EmptyState
          icon={<Blocks size={22} />}
          title="Extensions: not implemented"
          description="VSNote is a local-first, single-purpose workspace (CLAUDE.md rule 3). No extension marketplace is planned; this is a documented stub, not a missing feature."
        />
      </div>
    </SidebarContainer>
  );
}

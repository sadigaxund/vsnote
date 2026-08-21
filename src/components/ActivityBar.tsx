/**
 * App activity bar: Explorer / Search / Source Control / Extensions rail +
 * pinned Settings footer. Composition over `local/ActivityBar`.
 */
import { Blocks, FolderTree, Search, Settings, GitBranch } from "lucide-react";
import { ActivityBar as ActivityBarShell } from "./local/ActivityBar";

export type ActivityPanel = "explorer" | "search" | "scm" | "extensions";

export interface AppActivityBarProps {
  active: ActivityPanel;
  onSelect: (panel: ActivityPanel) => void;
  changedCount: number;
  onOpenSettings?: () => void;
  /** Hover/focus intent (TODO §6.1.5) — forwarded so the app can preload
   * the panel's lazy chunk behind pointer/keyboard travel. */
  onItemIntent?: (panel: ActivityPanel) => void;
}

export function AppActivityBar({
  active,
  onSelect,
  changedCount,
  onOpenSettings,
  onItemIntent,
}: AppActivityBarProps) {
  return (
    <ActivityBarShell
      items={[
        {
          id: "explorer",
          label: "Explorer",
          icon: <FolderTree size={19} />,
          active: active === "explorer",
        },
        {
          id: "search",
          label: "Search",
          icon: <Search size={19} />,
          active: active === "search",
        },
        {
          id: "scm",
          label: "Source Control",
          icon: <GitBranch size={19} />,
          active: active === "scm",
          badge: changedCount,
        },
        {
          id: "extensions",
          label: "Extensions",
          icon: <Blocks size={19} />,
          active: active === "extensions",
        },
      ]}
      onSelect={(id) => onSelect(id as ActivityPanel)}
      footer={{ id: "settings", label: "Settings", icon: <Settings size={19} /> }}
      onItemIntent={(id) => onItemIntent?.(id as ActivityPanel)}
      onFooterSelect={onOpenSettings}
    />
  );
}

/**
 * App activity bar: Explorer / Search / Source Control / Extensions rail +
 * "Shared" (opens a full-width TAB, like Settings — see
 * `components/SharedView.tsx`'s header doc for why a sidebar panel was
 * rejected) + pinned Settings footer. Composition over `local/ActivityBar`.
 */
import { Blocks, FolderTree, Search, Settings, GitBranch, Share2 } from "lucide-react";
import { ActivityBar as ActivityBarShell } from "./local/ActivityBar";

export type ActivityPanel = "explorer" | "search" | "scm" | "extensions";

export interface AppActivityBarProps {
  active: ActivityPanel;
  onSelect: (panel: ActivityPanel) => void;
  changedCount: number;
  onOpenSettings?: () => void;
  /** Opens the "Shared" tab (docs/PLAN-2026-09-05-refresh.md §2) — a
   * sibling of `onOpenSettings`, not a `panel` selection: it doesn't touch
   * the sidebar region at all. */
  onOpenShared?: () => void;
  /** Whether the currently ACTIVE EDITOR TAB is the Shared view, for the
   * rail's active-indicator — independent of `active` (the sidebar
   * region's panel), same split `onOpenShared` has from `onSelect`. */
  sharedActive?: boolean;
  /** Hover/focus intent (TODO §6.1.5) — forwarded so the app can preload
   * the panel's lazy chunk behind pointer/keyboard travel. */
  onItemIntent?: (panel: ActivityPanel) => void;
}

export function AppActivityBar({
  active,
  onSelect,
  changedCount,
  onOpenSettings,
  onOpenShared,
  sharedActive,
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
          id: "shared",
          label: "Shared",
          icon: <Share2 size={19} />,
          active: !!sharedActive,
        },
        {
          id: "extensions",
          label: "Extensions",
          icon: <Blocks size={19} />,
          active: active === "extensions",
        },
      ]}
      onSelect={(id) => (id === "shared" ? onOpenShared?.() : onSelect(id as ActivityPanel))}
      footer={{ id: "settings", label: "Settings", icon: <Settings size={19} /> }}
      onItemIntent={(id) => id !== "shared" && onItemIntent?.(id as ActivityPanel)}
      onFooterSelect={onOpenSettings}
    />
  );
}

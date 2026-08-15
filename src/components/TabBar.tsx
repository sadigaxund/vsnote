/**
 * App tab bar. Thin composition wrapper over `local/EditorTabBar` so the
 * store-facing prop shape (`tabs`, `activeId`, callbacks) is defined once
 * at the app-component boundary.
 */
import { EditorTabBar, type TabDragPayload } from "./local/EditorTabBar";
import type { DockEdge, TabItem } from "../types";

export interface AppTabBarProps {
  paneId: string;
  tabs: TabItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  onDropExternalTab?: (payload: TabDragPayload) => void;
  onSplitTab?: (path: string, edge: Exclude<DockEdge, "center">) => void;
}

export function AppTabBar({ paneId, tabs, activeId, onSelect, onClose, onDropExternalTab, onSplitTab }: AppTabBarProps) {
  return (
    <EditorTabBar
      paneId={paneId}
      tabs={tabs}
      activeId={activeId}
      onSelect={onSelect}
      onClose={onClose}
      onDropExternalTab={onDropExternalTab}
      onSplitTab={onSplitTab}
    />
  );
}

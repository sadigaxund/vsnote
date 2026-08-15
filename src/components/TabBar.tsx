/**
 * App tab bar. Thin composition wrapper over `local/EditorTabBar` so the
 * store-facing prop shape (`tabs`, `activeId`, callbacks) is defined once
 * at the app-component boundary.
 */
import { EditorTabBar } from "./local/EditorTabBar";
import type { TabItem } from "../types";

export interface AppTabBarProps {
  tabs: TabItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
}

export function AppTabBar({ tabs, activeId, onSelect, onClose }: AppTabBarProps) {
  return <EditorTabBar tabs={tabs} activeId={activeId} onSelect={onSelect} onClose={onClose} />;
}

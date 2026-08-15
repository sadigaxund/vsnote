import { useMemo, useState } from "react";
import { AppActivityBar, type ActivityPanel } from "./components/ActivityBar";
import { AppTitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { AppTabBar } from "./components/TabBar";
import { EditorHeader } from "./components/EditorHeader";
import { EditorContent } from "./components/EditorContent";
import { AppStatusBar } from "./components/StatusBar";
import {
  activeBreadcrumb,
  demoGitSummary,
  demoTabs,
  demoVault,
} from "./data/demoVault";
import type { EditorMode, FileNode } from "./types";

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivityPanel>("explorer");
  const [selectedId, setSelectedId] = useState<string>(
    "vault/notes/architecture.md",
  );
  const [tabs, setTabs] = useState(demoTabs);
  const [activeTabId, setActiveTabId] = useState<string>(
    "vault/notes/architecture.md",
  );
  const [mode, setMode] = useState<EditorMode>("rendered");

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId],
  );

  const handleSelectFile = (node: FileNode) => {
    setSelectedId(node.id);
    setActiveTabId(node.id);
    setTabs((prev) =>
      prev.some((t) => t.id === node.id)
        ? prev
        : [
            ...prev,
            {
              id: node.id,
              name: node.name,
              path: node.path,
              kind: node.kind,
              status: node.status,
            },
          ],
    );
  };

  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1]?.id ?? "");
      }
      return next;
    });
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--app-chrome-bg)",
        color: "var(--color-fg)",
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
      }}
    >
      <AppTitleBar vaultName="vault" />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <AppActivityBar
          active={activePanel}
          onSelect={setActivePanel}
          changedCount={demoGitSummary.changedCount}
        />

        {activePanel === "explorer" && (
          <Sidebar tree={demoVault} selectedId={selectedId} onSelect={handleSelectFile} />
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            background: "var(--app-editor-bg)",
          }}
        >
          <AppTabBar
            tabs={tabs}
            activeId={activeTabId}
            onSelect={setActiveTabId}
            onClose={handleCloseTab}
          />
          <EditorHeader
            breadcrumb={activeTab ? activeTab.path.split("/") : activeBreadcrumb}
            diff={demoGitSummary.diff}
            mode={mode}
            onModeChange={setMode}
          />
          <EditorContent />
        </div>
      </div>

      <AppStatusBar
        git={demoGitSummary}
        cursor={{ line: 14, column: 32 }}
        encoding="UTF-8"
        eol="LF"
        language="MD"
      />
    </div>
  );
}

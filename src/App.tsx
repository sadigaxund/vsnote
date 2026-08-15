import { useEffect, useMemo, useState } from "react";
import { AppActivityBar, type ActivityPanel } from "./components/ActivityBar";
import { AppTitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { AppTabBar } from "./components/TabBar";
import { EditorHeader } from "./components/EditorHeader";
import { EditorContent } from "./components/EditorContent";
import { AppStatusBar } from "./components/StatusBar";
import { ensureSeeded } from "./fs/seed";
import { useFsStore } from "./stores/useFsStore";
import { useGitStore } from "./stores/useGitStore";
import { useTabsStore } from "./stores/useTabsStore";
import { useBufferStore } from "./stores/useBufferStore";
import { flushDraftSave } from "./fs/drafts";
import { useDecoratedTree } from "./stores/useDecoratedTree";
import { EMPTY_DIFF } from "./git/diff";
import type { EditorMode, FileKind, FileNode, TabItem } from "./types";

const ACTIVE_ON_BOOT = "vault/notes/architecture.md";

/** Matches app-preview.png's tab strip exactly — seeded once, the first
 * time the app ever boots in a browser (an empty persisted tab state is
 * the only signal we have for "first run", since a returning user's real
 * open tabs must never be clobbered by this). */
const DEFAULT_TABS: Array<{ path: string; name: string; kind: FileKind; pin: boolean }> = [
  { path: "vault/notes/architecture.md", name: "architecture.md", kind: "md", pin: true },
  { path: "vault/src/indexer.ts", name: "indexer.ts", kind: "ts", pin: true },
  { path: "vault/vault.config.json", name: "vault.config.json", kind: "json", pin: true },
  { path: "vault/metrics.csv", name: "metrics.csv", kind: "csv", pin: true },
  { path: "vault/assets/cover.png", name: "cover.png", kind: "image", pin: false },
];

function modeAvailabilityFor(kind: FileKind | undefined, hasDiff: boolean): EditorMode[] {
  if (!kind || kind === "image" || kind === "folder") return [];
  const modes: EditorMode[] = ["source"];
  if (kind === "md") modes.push("rendered");
  if (hasDiff) modes.push("diff");
  return modes;
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "vault" : path.slice(0, idx);
}

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivityPanel>("explorer");
  const [selectedId, setSelectedId] = useState<string | undefined>(ACTIVE_ON_BOOT);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  const tree = useDecoratedTree();
  const fs = useFsStore();
  const git = useGitStore();
  const tabs = useTabsStore();
  const buffers = useBufferStore();

  // ---- Boot: seed (idempotent) then load live fs/git/tab state. ----
  useEffect(() => {
    (async () => {
      await ensureSeeded();
      await Promise.all([useFsStore.getState().refresh(), useGitStore.getState().refresh()]);

      const tabsState = useTabsStore.getState();
      const pane = tabsState.panes[tabsState.activePaneId];
      if (pane && pane.tabs.length === 0) {
        for (const t of DEFAULT_TABS) {
          useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
        }
        useTabsStore.getState().setActiveTab(ACTIVE_ON_BOOT);
      }
      setBooted(true);
    })();
  }, []);

  const pane = tabs.panes[tabs.activePaneId];
  const activeTab = useMemo(() => pane?.tabs.find((t) => t.path === pane.activeTabId), [pane]);

  // Load (or re-use) the active file's buffer whenever it changes — needed
  // for Source mode, the deleted-file fallback, and eventually save/diff.
  useEffect(() => {
    if (activeTab) void useBufferStore.getState().ensureLoaded(activeTab.path);
  }, [activeTab?.path]);

  // Kick off (and cache) the active file's real diff vs HEAD — the single
  // git/diff.ts call the chip, the Diff-mode placeholder, and the status
  // bar all read, so the numbers can never disagree. Depends on
  // `refreshGeneration`, not just the path: a git refresh triggered by an
  // unrelated file op (e.g. dragging a different file) clears the whole
  // diff cache, and the active tab's path doesn't change in that case, so
  // the path alone wouldn't re-trigger this fetch and the chip would go
  // stale/blank until the user switched tabs and back.
  const gitRefreshGeneration = useGitStore((s) => s.refreshGeneration);
  useEffect(() => {
    if (activeTab) void useGitStore.getState().diffFor(activeTab.path);
  }, [activeTab?.path, gitRefreshGeneration]);

  const activeDiff = useGitStore((s) => (activeTab ? (s.diffCache[activeTab.path] ?? EMPTY_DIFF) : EMPTY_DIFF));
  const activeBuffer = useBufferStore((s) => (activeTab ? s.buffers[activeTab.path] : undefined));

  // ⌘S / Ctrl+S saves the active buffer to fs (crude-textarea editing this
  // phase — CodeMirror's save flow replaces this in Phase 3) and refreshes
  // git status/diff so the M/A/D/U letters and +/- numbers never go stale.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTab && useBufferStore.getState().buffers[activeTab.path]?.dirty) {
          void useBufferStore.getState().save(activeTab.path).then(() => useGitStore.getState().refresh());
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab?.path]);

  // Extra safety net for DESIGN-SPEC Amendments item 6 ("closing/reloading
  // the browser NEVER loses unsaved work"): the 300ms debounce in
  // fs/drafts.ts covers normal typing pauses, but a tab closed mid-keystroke
  // (inside that window) would otherwise race it. `visibilitychange` fires
  // reliably on tab close/switch/reload (unlike `beforeunload`, which many
  // browsers no longer let async work run under), so flush every dirty
  // buffer's *current* content immediately, bypassing the debounce, the
  // moment the page is about to go away.
  useEffect(() => {
    function flushAllDirty() {
      if (document.visibilityState !== "hidden") return;
      for (const buf of Object.values(useBufferStore.getState().buffers)) {
        if (buf.dirty) void flushDraftSave(buf.path, buf.content);
      }
    }
    document.addEventListener("visibilitychange", flushAllDirty);
    return () => document.removeEventListener("visibilitychange", flushAllDirty);
  }, []);

  const tabItems: TabItem[] = (pane?.tabs ?? []).map((t) => ({
    id: t.path,
    name: t.name,
    path: t.path,
    kind: t.kind,
    dirty: buffers.buffers[t.path]?.dirty ?? false,
    preview: t.preview,
    status: git.statuses[t.path],
  }));

  const handleSelectFile = (node: FileNode, opts?: { pin?: boolean }) => {
    setSelectedId(node.id);
    if (node.type === "folder") return;
    tabs.openFile({ path: node.path, name: node.name, kind: node.kind }, opts);
    void useBufferStore.getState().ensureLoaded(node.path);
  };

  const handleCloseTab = (path: string) => tabs.closeTab(path);
  const handleTabSelect = (path: string) => {
    tabs.setActiveTab(path);
    setSelectedId(path);
  };

  const handleModeChange = (mode: EditorMode) => {
    if (activeTab) tabs.setMode(activeTab.path, mode);
  };

  function resolveCreateParent(explicitParent?: string): string {
    if (explicitParent) return explicitParent;
    if (!selectedId) return "vault";
    const node = findNode(tree, selectedId);
    if (!node) return "vault";
    return node.type === "folder" ? node.path : parentOf(node.path);
  }

  const handleCreateFile = async (parentPath?: string) => {
    const parent = resolveCreateParent(parentPath);
    const newPath = await fs.createFile(parent, "untitled.md");
    setSelectedId(newPath);
    setRenamingId(newPath);
    tabs.openFile({ path: newPath, name: newPath.slice(newPath.lastIndexOf("/") + 1), kind: "md" }, { pin: true });
    await git.refresh();
  };

  const handleCreateFolder = async (parentPath?: string) => {
    const parent = resolveCreateParent(parentPath);
    const newPath = await fs.createFolder(parent, "untitled-folder");
    setSelectedId(newPath);
    setRenamingId(newPath);
  };

  const handleRequestRename = (node: FileNode) => setRenamingId(node.id);
  const handleRenameCancel = () => setRenamingId(null);

  const handleRenameCommit = async (node: FileNode, newName: string) => {
    setRenamingId(null);
    const newPath = await fs.renameNode(node.path, newName);
    tabs.renamePrefix(node.path, newPath);
    buffers.rekeyPrefix(node.path, newPath);
    setSelectedId((prev) => (prev && (prev === node.path || prev.startsWith(`${node.path}/`)) ? newPath + prev.slice(node.path.length) : prev));
    await git.refresh();
  };

  const handleMove = async (sourcePath: string, targetParentPath: string) => {
    const newPath = await fs.moveNode(sourcePath, targetParentPath);
    tabs.renamePrefix(sourcePath, newPath);
    buffers.rekeyPrefix(sourcePath, newPath);
    setSelectedId((prev) => (prev && (prev === sourcePath || prev.startsWith(`${sourcePath}/`)) ? newPath + prev.slice(sourcePath.length) : prev));
    await git.refresh();
  };

  const handleConfirmDelete = async (node: FileNode) => {
    await fs.removeNode(node.path);
    tabs.closeByPrefix(node.path);
    buffers.forgetPrefix(node.path);
    setSelectedId((prev) => (prev && (prev === node.path || prev.startsWith(`${node.path}/`)) ? undefined : prev));
    await git.refresh();
  };

  const handleCopyPath = (node: FileNode) => {
    navigator.clipboard?.writeText(node.path).catch(() => {});
  };

  const availableModes = modeAvailabilityFor(activeTab?.kind, activeDiff.added > 0 || activeDiff.removed > 0);

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
        <AppActivityBar active={activePanel} onSelect={setActivePanel} changedCount={git.changedCount} />

        {activePanel === "explorer" && (
          <Sidebar
            tree={tree}
            selectedId={selectedId}
            onSelect={handleSelectFile}
            renamingId={renamingId}
            onRenameCommit={handleRenameCommit}
            onRenameCancel={handleRenameCancel}
            onRequestRename={handleRequestRename}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onConfirmDelete={handleConfirmDelete}
            onCopyPath={handleCopyPath}
            onMove={handleMove}
            onRefresh={() => void fs.refresh()}
          />
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
          <AppTabBar tabs={tabItems} activeId={activeTab?.path} onSelect={handleTabSelect} onClose={handleCloseTab} />
          <EditorHeader
            breadcrumb={activeTab ? activeTab.path.split("/") : ["vault"]}
            diff={activeDiff}
            mode={activeTab?.mode ?? "source"}
            onModeChange={handleModeChange}
            availableModes={availableModes}
          />
          <EditorContent
            hasTab={!!activeTab}
            path={activeTab?.path}
            kind={activeTab?.kind}
            mode={activeTab?.mode ?? "source"}
            content={activeBuffer?.content ?? ""}
            loaded={activeBuffer?.loaded ?? false}
            missing={activeBuffer?.missing ?? false}
            diff={activeDiff}
            onChange={(value) => {
              if (activeTab) useBufferStore.getState().setContent(activeTab.path, value);
            }}
          />
        </div>
      </div>

      <AppStatusBar
        git={{
          branch: git.branch,
          ahead: git.ahead,
          behind: git.behind,
          syncedLabel: git.syncedLabel,
          diff: activeDiff,
          untracked: git.untrackedCount,
          changedCount: git.changedCount,
        }}
        // Real Ln/Col tracking needs a real editor selection — CodeMirror
        // lands in Phase 3. Kept at the app-preview.png value in the
        // meantime rather than a fake "1,1" that would regress the pixel
        // match for no functional gain (a crude textarea's cursor position
        // isn't meaningfully "real" either way at this phase).
        cursor={{ line: 14, column: 32 }}
        encoding="UTF-8"
        eol="LF"
        language={(activeTab?.kind ?? "").toUpperCase() || "PLAIN"}
      />

      {!booted && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--app-chrome-bg)",
            color: "var(--color-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          Seeding demo vault…
        </div>
      )}
    </div>
  );
}

function findNode(nodes: FileNode[], id: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

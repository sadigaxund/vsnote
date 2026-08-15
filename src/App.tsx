import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, useToast } from "my-you-eye";
import { AppActivityBar, type ActivityPanel } from "./components/ActivityBar";
import { AppTitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { SourceControlPanel } from "./components/SourceControlPanel";
import { AppTabBar } from "./components/TabBar";
import { EditorHeader } from "./components/EditorHeader";
import { EditorContent } from "./components/EditorContent";
import { AppStatusBar } from "./components/StatusBar";
import { ensureSeeded, resetDemoVault } from "./fs/seed";
import { useFsStore, inferFileKind } from "./stores/useFsStore";
import { useGitStore } from "./stores/useGitStore";
import { useTabsStore } from "./stores/useTabsStore";
import { useBufferStore } from "./stores/useBufferStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { flushDraftSave } from "./fs/drafts";
import { useDecoratedTree } from "./stores/useDecoratedTree";
import { EMPTY_DIFF } from "./git/diff";
import { fileTypeFor } from "./filetypes/registry";
import { getActiveEditorView, openSearchInActiveView } from "./editor/activeView";
import { resolveMarkdownLink } from "./editor/livepreview/links";
import { modeAvailabilityFor } from "./filetypes/registry";
import { pathExists } from "./fs/operations";
import { displayToFsPath } from "./fs/paths";
import { flattenFiles } from "./lib/flattenTree";
import type { CursorPos } from "./editor/CodeMirrorEditor";
import type { EditorMode, FileKind, FileNode, TabItem } from "./types";

// Phase 5a: CommandPalette / Settings / Search are all overlay/panel UI a
// user may never open in a given session (⌘K/⌘P, the gear icon, the Search
// activity-rail icon) — `React.lazy` keeps their imports (the library's
// `CommandPalette`/`Select`/`Slider`/`RadioGroup`/`Switch`/`FormField`, and
// the vault-search walk) out of the cold-boot bundle until first opened,
// matching `EditorContent.tsx`'s existing lazy-surface pattern.
const CommandPaletteHost = lazy(() =>
  import("./components/CommandPaletteHost").then((m) => ({ default: m.CommandPaletteHost })),
);
const SettingsDialog = lazy(() => import("./components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })));
const SearchPanel = lazy(() => import("./components/SearchPanel").then((m) => ({ default: m.SearchPanel })));

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

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "vault" : path.slice(0, idx);
}

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivityPanel>("explorer");
  const [selectedId, setSelectedId] = useState<string | undefined>(ACTIVE_ON_BOOT);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [cursor, setCursor] = useState<CursorPos>({ line: 1, column: 1 });

  // Phase 5a UI state — palette (⌘K grouped / ⌘P file-jump), Settings
  // dialog, Zen mode (DESIGN-SPEC Amendments item 4), the "Reset demo
  // vault" confirm step, and a pending line to jump to once a search
  // result's target file/mode has finished opening (see the effect below).
  const [paletteMode, setPaletteMode] = useState<"files" | "commands" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [zenPillHovered, setZenPillHovered] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number } | null>(null);
  // Snapshot of whichever CM6 view was registered at the moment a jump was
  // requested — see the polling effect below for why this matters (it lets
  // that effect tell "a fresh view mounted" apart from "still reading the
  // view that's about to be torn down").
  const pendingJumpStaleView = useRef<ReturnType<typeof getActiveEditorView>>(null);
  const { toast } = useToast();

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

  // The status bar's cursor readout is only meaningful with a real CM6
  // selection behind it (Source/Diff modes) — `onCursorChange` keeps
  // `cursor` current while one is mounted. Derived (not reset via an
  // effect) so switching to Rendered mode/no tab shows the neutral value
  // without a render lag.
  const displayCursor: CursorPos = activeTab && (activeTab.mode === "source" || activeTab.mode === "diff") ? cursor : { line: 1, column: 1 };

  // DESIGN-SPEC "⌘E toggle Rendered/Source (Obsidian muscle memory)" — a
  // named function (not inlined in the keydown handler below) since both
  // the ⌘E shortcut AND the command palette's "Toggle Rendered / Source"
  // action need the exact same logic. Only meaningful when the active file
  // actually has both — a code file with Rendered disabled just keeps this
  // a no-op rather than toggling into a mode the segmented control
  // wouldn't offer.
  function toggleRenderedSource(): void {
    const tab = useTabsStore.getState().activePane().tabs.find((t) => t.path === activeTab?.path);
    if (!tab) return;
    const modes = modeAvailabilityFor(tab.kind, false);
    if (!modes.includes("rendered")) return;
    useTabsStore.getState().setMode(tab.path, tab.mode === "rendered" ? "source" : "rendered");
  }

  // Best-effort ⌘W (DESIGN-SPEC Amendments item 5: "⌘W is best-effort —
  // browsers may reserve it"): closes the active tab when the browser lets
  // the keydown through at all (many browsers intercept Ctrl/⌘W before any
  // page JS ever sees it, which `preventDefault` cannot undo — a browser-
  // level reservation, not a bug here). ⌘⇧W is the guaranteed fallback,
  // documented in the command palette's "Close tab" shortcut hint.
  function closeActiveTab(): void {
    if (activeTab) useTabsStore.getState().closeTab(activeTab.path);
  }

  // "Latest ref" pattern (same one `editor/CodeMirrorEditor.tsx`'s
  // `onChangeRef`/`onCursorChangeRef` already use) so the global keydown
  // effect below — deliberately scoped to `[activeTab?.path]`, not every
  // render — can always call the CURRENT `toggleRenderedSource`/
  // `closeActiveTab` (both plain functions recreated every render) without
  // either going stale or forcing the effect (and its
  // addEventListener/removeEventListener churn) to rerun on every render.
  const toggleRenderedSourceRef = useRef(toggleRenderedSource);
  const closeActiveTabRef = useRef(closeActiveTab);
  useEffect(() => {
    toggleRenderedSourceRef.current = toggleRenderedSource;
    closeActiveTabRef.current = closeActiveTab;
  });

  function enterZenMode(): void {
    setZenMode(true);
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function exitZenMode(): void {
    setZenMode(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // Functional `setZenMode` update (not "read `zenMode`, then branch") so
  // this stays correct when called from the global keydown effect below,
  // whose closure is only recreated when `activeTab?.path` changes — a
  // plain `if (zenMode) ... else ...` here would toggle against whatever
  // `zenMode` was at that last path change, not the current value.
  function toggleZenMode(): void {
    setZenMode((prev) => {
      const next = !prev;
      if (next) {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return next;
    });
  }

  async function handleSyncNow(): Promise<void> {
    await useGitStore.getState().syncNow();
    const { ahead, behind } = useGitStore.getState();
    toast({
      title: "Synced with remote",
      description: ahead === 0 && behind === 0 ? "Up to date." : `↑${ahead} ↓${behind}`,
      variant: "success",
    });
  }

  async function handleResetVaultConfirmed(): Promise<void> {
    await resetDemoVault();
    // The reseeded vault is byte-identical to boot's demo content at the
    // same paths, but every in-memory buffer/tab/selection is now stale
    // (a buffer's `loaded` flag would otherwise skip re-reading from fs —
    // see `useBufferStore.ensureLoaded`) — clear and reopen exactly like a
    // fresh boot rather than leaving a half-stale session behind.
    useBufferStore.setState({ buffers: {} });
    await Promise.all([useFsStore.getState().refresh(), useGitStore.getState().refresh()]);
    useTabsStore.setState({
      panes: { root: { id: "root", tabs: [], activeTabId: undefined } },
      activePaneId: "root",
    });
    for (const t of DEFAULT_TABS) {
      useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
    }
    useTabsStore.getState().setActiveTab(ACTIVE_ON_BOOT);
    setSelectedId(ACTIVE_ON_BOOT);
    toast({ title: "Demo vault reset", description: "Filesystem and git history re-seeded from scratch.", variant: "success" });
  }

  // DESIGN-SPEC Amendments item 5 ("Own the browser shortcuts"): one global
  // keydown handler that `preventDefault`s and owns every shortcut this app
  // claims while it has focus, so the browser's own bindings never win:
  // ⌘S (save), ⌘F (open OUR CM6 search panel, never the browser's find
  // bar), ⌘E (toggle Rendered/Source), ⌘K (command palette), ⌘P (file
  // jump), ⌘W / ⌘⇧W (close tab — best-effort / guaranteed fallback, see
  // `closeActiveTab`'s doc), ⌘⇧Z (zen mode).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (activeTab && useBufferStore.getState().buffers[activeTab.path]?.dirty) {
          void useBufferStore.getState().save(activeTab.path).then(() => useGitStore.getState().refresh());
        }
      } else if (key === "f") {
        e.preventDefault();
        void openSearchInActiveView();
      } else if (key === "e") {
        e.preventDefault();
        toggleRenderedSourceRef.current();
      } else if (key === "k") {
        e.preventDefault();
        setPaletteMode("commands");
      } else if (key === "p") {
        e.preventDefault();
        setPaletteMode("files");
      } else if (key === "w") {
        e.preventDefault();
        closeActiveTabRef.current();
      } else if (key === "z" && e.shiftKey) {
        e.preventDefault();
        toggleZenMode();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab?.path]);

  // Esc exits zen mode (DESIGN-SPEC Amendments item 4) — scoped to only
  // listen while zen mode is actually active, so it never competes with
  // Escape's normal jobs elsewhere (closing dialogs/the palette, CM6's own
  // search-panel Escape binding).
  useEffect(() => {
    if (!zenMode) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        exitZenMode();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zenMode]);

  // A search result's file may need to open (new tab) and/or switch to
  // Source mode before its CM6 EditorView exists to jump a selection into —
  // both happen synchronously in `handleSearchOpenResult` below, but the
  // EditorView mount is a child-component effect (`CodeMirrorEditor.tsx`'s)
  // that only runs after THIS render commits, and — the real gotcha,
  // confirmed empirically during Phase 5a verification with a temporary
  // debug trace — `CodeMirrorEditor` is `React.lazy`-loaded (`EditorContent.
  // tsx`): switching a tab from Rendered to Source for the FIRST time in a
  // session means that chunk hasn't downloaded yet, so the outgoing
  // `LivePreviewEditor`'s view (still `.cm-editor` with no `.cm-gutters`,
  // no line numbers) stays the one `getActiveEditorView()` returns for the
  // whole time its `<Suspense>` fallback is showing — a same-tick/next-rAF
  // read reliably grabbed that STALE, about-to-be-torn-down view and
  // dispatched the jump to it for nothing (confirmed: `hasView: true` but
  // `hasGutter: false` in the trace, cursor stayed at Ln 1, Col 1).
  // `pendingJumpStaleView` below is a snapshot of whatever view was
  // registered at request time; this effect polls until a *different* view
  // shows up (i.e. an actual remount happened) — falling back to whatever's
  // registered once the attempt budget runs out, which also correctly
  // covers the "no remount needed at all" case (jumping within the file/
  // mode already on screen), where the "stale" and final view are the same
  // object by design.
  useEffect(() => {
    if (!pendingJump || activeTab?.path !== pendingJump.path) return;
    let raf = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // ~1s at 60fps — generous for a lazy-chunk fetch
    function tick() {
      const view = getActiveEditorView();
      attempts++;
      const isFresh = !!view && view !== pendingJumpStaleView.current;
      const outOfAttempts = attempts >= MAX_ATTEMPTS;
      if (view && (isFresh || outOfAttempts)) {
        const clamped = Math.min(pendingJump!.line, view.state.doc.lines);
        const lineInfo = view.state.doc.line(Math.max(1, clamped));
        view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
        view.focus();
        setPendingJump(null);
        return;
      }
      if (outOfAttempts) {
        setPendingJump(null); // give up quietly rather than poll forever
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pendingJump, activeTab?.path]);

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

  // Source Control panel row click: opens (or focuses) the file pinned,
  // straight into Diff mode — every changed file the panel lists has a
  // nonzero diff by construction, so Diff is always a valid mode for it.
  const handleOpenDiff = (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const kind = inferFileKind(name);
    tabs.openFile({ path, name, kind }, { pin: true });
    tabs.setMode(path, "diff");
    setSelectedId(path);
    void useBufferStore.getState().ensureLoaded(path);
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
    // A folder rename remaps many descendant tab paths whose own filenames
    // (and therefore kind) never changed — only a file rename can change
    // its own extension, so `setKind` only ever applies to that one tab.
    if (node.type === "file") {
      tabs.setKind(newPath, inferFileKind(newName));
    }
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

  // DESIGN-SPEC "Internal links [text](file.ext) ... open that file in a
  // tab when clicked" — the live-preview `LinkWidget`'s click handler
  // (editor/livepreview/widgets.ts) calls this with the raw href; external
  // links (http(s)://, mailto:, …) open in a real browser tab instead.
  const handleOpenLink = async (href: string) => {
    if (!activeTab) return;
    const resolved = resolveMarkdownLink(activeTab.path, href);
    if (resolved.kind === "external") {
      window.open(resolved.href, "_blank", "noopener,noreferrer");
      return;
    }
    const fsPath = displayToFsPath(resolved.path);
    if (!(await pathExists(fsPath))) return;
    const name = resolved.path.slice(resolved.path.lastIndexOf("/") + 1);
    const kind = inferFileKind(name);
    tabs.openFile({ path: resolved.path, name, kind });
    setSelectedId(resolved.path);
    void useBufferStore.getState().ensureLoaded(resolved.path);
  };

  const availableModes = modeAvailabilityFor(activeTab?.kind, activeDiff.added > 0 || activeDiff.removed > 0);

  // Command palette (⌘K/⌘P) file-jump: opens exactly like clicking the file
  // in the Explorer (a pinned tab, since a palette pick is a deliberate
  // "go to" action, not the tree's hover-preview affordance).
  const handlePaletteFileSelect = (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const kind = inferFileKind(name);
    tabs.openFile({ path, name, kind }, { pin: true });
    setSelectedId(path);
    void useBufferStore.getState().ensureLoaded(path);
  };

  // Search activity view result click: opens the file, forces Source mode
  // (every kind supports it — the one mode a raw line number is always
  // meaningful in, including for kinds whose default is Rendered) and
  // queues the line jump the effect above performs once that file's CM6
  // view mounts.
  const handleSearchOpenResult = (path: string, line: number) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const kind = inferFileKind(name);
    pendingJumpStaleView.current = getActiveEditorView();
    tabs.openFile({ path, name, kind }, { pin: true });
    tabs.setMode(path, "source");
    setSelectedId(path);
    void useBufferStore.getState().ensureLoaded(path);
    setPendingJump({ path, line });
  };

  // Command palette's "Commands" group (DESIGN-SPEC "Misc / settings":
  // "commands (toggle mode, theme, sync, new file…)" + Amendments item 4
  // "zen mode" + item 5's ⌘W fallback, surfaced here so it's discoverable
  // even though the shortcut itself is best-effort).
  const paletteCommands = [
    { id: "toggle-mode", label: "Toggle Rendered / Source", shortcut: "⌘E" },
    { id: "toggle-theme", label: "Toggle theme" },
    { id: "sync", label: "Sync now (push & pull)" },
    { id: "new-file", label: "New file" },
    { id: "reset-vault", label: "Reset demo vault…" },
    { id: "zen", label: "Toggle zen mode", shortcut: "⌘⇧Z" },
    { id: "search", label: "Search in files" },
    { id: "save", label: "Save file", shortcut: "⌘S" },
    { id: "close-tab", label: "Close tab", shortcut: "⌘W / ⌘⇧W" },
    { id: "settings", label: "Open settings…" },
  ];

  const handlePaletteCommand = (id: string) => {
    switch (id) {
      case "toggle-mode":
        toggleRenderedSource();
        break;
      case "toggle-theme":
        useSettingsStore.getState().cycleTheme();
        break;
      case "sync":
        void handleSyncNow();
        break;
      case "new-file":
        void handleCreateFile();
        break;
      case "reset-vault":
        setResetConfirmOpen(true);
        break;
      case "zen":
        toggleZenMode();
        break;
      case "search":
        setActivePanel("search");
        break;
      case "save":
        if (activeTab && useBufferStore.getState().buffers[activeTab.path]?.dirty) {
          void useBufferStore.getState().save(activeTab.path).then(() => useGitStore.getState().refresh());
        }
        break;
      case "close-tab":
        closeActiveTab();
        break;
      case "settings":
        setSettingsOpen(true);
        break;
    }
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
      <AppTitleBar vaultName="vault" onOpenSettings={() => setSettingsOpen(true)} />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* DESIGN-SPEC Amendments item 4 ("Zen mode ... hides activity bar,
            sidebar, tab bar, editor header, status bar"): every region
            below wraps in `!zenMode &&` — the title bar (above) stays
            visible, matching the item's own literal five-region list. */}
        {!zenMode && (
          <AppActivityBar
            active={activePanel}
            onSelect={setActivePanel}
            changedCount={git.changedCount}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {!zenMode && activePanel === "explorer" && (
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

        {!zenMode && activePanel === "scm" && <SourceControlPanel onOpenDiff={handleOpenDiff} />}

        {!zenMode && activePanel === "search" && (
          <Suspense fallback={<div style={{ width: 288, flexShrink: 0, background: "var(--app-sidebar-bg)", borderRight: "1px solid var(--app-chrome-border)" }} />}>
            <SearchPanel onOpenResult={handleSearchOpenResult} />
          </Suspense>
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            position: "relative",
            background: "var(--app-editor-bg)",
          }}
          onMouseEnter={() => zenMode && setZenPillHovered(true)}
          onMouseLeave={() => zenMode && setZenPillHovered(false)}
        >
          {!zenMode && (
            <>
              <AppTabBar tabs={tabItems} activeId={activeTab?.path} onSelect={handleTabSelect} onClose={handleCloseTab} />
              <EditorHeader
                breadcrumb={activeTab ? activeTab.path.split("/") : ["vault"]}
                diff={activeDiff}
                mode={activeTab?.mode ?? "source"}
                onModeChange={handleModeChange}
                availableModes={availableModes}
                onEnterZen={enterZenMode}
              />
            </>
          )}
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
            onCursorChange={setCursor}
            onOpenLink={(href) => void handleOpenLink(href)}
          />

          {zenMode && (
            <div
              role="status"
              onClick={exitZenMode}
              style={{
                position: "absolute",
                top: 14,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 999,
                background: "color-mix(in oklab, var(--app-titlebar-bg) 88%, transparent)",
                border: "1px solid var(--app-chrome-border)",
                color: "var(--color-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                cursor: "pointer",
                opacity: zenPillHovered ? 1 : 0,
                transition: "opacity 150ms ease",
                pointerEvents: zenPillHovered ? "auto" : "none",
              }}
            >
              <span style={{ color: "var(--color-fg)" }}>{activeTab?.name ?? "vault"}</span>
              <span>·</span>
              <span>Esc to exit</span>
            </div>
          )}
        </div>
      </div>

      {!zenMode && (
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
          // Live from the mounted CM6 view's selection (Source/Diff modes) —
          // see `displayCursor` above for Rendered mode/no-tab.
          cursor={displayCursor}
          encoding="UTF-8"
          eol="LF"
          language={fileTypeFor(activeTab?.kind)?.languageId ?? "PLAIN"}
          onSync={() => void handleSyncNow()}
        />
      )}

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

      {paletteMode && (
        <Suspense fallback={null}>
          <CommandPaletteHost
            mode={paletteMode}
            open={paletteMode !== null}
            onOpenChange={(open) => !open && setPaletteMode(null)}
            files={flattenFiles(tree)}
            commands={paletteCommands}
            onSelectFile={handlePaletteFileSelect}
            onSelectCommand={handlePaletteCommand}
          />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}

      <ConfirmDialog
        title="Reset demo vault?"
        description="Wipes the in-browser filesystem and git history and re-seeds the original demo vault from scratch. Any files or edits you've made are lost."
        confirmLabel="Reset"
        destructive
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        onConfirm={() => void handleResetVaultConfirmed()}
      />
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

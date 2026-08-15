import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, useToast } from "my-you-eye";
import { AppActivityBar, type ActivityPanel } from "./components/ActivityBar";
import { AppTitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { SourceControlPanel } from "./components/SourceControlPanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { EditorArea } from "./components/EditorArea";
import { AppStatusBar } from "./components/StatusBar";
import { ensureSeeded, resetDemoVault } from "./fs/seed";
import { requestPersistentStorage, type StoragePersistenceStatus } from "./fs/persistence";
import { downloadBlob, exportVaultZip, vaultZipFilename } from "./fs/exportZip";
import { SYNC_DRIFT_INTERVAL_MS, SYNC_DRIFT_PROBABILITY } from "./git/remote";
import { useFsStore, inferFileKind } from "./stores/useFsStore";
import { useGitStore } from "./stores/useGitStore";
import { findLeaf, useTabsStore } from "./stores/useTabsStore";
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
import { probeRender } from "./lib/renderProbe";
import { SETTINGS_TAB_NAME, SETTINGS_TAB_PATH } from "./lib/settingsTab";
import type { FileKind, FileNode } from "./types";

// Phase 5a: CommandPalette / Search are overlay/panel UI a user may never
// open in a given session (⌘K/⌘P, the Search activity-rail icon) —
// `React.lazy` keeps their imports out of the cold-boot bundle until first
// opened, matching `EditorContent.tsx`'s existing lazy-surface pattern.
// Settings (Phase 6.5c, DESIGN-SPEC Amendments item 11) is no longer a
// dialog opened this way — it's a real tab, lazy-loaded the same way every
// other Rendered-mode renderer is (`EditorContent.tsx`'s own `SettingsView`
// import), not a special case here.
const CommandPaletteHost = lazy(() =>
  import("./components/CommandPaletteHost").then((m) => ({ default: m.CommandPaletteHost })),
);
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
  // DESIGN-SPEC Amendments item 16 (typing-latency bug) instrumentation —
  // see `lib/renderProbe.ts`'s doc. Inert unless a profiling script opts
  // in; left in place as a standing regression guard.
  probeRender("App");

  const [activePanel, setActivePanel] = useState<ActivityPanel>("explorer");
  const [selectedId, setSelectedId] = useState<string | undefined>(ACTIVE_ON_BOOT);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  // Phase 5a UI state — palette (⌘K grouped / ⌘P file-jump), Zen mode
  // (DESIGN-SPEC Amendments item 4), the "Reset demo vault" confirm step,
  // and a pending line to jump to once a search result's target file/mode
  // has finished opening (see the effect below). Settings (Phase 6.5c) no
  // longer needs its own open/close boolean here — it's a tab, opened via
  // `handleOpenSettings` below the same way any other file open is.
  const [paletteMode, setPaletteMode] = useState<"files" | "commands" | null>(null);
  const [zenMode, setZenMode] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // Phase 5b durability: result of the boot-time `navigator.storage.persist()`
  // request (see `fs/persistence.ts`) — undefined until that resolves, so
  // the status-bar warning only ever appears once we actually know it was
  // denied, never as a flash-of-warning before the request settles.
  const [storagePersistence, setStoragePersistence] = useState<StoragePersistenceStatus | undefined>(undefined);
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number } | null>(null);
  // Snapshot of whichever CM6 view was registered at the moment a jump was
  // requested — see the polling effect below for why this matters (it lets
  // that effect tell "a fresh view mounted" apart from "still reading the
  // view that's about to be torn down").
  const pendingJumpStaleView = useRef<ReturnType<typeof getActiveEditorView>>(null);
  const { toast } = useToast();

  const tree = useDecoratedTree();
  const git = useGitStore();
  const tabs = useTabsStore();
  // Targeted selector (DESIGN-SPEC Amendments item 10) — only re-renders App
  // while the sidebar is actually being dragged, never on an unrelated
  // settings change (every other `useSettingsStore` field is read via
  // `.getState()` at the point of use, same discipline as `fs`/`buffers`
  // below).
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  // Targeted selector, same discipline as `sidebarWidth` above — DESIGN-SPEC
  // Amendments round 3 item 20 ("Sidebar collapse/expand").
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  // DESIGN-SPEC Amendments item 16 (typing-latency bug): `useFsStore()`/
  // `useBufferStore()` used to be called here with NO selector — the
  // zustand anti-pattern of subscribing to an entire store's state, which
  // re-renders the calling component on ANY change to ANY field in that
  // store. `fs`/`buffers` below were never actually read for anything
  // rendered (only for imperative action calls inside event handlers, e.g.
  // `fs.createFile(...)`, `buffers.rekeyPrefix(...)`) — but `buffers`
  // changes on EVERY keystroke (`useBufferStore.setContent`), so that bare
  // subscription alone re-rendered the entire App shell once per keystroke,
  // even after cursor position and the buffer selectors elsewhere were
  // fixed to be targeted. Confirmed via the render-count probe
  // (`lib/renderProbe.ts`): App's render count stayed 1:1 with keystrokes
  // typed until this was fixed too. Every call site below now reads
  // `useFsStore.getState()`/`useBufferStore.getState()` directly (the same
  // non-reactive pattern this file already uses for `useGitStore.getState()`
  // /`useBufferStore.getState()` in several handlers) instead of subscribing.

  // ---- Boot: seed (idempotent) then load live fs/git/tab state. ----
  useEffect(() => {
    (async () => {
      await ensureSeeded();
      await Promise.all([useFsStore.getState().refresh(), useGitStore.getState().refresh()]);

      const tabsState = useTabsStore.getState();
      const leaf = findLeaf(tabsState.tree, tabsState.activePaneId);
      if (leaf && leaf.tabs.length === 0) {
        for (const t of DEFAULT_TABS) {
          useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
        }
        useTabsStore.getState().setActiveTab(ACTIVE_ON_BOOT);
      }
      setBooted(true);
    })();

    // Phase 5b durability safeguard (IMPLEMENTATION-PLAN.md Phase 5):
    // request persistent storage for the IndexedDB-backed vault. Runs
    // independently of the seed/tab-restore chain above — it never blocks
    // first paint, and a denial only ever produces the muted status-bar
    // warning (`fs/persistence.ts`'s doc), never a dialog or toast.
    void requestPersistentStorage().then(setStoragePersistence);
  }, []);

  // Phase 5b "ahead/behind drift" (IMPLEMENTATION-PLAN.md Phase 5 sync-
  // lifecycle polish) — see `git/remote.ts`'s doc on the interval/
  // probability constants. Skips a tick while the tab is hidden so a
  // backgrounded session doesn't rack up drift the user never sees land.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Math.random() < SYNC_DRIFT_PROBABILITY) useGitStore.getState().driftIncrement();
    }, SYNC_DRIFT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Phase 6: "the active tab" is now the FOCUSED pane's active tab —
  // `tabs.activePaneId` doubles as "which pane the user last interacted
  // with" (see `useTabsStore.ts`'s module doc). Every pane's own buffer-
  // load / diff-fetch effects now live in `EditorPane.tsx` (each pane runs
  // them for its own active tab, idempotently, against the SAME shared
  // `useBufferStore`/`useGitStore` caches this file used to fetch into
  // directly) — the focused pane is always mounted (in the grid, or alone
  // in zen mode), so its fetch always runs and `activeDiff` below reads a
  // cache that's already warm by the time this component needs it.
  const focusedLeaf = useMemo(() => findLeaf(tabs.tree, tabs.activePaneId), [tabs.tree, tabs.activePaneId]);
  const activeTab = useMemo(() => focusedLeaf?.tabs.find((t) => t.path === focusedLeaf.activeTabId), [focusedLeaf]);

  const activeDiff = useGitStore((s) => (activeTab ? (s.diffCache[activeTab.path] ?? EMPTY_DIFF) : EMPTY_DIFF));

  // DESIGN-SPEC Amendments round 3 item 18 ("Header consolidation") — the
  // title bar always mirrors the FOCUSED pane's mode/diff/breadcrumb state,
  // computed here from the same `activeTab`/`activeDiff` the status bar
  // already reads (single source, same discipline as every other "numbers
  // must agree" spot in this app — see ARCHITECTURE.md's Deviations note on
  // the status bar's diff figure). No breadcrumb (and therefore no mode
  // toggle / diff chip cluster) when there's no tab open, or the focused
  // tab is the virtual Settings view — same "no editor surface" case
  // `filetypes/registry.ts`'s `modeAvailabilityFor` already returns `[]`
  // for.
  const titlebarAvailableModes = modeAvailabilityFor(activeTab?.kind, activeDiff.added > 0 || activeDiff.removed > 0);
  const titlebarBreadcrumb = activeTab && activeTab.kind !== "settings" ? activeTab.path.split("/") : undefined;
  const titlebarDiffLayout = focusedLeaf?.diffLayout ?? "split";

  // DESIGN-SPEC "⌘E toggle Rendered/Source (Obsidian muscle memory)" — a
  // named function (not inlined in the keydown handler below) since both
  // the ⌘E shortcut AND the command palette's "Toggle Rendered / Source"
  // action need the exact same logic. Only meaningful when the active file
  // actually has both — a code file with Rendered disabled just keeps this
  // a no-op rather than toggling into a mode the segmented control
  // wouldn't offer.
  function toggleRenderedSource(): void {
    if (!activeTab) return;
    const modes = modeAvailabilityFor(activeTab.kind, false);
    if (!modes.includes("rendered")) return;
    useTabsStore.getState().setMode(activeTab.path, activeTab.mode === "rendered" ? "source" : "rendered");
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

  // Phase 5b "Export vault as .zip" (IMPLEMENTATION-PLAN.md Phase 5
  // durability bullet) — reads the real vault off lightning-fs and zips it
  // client-side (`fs/exportZip.ts`; `fflate` is dynamically imported inside
  // that module so it never touches the boot bundle). A toast either way:
  // success reports the file count, failure surfaces the error instead of
  // failing silently on what's explicitly a backup/safety feature.
  async function handleExportVaultZip(): Promise<void> {
    try {
      const { blob, fileCount } = await exportVaultZip();
      downloadBlob(blob, vaultZipFilename());
      toast({
        title: "Vault exported",
        description: `${fileCount} file${fileCount === 1 ? "" : "s"} zipped and downloaded.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not build the vault archive.",
        variant: "danger",
      });
    }
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
      tree: { type: "leaf", id: "root", tabs: [], activeTabId: undefined },
      activePaneId: "root",
    });
    for (const t of DEFAULT_TABS) {
      useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
    }
    useTabsStore.getState().setActiveTab(ACTIVE_ON_BOOT);
    setSelectedId(ACTIVE_ON_BOOT);
    // Pre-existing gap found during Phase 6 verification (unrelated to the
    // pane-tree work, but a real bug): the library's `ConfirmDialog` only
    // auto-closes via its "Cancel" button (wrapped in Radix `Dialog.Close`
    // — see `node_modules/my-you-eye/dist/index.js`'s `ConfirmDialog`); the
    // confirm button just calls `onConfirm` and leaves `open` alone, so the
    // caller must close it. Every other `ConfirmDialog` in this app
    // (`Sidebar.tsx`'s delete confirm) already does this; this one never
    // did, so the dialog stayed open (with the toast now visible behind it)
    // after every "Reset" click.
    setResetConfirmOpen(false);
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

  // DESIGN-SPEC Amendments item 19 ("Single-Esc fullscreen exit"): the
  // keydown handler above is not enough on its own — when `enterZenMode`'s
  // `requestFullscreen()` succeeded, the BROWSER itself intercepts the
  // first Escape press to leave fullscreen before (or instead of) our own
  // `keydown` listener ever sees it (confirmed empirically: a scripted
  // single Escape press left `zenMode` still `true` even though
  // `document.fullscreenElement` had already gone `null`) — so relying on
  // `keydown` alone needs a SECOND press once the browser is no longer
  // intercepting. Fixed by also listening for the browser's own native
  // `fullscreenchange` event, which fires reliably whenever fullscreen
  // ends for ANY reason (this exact Esc-swallow case, `exitZenMode`'s own
  // `document.exitFullscreen()` call below, the user pressing a
  // browser-chrome fullscreen-exit control, F11, ...): if fullscreen just
  // ended while zen was still logically active, exit zen in that SAME
  // event instead of waiting for a second Escape. A functional `setZenMode`
  // update (not `exitZenMode()`) is deliberate here — this handler must
  // never itself call `document.exitFullscreen()` (fullscreen has, by
  // definition, already ended by the time this fires), so it can't
  // recurse into re-triggering itself; calling `setZenMode(false)` a
  // second time (e.g. right after `exitZenMode()`'s own
  // `document.exitFullscreen()` call resolves and fires this same event)
  // is a plain idempotent no-op, not a double-toggle or a re-entry into
  // zen. Runs unconditionally (mount-once, not scoped to `zenMode`) since
  // it must be listening BEFORE the browser-intercepted first Escape ever
  // happens.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        setZenMode((prev) => (prev ? false : prev));
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

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

  // DESIGN-SPEC Amendments round 3 item 20 — VSCode's own activity-bar
  // semantics: clicking the CURRENTLY-active view's icon toggles the side
  // panel closed/open in place; clicking a DIFFERENT view's icon switches
  // to (and always shows) that view, uncollapsing if it was collapsed.
  // Width/collapsed-ness are properties of the sidebar REGION, not any one
  // view (course-corrected after the first pass at item 20 bound them to
  // the Explorer panel specifically — see `local/SidebarContainer.tsx`'s
  // doc) — every activity-bar icon opens a view that renders itself inside
  // the SAME shared shell, so `sidebarCollapsed` behaves identically
  // regardless of which panel (Explorer/Search/Source Control/Extensions)
  // it currently shows.
  const handleActivitySelect = (panel: ActivityPanel) => {
    if (panel === activePanel) {
      useSettingsStore.getState().toggleSidebarCollapsed();
    } else {
      setActivePanel(panel);
      useSettingsStore.getState().setSidebarCollapsed(false);
    }
  };

  const handleSelectFile = (node: FileNode, opts?: { pin?: boolean }) => {
    setSelectedId(node.id);
    if (node.type === "folder") return;
    tabs.openFile({ path: node.path, name: node.name, kind: node.kind }, opts);
    void useBufferStore.getState().ensureLoaded(node.path);
  };

  // DESIGN-SPEC Amendments item 11 — Settings is a real tab now (gear icon
  // in the title bar / activity bar footer, ⌘K's "Open settings…" command),
  // opened exactly like any other file open: `useTabsStore.openFile` with
  // `kind: "settings"` (never a real fs path — see `lib/settingsTab.ts`).
  // No `useBufferStore.ensureLoaded` call (unlike `handleSelectFile` above)
  // — `EditorPane.tsx` deliberately skips buffer/diff fetching entirely for
  // this kind, since there's no fs content behind it.
  const handleOpenSettings = () => {
    tabs.openFile({ path: SETTINGS_TAB_PATH, name: SETTINGS_TAB_NAME, kind: "settings" }, { pin: true });
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
    const newPath = await useFsStore.getState().createFile(parent, "untitled.md");
    setSelectedId(newPath);
    setRenamingId(newPath);
    tabs.openFile({ path: newPath, name: newPath.slice(newPath.lastIndexOf("/") + 1), kind: "md" }, { pin: true });
    await git.refresh();
  };

  const handleCreateFolder = async (parentPath?: string) => {
    const parent = resolveCreateParent(parentPath);
    const newPath = await useFsStore.getState().createFolder(parent, "untitled-folder");
    setSelectedId(newPath);
    setRenamingId(newPath);
  };

  const handleRequestRename = (node: FileNode) => setRenamingId(node.id);
  const handleRenameCancel = () => setRenamingId(null);

  const handleRenameCommit = async (node: FileNode, newName: string) => {
    setRenamingId(null);
    const newPath = await useFsStore.getState().renameNode(node.path, newName);
    tabs.renamePrefix(node.path, newPath);
    useBufferStore.getState().rekeyPrefix(node.path, newPath);
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
    const newPath = await useFsStore.getState().moveNode(sourcePath, targetParentPath);
    tabs.renamePrefix(sourcePath, newPath);
    useBufferStore.getState().rekeyPrefix(sourcePath, newPath);
    setSelectedId((prev) => (prev && (prev === sourcePath || prev.startsWith(`${sourcePath}/`)) ? newPath + prev.slice(sourcePath.length) : prev));
    await git.refresh();
  };

  const handleConfirmDelete = async (node: FileNode) => {
    await useFsStore.getState().removeNode(node.path);
    tabs.closeByPrefix(node.path);
    useBufferStore.getState().forgetPrefix(node.path);
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
  // Phase 6: resolved relative to the PANE that link was clicked in (not a
  // single global active tab) and opened in that same pane — clicking a
  // link in pane B's rendered view opens the target in pane B, not
  // wherever focus happened to be.
  const handlePaneOpenLink = async (paneId: string, href: string) => {
    const leaf = findLeaf(tabs.tree, paneId);
    const fromTab = leaf?.tabs.find((t) => t.path === leaf.activeTabId);
    if (!fromTab) return;
    const resolved = resolveMarkdownLink(fromTab.path, href);
    if (resolved.kind === "external") {
      window.open(resolved.href, "_blank", "noopener,noreferrer");
      return;
    }
    const fsPath = displayToFsPath(resolved.path);
    if (!(await pathExists(fsPath))) return;
    const name = resolved.path.slice(resolved.path.lastIndexOf("/") + 1);
    const kind = inferFileKind(name);
    tabs.openFile({ path: resolved.path, name, kind }, undefined, paneId);
    setSelectedId(resolved.path);
    void useBufferStore.getState().ensureLoaded(resolved.path);
  };

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
    { id: "export-zip", label: "Export vault as .zip" },
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
      case "export-zip":
        void handleExportVaultZip();
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
        handleOpenSettings();
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
      {/* DESIGN-SPEC Amendments round 3 item 17 ("Zen mode hides
          EVERYTHING, title bar included") supersedes round-1 item 4's
          literal five-region list, which wrongly left the title bar
          visible — zen now shows ONLY the content area (plus the
          per-pane floating filename/exit pill on hover, `EditorPane.tsx`). */}
      {!zenMode && (
        <AppTitleBar
          vaultName="vault"
          breadcrumb={titlebarBreadcrumb}
          diff={activeDiff}
          mode={activeTab?.mode}
          availableModes={titlebarAvailableModes}
          onModeChange={(mode) => activeTab && tabs.setMode(activeTab.path, mode, tabs.activePaneId)}
          diffLayout={titlebarDiffLayout}
          onDiffLayoutChange={(layout) => tabs.setDiffLayout(layout, tabs.activePaneId)}
          onEnterZen={enterZenMode}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => useSettingsStore.getState().toggleSidebarCollapsed()}
          onOpenPalette={() => setPaletteMode("commands")}
          onOpenSettings={handleOpenSettings}
        />
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {!zenMode && (
          <AppActivityBar
            active={activePanel}
            onSelect={handleActivitySelect}
            changedCount={git.changedCount}
            onOpenSettings={handleOpenSettings}
          />
        )}

        {/* Course-correction to Amendments round 3 item 20: width and
            collapsed-ness are properties of the SIDEBAR REGION, not any one
            activity view (real VSCode behavior too) — every branch below
            passes the SAME `sidebarWidth`/`sidebarCollapsed` pair into the
            shared `local/SidebarContainer` shell each panel now renders
            itself inside (`Sidebar.tsx`/`SearchPanel.tsx`/
            `SourceControlPanel.tsx`/`ExtensionsPanel.tsx`), so switching
            activity-bar views never jumps the layout back to a frozen
            default width, and every view (not just Explorer) is
            drag-resizable/collapsible. */}
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
            onRefresh={() => void useFsStore.getState().refresh()}
            width={sidebarWidth}
            onWidthChange={(w) => useSettingsStore.getState().setSidebarWidth(w)}
            collapsed={sidebarCollapsed}
            onCollapsedChange={(c) => useSettingsStore.getState().setSidebarCollapsed(c)}
          />
        )}

        {!zenMode && activePanel === "scm" && (
          <SourceControlPanel
            onOpenDiff={handleOpenDiff}
            width={sidebarWidth}
            onWidthChange={(w) => useSettingsStore.getState().setSidebarWidth(w)}
            collapsed={sidebarCollapsed}
            onCollapsedChange={(c) => useSettingsStore.getState().setSidebarCollapsed(c)}
          />
        )}

        {!zenMode && activePanel === "search" && (
          <Suspense fallback={<div style={{ width: sidebarCollapsed ? 0 : sidebarWidth, flexShrink: 0, background: "var(--app-sidebar-bg)", borderRight: sidebarCollapsed ? "none" : "1px solid var(--app-chrome-border)" }} />}>
            <SearchPanel
              onOpenResult={handleSearchOpenResult}
              width={sidebarWidth}
              onWidthChange={(w) => useSettingsStore.getState().setSidebarWidth(w)}
              collapsed={sidebarCollapsed}
              onCollapsedChange={(c) => useSettingsStore.getState().setSidebarCollapsed(c)}
            />
          </Suspense>
        )}

        {!zenMode && activePanel === "extensions" && (
          <ExtensionsPanel
            width={sidebarWidth}
            onWidthChange={(w) => useSettingsStore.getState().setSidebarWidth(w)}
            collapsed={sidebarCollapsed}
            onCollapsedChange={(c) => useSettingsStore.getState().setSidebarCollapsed(c)}
          />
        )}

        <EditorArea
          zenMode={zenMode}
          onExitZen={exitZenMode}
          onOpenLink={(paneId, href) => void handlePaneOpenLink(paneId, href)}
          storagePersistence={storagePersistence}
          onExportVault={() => void handleExportVaultZip()}
          onRequestResetVault={() => setResetConfirmOpen(true)}
        />
      </div>

      {!zenMode && (
        <AppStatusBar
          git={{
            branch: git.branch,
            ahead: git.ahead,
            behind: git.behind,
            lastSyncedAt: git.lastSyncedAt,
            syncing: git.syncing,
            diff: activeDiff,
            untracked: git.untrackedCount,
            changedCount: git.changedCount,
          }}
          encoding="UTF-8"
          eol="LF"
          language={fileTypeFor(activeTab?.kind)?.languageId ?? "PLAIN"}
          onSync={() => void handleSyncNow()}
          storagePersistence={storagePersistence}
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

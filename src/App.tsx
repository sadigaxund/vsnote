import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, useToast } from "my-you-eye";
import { AppActivityBar, type ActivityPanel } from "./components/ActivityBar";
import { AppTitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { SourceControlPanel } from "./components/SourceControlPanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { EditorArea } from "./components/EditorArea";
import { AppStatusBar } from "./components/StatusBar";
import { ensureSeeded, resetVault, loadDemoVault, isDemoVaultBuild } from "./fs/seed";
import { requestPersistentStorage, type StoragePersistenceStatus } from "./fs/persistence";
import { downloadBlob, exportVaultZip, vaultZipFilename } from "./fs/exportZip";
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
import { displayToFsPath, VAULT_LABEL } from "./fs/paths";
import { detectConflictingPaths, importEntriesIntoVault } from "./fs/importEntriesFs";
import { type FlattenedEntry } from "./fs/importEntries";
import { ImportConflictDialog } from "./components/local/ImportConflictDialog";
import { flattenFiles } from "./lib/flattenTree";
import { resolveVaultDisplayLabel } from "./lib/vaultLabel";
import { probeRender } from "./lib/renderProbe";
import { SETTINGS_TAB_NAME, SETTINGS_TAB_PATH } from "./lib/settingsTab";
import { useShareStore, type FolderPublishEntry } from "./share/useShareStore";
import { buildFolderShareLink, buildShareLink } from "./share/shareLinks";
import type { ExplorerShareRow } from "./components/local/ExplorerTree";
import type { CheckboxTreeNode } from "./components/local/CheckboxTree";
import type { ShareOut } from "./share/api";
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
// Phase 10 (sharing): the Publish dialog composes Dialog/Select/Switch/etc.
// from the library — kept out of the cold-boot bundle the same way every
// other overlay here is, since most sessions never open it.
const PublishDialog = lazy(() => import("./components/local/PublishDialog").then((m) => ({ default: m.PublishDialog })));
// Phase 11 (real sync) — the merge conflict resolver is likewise an overlay
// most sessions never open (only a genuine divergence with a true conflict
// triggers it); lazy for the same cold-boot-bundle reason as every other
// overlay here.
const ConflictResolver = lazy(() =>
  import("./components/local/ConflictResolver").then((m) => ({ default: m.ConflictResolver })),
);

/** How often "Sync"'s background fetch runs (roadmap §5.2: "~60s while the
 * backend is reachable") — drives the real ahead/behind counters without
 * requiring an explicit user action.
 *
 * Test-only override, same inert-unless-opted-in shape as `lib/renderProbe.
 * ts`'s `window.__renderProbeEnabled`: a spec that needs to observe several
 * poll ticks without a real 60s wait (item 26b's "zero /git requests while
 * signed out, resumes on sign-in" proof) sets `window.
 * __gitBackgroundFetchMsOverride` via `page.addInitScript` BEFORE
 * navigating, so it's already present when this module evaluates. Absent
 * (the overwhelmingly common case — every non-test load), this is exactly
 * the documented 60s. */
const GIT_BACKGROUND_FETCH_MS =
  (typeof window !== "undefined" &&
    (window as unknown as { __gitBackgroundFetchMsOverride?: number }).__gitBackgroundFetchMsOverride) ||
  60_000;

const ACTIVE_ON_BOOT = "vault/notes/architecture.md";

/** Matches app-preview.png's tab strip exactly — seeded once, the first
 * time the app ever boots in a browser (an empty persisted tab state is
 * the only signal we have for "first run", since a returning user's real
 * open tabs must never be clobbered by this). */
const DEMO_TABS: Array<{ path: string; name: string; kind: FileKind; pin: boolean }> = [
  { path: "vault/notes/architecture.md", name: "architecture.md", kind: "md", pin: true },
  { path: "vault/src/indexer.ts", name: "indexer.ts", kind: "ts", pin: true },
  { path: "vault/vault.config.json", name: "vault.config.json", kind: "json", pin: true },
  { path: "vault/metrics.csv", name: "metrics.csv", kind: "csv", pin: true },
  { path: "vault/assets/cover.png", name: "cover.png", kind: "image", pin: false },
];

/** DESIGN-SPEC item 36: the welcome vault holds exactly one file, so the
 * demo tab strip above would open five paths that do not exist on a
 * non-demo build. Both the boot path and the reset path pick their opening
 * tabs from the vault that was actually seeded. */
const WELCOME_TABS: Array<{ path: string; name: string; kind: FileKind; pin: boolean }> = [
  { path: "vault/welcome.md", name: "welcome.md", kind: "md", pin: true },
];

function bootTabsFor(demo: boolean) {
  return demo ? DEMO_TABS : WELCOME_TABS;
}

function activeOnBootFor(demo: boolean): string {
  return demo ? ACTIVE_ON_BOOT : "vault/welcome.md";
}

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
  /** DESIGN-SPEC Amendments round 4 item 30 — the in-memory "new file/folder"
   * draft row (see `insertDraftNode` below); `null` when no create is in
   * progress. Deliberately separate from `renamingId` (an existing real
   * node being renamed) since a draft has no fs path of its own yet. */
  const [creatingNode, setCreatingNode] = useState<{ id: string; parentPath: string; type: "file" | "folder" } | null>(null);
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
  const [loadDemoConfirmOpen, setLoadDemoConfirmOpen] = useState(false);
  // DESIGN-SPEC Amendments round 5 item 39 — OS drag-drop/Ctrl+V paste
  // import (`ExplorerTree.tsx`'s `onImportEntries`): set only when
  // `detectConflictingPaths` found at least one colliding path, so
  // `ImportConflictDialog` opens; a conflict-free import writes straight
  // through with no dialog at all (see `handleImportEntries` below).
  const [pendingImport, setPendingImport] = useState<{
    targetFolderPath: string;
    entries: FlattenedEntry[];
    conflictNames: string[];
  } | null>(null);
  // Phase 5b durability: result of the boot-time `navigator.storage.persist()`
  // request (see `fs/persistence.ts`) — undefined until that resolves, so
  // the status-bar warning only ever appears once we actually know it was
  // denied, never as a flash-of-warning before the request settles.
  const [storagePersistence, setStoragePersistence] = useState<StoragePersistenceStatus | undefined>(undefined);
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number } | null>(null);
  // Phase 10 (sharing) — Publish dialog state, opened from three places
  // (Explorer row context menu, command palette, title bar share icon).
  // Phase 10.5 (folder shares) extended this instance to ALSO handle
  // "Manage share…" on an already-shared Explorer row (file OR folder) —
  // `editingShare` set means edit-policy mode, same as
  // `SettingsView.tsx`'s own separate "Sharing" category instance (that
  // one stays policy-only; this one additionally supports "Update share"
  // for folders, since only the Explorer's own instance has live vault
  // read access to re-flatten the current subtree — see `handleManageShare`).
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<
    | { type: "file"; path: string; kind: FileKind }
    | { type: "folder"; path: string; tree: CheckboxTreeNode[]; entries: FolderPublishEntry[] }
    | null
  >(null);
  const [publishContent, setPublishContent] = useState<string | undefined>(undefined);
  const [editingShare, setEditingShare] = useState<ShareOut | undefined>(undefined);
  // Snapshot of whichever CM6 view was registered at the moment a jump was
  // requested — see the polling effect below for why this matters (it lets
  // that effect tell "a fresh view mounted" apart from "still reading the
  // view that's about to be torn down").
  const pendingJumpStaleView = useRef<ReturnType<typeof getActiveEditorView>>(null);
  const { toast } = useToast();

  const tree = useDecoratedTree();
  // DESIGN-SPEC Amendments round 4 item 30 — see `insertDraftNode`'s doc:
  // the empty-named "new file/folder" draft row is purely a render-time
  // splice over the real tree, never written into `useFsStore` itself, so
  // it never survives a real refresh/reload and there's nothing to clean
  // up on cancel.
  const treeWithDraft = useMemo(() => {
    if (!creatingNode) return tree;
    const draft: FileNode = {
      id: creatingNode.id,
      name: "",
      kind: creatingNode.type === "folder" ? "folder" : "unknown",
      path: creatingNode.id,
      type: creatingNode.type,
      ...(creatingNode.type === "folder" ? { children: [] } : {}),
    };
    return insertDraftNode(tree, creatingNode.parentPath, draft);
  }, [tree, creatingNode]);
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
  // DESIGN-SPEC Amendments round 5 item 41(c) — targeted selector, same
  // discipline as `sidebarWidth` above, so the title bar's breadcrumb (below)
  // reacts live when the vault display name changes.
  const vaultDisplayName = useSettingsStore((s) => s.vaultDisplayName);
  // Phase 10.5 — the Explorer tree's share indicator glyph (roadmap §5.1)
  // reads whatever `useShareStore.shares` currently holds. That list is
  // populated lazily (Settings → Sharing's mount effect, or the first
  // Publish/Manage action this session — see the boot effect's doc for why
  // there is deliberately no unconditional network call at app boot), so a
  // fresh reload shows no indicators until one of those has run once —
  // consistent with `useShareStore`'s own "deliberately not persisted"
  // design (a session cookie, not localStorage, is the source of truth).
  const shares = useShareStore((s) => s.shares) as ExplorerShareRow[];
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
        const demo = isDemoVaultBuild();
        for (const t of bootTabsFor(demo)) {
          useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
        }
        useTabsStore.getState().setActiveTab(activeOnBootFor(demo));
        setSelectedId(activeOnBootFor(demo));
      }
      setBooted(true);
    })();

    // Phase 5b durability safeguard (IMPLEMENTATION-PLAN.md Phase 5):
    // request persistent storage for the IndexedDB-backed vault. Runs
    // independently of the seed/tab-restore chain above — it never blocks
    // first paint, and a denial only ever produces the muted status-bar
    // warning (`fs/persistence.ts`'s doc), never a dialog or toast.
    void requestPersistentStorage().then(setStoragePersistence);

    // Phase 10 (sharing) — deliberately NO automatic reachability probe
    // here at boot. Tried first (`GET /api/auth/whoami` unconditionally on
    // every mount, same "never blocks first paint, fail-closed" discipline
    // as the persistence request above); reverted after it broke
    // `tests/e2e/probes.spec.ts`'s "offline cold start" probe, which
    // asserts zero console errors with the browser context fully offline
    // (`context.setOffline(true)`). `whoami()` already catches the fetch
    // rejection in JS (never an unhandled exception), but Chromium's own
    // network stack still logs "Failed to load resource:
    // net::ERR_INTERNET_DISCONNECTED" to the console for ANY request that
    // fails at the network layer, independent of whether application code
    // handles it — confirmed with a throwaway repro
    // (`page.evaluate(() => navigator.onLine)` reads `true` even under
    // Playwright's `context.setOffline(true)`, so a `navigator.onLine`
    // guard here can't reliably prevent the attempt either; CDP's network-
    // level offline emulation doesn't flip that property the way a real
    // disconnected NIC does). The correct fix is architectural, not a
    // guard: this app's vault/editor/git features have NOTHING to do with
    // sharing, so nothing about opening/using them should ever trigger a
    // sharing-related network call. The probe now fires lazily, only from
    // the three real share-surface entry points that actually need to know
    // reachability before showing anything — `handleOpenPublish`/
    // `handleShareActiveFile` below (Explorer context menu, command
    // palette, title bar share icon — all funnel through the same publish
    // flow) and `SettingsView.tsx`'s "Sharing" category's own mount effect
    // — never from a plain app boot, so a user who never touches sharing
    // causes zero share-related network activity, ever.
  }, []);

  // Phase 11 (real sync, roadmap §5.2) — "Periodic background fetch (~60s)
  // while the backend is reachable, driving the real ahead/behind
  // counters". A plain `setInterval`/`clearInterval` pair (identical
  // cleanup shape to `StatusBar.tsx`'s own tick interval) — mounted once,
  // torn down on unmount, so it can never leak a timer across reloads/HMR.
  //
  // Phase 12 (DESIGN-SPEC Amendments round 4, item 26b) course-correction:
  // this used to gate on `useShareStore`'s `reachability` field alone
  // (`reachability !== "offline"`) — but `reachability` starts `"unknown"`
  // and NOTHING probes it at boot by design (see the boot effect's own doc
  // above: an eager `whoami()` at boot broke the offline-cold-start probe),
  // so in practice this interval fired every single tick for every signed-
  // out session, hitting `/git` with no credentials. The server's 401 for
  // that request used to carry `WWW-Authenticate: Basic` unconditionally
  // (fixed server-side too, `git_http.py`'s `_is_git_client` — item 26a),
  // and a BROWSER `fetch()` that sees that header on ANY response pops the
  // browser's own native login dialog — confirmed live, roughly every 60s,
  // while signed out. `reachability` is a soft/tri-state signal (exactly
  // the "unknown until probed" ambiguity that caused this); `authenticated`
  // is a hard boolean that starts `false` and is ONLY ever flipped `true`
  // by an explicit sign-in path (`useShareStore`'s `login()`, or a
  // `probe()` that resolves to an authenticated `whoami()`) — gating on it
  // directly means a signed-out session makes ZERO `/git` requests from
  // this interval, full stop, and polling resumes automatically the very
  // next tick after the user signs in from anywhere (Settings → Git & Sync,
  // the Publish dialog's "Sign In", …). `fetch()` itself never throws
  // (every `SyncError` is caught into `syncError` state — see
  // `useGitStore.ts`'s doc), so an attempt here never becomes an unhandled
  // rejection; `!syncing` avoids overlapping an in-flight user-initiated
  // push/pull/sync with a background tick.
  useEffect(() => {
    const id = setInterval(() => {
      const { syncing } = useGitStore.getState();
      const { authenticated } = useShareStore.getState();
      if (!syncing && authenticated) void useGitStore.getState().fetch();
    }, GIT_BACKGROUND_FETCH_MS);
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
  // DESIGN-SPEC item 38's overflow menu gates Format/Insert/Export on this —
  // a narrow selector (just the one boolean, not the whole buffer entry) so
  // the title bar doesn't re-render on every keystroke the same way
  // `activeBuffer` selectors elsewhere in this codebase already avoid (see
  // `EditorPane.tsx`'s `dirtyByPath` doc for the same discipline).
  const activeMissing = useBufferStore((s) => (activeTab ? (s.buffers[activeTab.path]?.missing ?? false) : false));

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
  // DESIGN-SPEC Amendments round 5 item 41(c) — swap only the FIRST
  // breadcrumb segment for the vault display name when it equals the real
  // `VAULT_LABEL` ("vault"), so the underlying `activeTab.path` (identity
  // for tabs/git-status/diff-cache keys, unchanged) never itself changes —
  // this is purely a rendered label swap, same as `useFsStore.ts`'s root
  // tree node. `EditorPane.tsx`'s own per-pane header breadcrumb (the
  // multi-pane case) still shows the literal "vault" segment: that file is
  // out of this item's scope, see the item 41 report for that known gap.
  const titlebarBreadcrumb =
    activeTab && activeTab.kind !== "settings"
      ? activeTab.path.split("/").map((segment, i) => (i === 0 && segment === VAULT_LABEL ? resolveVaultDisplayLabel(vaultDisplayName, VAULT_LABEL) : segment))
      : undefined;
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
    // Phase 11 (real sync) — `syncNow()` never throws (see useGitStore's
    // doc: every sync action catches its own SyncError into `syncError`
    // state and always clears `syncing`), so the honest result — success,
    // a specific failure reason, OR a paused-on-conflict state — is read
    // back from the store here rather than a try/catch.
    const { ahead, behind, syncError, conflict } = useGitStore.getState();
    if (conflict) {
      // Nothing failed and nothing pushed yet — `<ConflictResolver />`
      // (mounted unconditionally below) opens itself off this same store
      // field; this toast is just the honest "why did nothing finish"
      // signal for whoever's watching the status bar.
      toast({
        title: "Sync paused: conflicts to resolve",
        description: `${conflict.conflicts.length} file${conflict.conflicts.length === 1 ? "" : "s"} need your input.`,
      });
      return;
    }
    if (syncError) {
      toast({ title: "Sync failed", description: syncError, variant: "danger" });
      return;
    }
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

  /** Shared tail of "the vault on disk was just replaced": every in-memory
   * buffer/tab/selection is now stale (a buffer's `loaded` flag would
   * otherwise skip re-reading from fs — see `useBufferStore.ensureLoaded`),
   * so clear and reopen exactly like a fresh boot rather than leaving a
   * half-stale session behind. `demoAfterSeed` says which vault is now on
   * disk, so the reopened tabs match it (DESIGN-SPEC item 36). */
  async function reopenAfterReseed(demoAfterSeed: boolean): Promise<void> {
    useBufferStore.setState({ buffers: {} });
    await Promise.all([useFsStore.getState().refresh(), useGitStore.getState().refresh()]);
    useTabsStore.setState({
      tree: { type: "leaf", id: "root", tabs: [], activeTabId: undefined },
      activePaneId: "root",
    });
    for (const t of bootTabsFor(demoAfterSeed)) {
      useTabsStore.getState().openFile({ path: t.path, name: t.name, kind: t.kind }, { pin: t.pin });
    }
    useTabsStore.getState().setActiveTab(activeOnBootFor(demoAfterSeed));
    setSelectedId(activeOnBootFor(demoAfterSeed));
  }

  async function handleResetVaultConfirmed(): Promise<void> {
    await resetVault();
    await reopenAfterReseed(isDemoVaultBuild());
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
    toast({ title: "Vault reset", description: "Filesystem and git history re-seeded from scratch.", variant: "success" });
  }

  /** DESIGN-SPEC item 36's "Load demo vault" palette command. Always seeds
   * the showcase vault, whatever this build's default is, and warns first
   * because it destroys the current vault including its git history. */
  async function handleLoadDemoVaultConfirmed(): Promise<void> {
    await loadDemoVault();
    await reopenAfterReseed(true);
    setLoadDemoConfirmOpen(false);
    toast({ title: "Demo vault loaded", description: "The previous vault was replaced.", variant: "success" });
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

  // DESIGN-SPEC Amendments round 4 item 30: no fs write here anymore — just
  // drop an empty-named draft into the tree (see `insertDraftNode`'s doc)
  // and point `renamingId` at it. The real `createFile` call happens only
  // from `handleTreeRenameCommit` below, and only if the user actually
  // types a name.
  const handleCreateFile = (parentPath?: string) => {
    const parent = resolveCreateParent(parentPath);
    setCreatingNode({ id: `${parent}/.vsnote-draft-file`, parentPath: parent, type: "file" });
  };

  const handleCreateFolder = (parentPath?: string) => {
    const parent = resolveCreateParent(parentPath);
    setCreatingNode({ id: `${parent}/.vsnote-draft-folder`, parentPath: parent, type: "folder" });
  };

  const handleRequestRename = (node: FileNode) => setRenamingId(node.id);
  const handleRenameCancel = () => setRenamingId(null);

  // Wraps `handleRenameCancel`/`handleRenameCommit` (existing-node rename)
  // so `Sidebar`/`ExplorerTree` can stay unaware of the draft-vs-real-node
  // distinction — they always just call "the current row's" rename
  // commit/cancel prop, whichever node that happens to be.
  const handleTreeRenameCancel = () => {
    if (creatingNode) {
      setCreatingNode(null);
      return;
    }
    handleRenameCancel();
  };

  const handleTreeRenameCommit = async (node: FileNode, newName: string) => {
    if (creatingNode && node.id === creatingNode.id) {
      setCreatingNode(null);
      if (creatingNode.type === "file") {
        const newPath = await useFsStore.getState().createFile(creatingNode.parentPath, newName);
        setSelectedId(newPath);
        tabs.openFile({ path: newPath, name: newPath.slice(newPath.lastIndexOf("/") + 1), kind: inferFileKind(newPath.slice(newPath.lastIndexOf("/") + 1)) }, { pin: true });
      } else {
        const newPath = await useFsStore.getState().createFolder(creatingNode.parentPath, newName);
        setSelectedId(newPath);
      }
      await git.refresh();
      return;
    }
    await handleRenameCommit(node, newName);
  };

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

  // DESIGN-SPEC Amendments round 5 item 39 — OS drag-drop/Ctrl+V paste
  // import. `ExplorerTree.tsx` already flattened entries (nested OS folders
  // preserved as relative paths) and resolved the target folder; this just
  // checks for collisions and either writes straight through or opens
  // `ImportConflictDialog` for a Rename-or-Replace-or-Cancel choice.
  const handleImportEntries = async (targetFolderPath: string, entries: FlattenedEntry[]) => {
    const conflictNames = await detectConflictingPaths(targetFolderPath, entries);
    if (conflictNames.length === 0) {
      await importEntriesIntoVault(targetFolderPath, entries, "replace");
      await useFsStore.getState().refresh();
      await git.refresh();
      return;
    }
    setPendingImport({ targetFolderPath, entries, conflictNames });
  };

  const handleResolveImportConflict = async (mode: "rename" | "replace") => {
    const pending = pendingImport;
    setPendingImport(null);
    if (!pending) return;
    await importEntriesIntoVault(pending.targetFolderPath, pending.entries, mode);
    await useFsStore.getState().refresh();
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

  // Phase 10 (sharing) — "Publish…" from the Explorer row context menu
  // (`ExplorerTree.tsx`) or the title bar's share icon: reads the file's
  // CURRENT buffer content (the same live value the editor shows, unsaved
  // edits included — `useBufferStore.ensureLoaded` is idempotent, matching
  // every other call site in this file) and opens the dialog in "publish a
  // new share" mode. `PublishDialog` itself never touches `fs/`/`useBufferStore`
  // — it only ever sees the plain string handed to it here, keeping it
  // reasoned-about the same way `share/ShareApp.tsx`'s "never touches vault
  // storage" boundary is (that component is the untrusted-content side,
  // this one is the vault-reading side; neither crosses into the other's
  // job).
  const handleOpenPublish = async (node: FileNode) => {
    // Lazy reachability probe — see the boot effect's doc above for why
    // this doesn't happen automatically at app boot. Fire-and-forget: the
    // dialog reads `useShareStore`'s reactive `reachability`/`authenticated`
    // fields, so it re-renders once this resolves regardless of whether
    // the dialog is already open by then.
    void useShareStore.getState().probe();
    setEditingShare(undefined);
    if (node.type === "folder") {
      // Phase 10.5 — folder publish. Reads the CURRENT vault subtree
      // (`readFolderPublishData` below) the exact same way the file branch
      // reads a buffer: `PublishDialog` never touches `fs/`/`useBufferStore`
      // itself, it only ever sees the plain data handed to it here.
      const { tree: folderTree, entries } = await readFolderPublishData(node);
      setPublishTarget({ type: "folder", path: node.path, tree: folderTree, entries });
      setPublishContent(undefined);
    } else {
      await useBufferStore.getState().ensureLoaded(node.path);
      const buf = useBufferStore.getState().buffers[node.path];
      setPublishTarget({ type: "file", path: node.path, kind: node.kind });
      setPublishContent(buf?.content ?? "");
    }
    setPublishDialogOpen(true);
  };

  // Phase 10.5 — "Manage share…" from the Explorer row context menu on an
  // ALREADY-shared row: re-opens the SAME PublishDialog instance in
  // edit-policy mode. For a folder share this also re-reads the CURRENT
  // vault subtree (fresh content, in case files changed since publish) so
  // "Update share" republishes what's on disk now, not a stale snapshot.
  const handleManageShare = async (node: FileNode, shareRow: ExplorerShareRow) => {
    void useShareStore.getState().probe();
    const share = useShareStore.getState().shares.find((s) => s.id === shareRow.id);
    if (!share) return;
    if (node.type === "folder" && share.kind === "folder") {
      const { tree: folderTree, entries } = await readFolderPublishData(node);
      setPublishTarget({ type: "folder", path: node.path, tree: folderTree, entries });
    } else {
      setPublishTarget(null);
    }
    setPublishContent(undefined);
    setEditingShare(share);
    setPublishDialogOpen(true);
  };

  const handleCopyShareLink = (_node: FileNode, shareRow: ExplorerShareRow) => {
    const share = useShareStore.getState().shares.find((s) => s.id === shareRow.id);
    if (!share) return;
    const link = share.kind === "folder" ? buildFolderShareLink(share) : buildShareLink(share);
    navigator.clipboard?.writeText(link).catch(() => {});
    toast({ title: "Link copied", variant: "success" });
  };

  const handleShareActiveFile = () => {
    if (!activeTab || activeTab.kind === "settings") return;
    void handleOpenPublish({ id: activeTab.path, path: activeTab.path, name: activeTab.name, kind: activeTab.kind, type: "file" });
  };
  // "Edit policy…" (re-open the Publish dialog against an EXISTING share)
  // is handled entirely inside `SettingsView.tsx`'s "Sharing" category —
  // its own local `editingShare` state + `PublishDialog` instance, since
  // that flow needs no file content and no plumbing through this file at
  // all (see that component's doc).

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
    // Phase 11 (real sync, roadmap §5.2) — label dropped "(push & pull)":
    // that undersold what `handleSyncNow` actually does now (fetch, then
    // fast-forward/push/auto-merge as appropriate, opening the conflict
    // resolver on a true conflict) — "Sync now" alone doesn't overclaim.
    { id: "sync", label: "Sync now" },
    { id: "new-file", label: "New file" },
    { id: "export-zip", label: "Export vault as .zip" },
    // DESIGN-SPEC item 36: the reset command's label follows whichever
    // vault this build actually seeds, so it never offers to restore demo
    // content a normal build has never had.
    { id: "reset-vault", label: isDemoVaultBuild() ? "Reset demo vault…" : "Reset vault…" },
    { id: "load-demo-vault", label: "Load demo vault…" },
    { id: "zen", label: "Toggle zen mode", shortcut: "⌘⇧Z" },
    { id: "search", label: "Search in files" },
    { id: "save", label: "Save file", shortcut: "⌘S" },
    { id: "close-tab", label: "Close tab", shortcut: "⌘W / ⌘⇧W" },
    { id: "settings", label: "Open settings…" },
    { id: "publish", label: "Publish/Share file…" },
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
        handleCreateFile();
        break;
      case "export-zip":
        void handleExportVaultZip();
        break;
      case "reset-vault":
        setResetConfirmOpen(true);
        break;
      case "load-demo-vault":
        setLoadDemoConfirmOpen(true);
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
      case "publish":
        handleShareActiveFile();
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
          onShare={handleShareActiveFile}
          overflowMenuPaneId={tabs.activePaneId}
          overflowMenuKind={activeTab?.kind}
          overflowMenuPath={activeTab?.path}
          overflowMenuMissing={activeMissing}
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
            tree={treeWithDraft}
            selectedId={selectedId}
            onSelect={handleSelectFile}
            renamingId={creatingNode ? creatingNode.id : renamingId}
            forceExpandId={creatingNode?.parentPath ?? null}
            onRenameCommit={handleTreeRenameCommit}
            onRenameCancel={handleTreeRenameCancel}
            onRequestRename={handleRequestRename}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onConfirmDelete={handleConfirmDelete}
            onCopyPath={handleCopyPath}
            onMove={handleMove}
            onImportEntries={(targetFolderPath, entries) => void handleImportEntries(targetFolderPath, entries)}
            onPublish={(node) => void handleOpenPublish(node)}
            shares={shares}
            onCopyShareLink={handleCopyShareLink}
            onManageShare={(node, share) => void handleManageShare(node, share)}
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
            syncError: git.syncError,
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

      {publishDialogOpen && (
        <Suspense fallback={null}>
          <PublishDialog
            open={publishDialogOpen}
            onOpenChange={(open) => {
              setPublishDialogOpen(open);
              if (!open) {
                setPublishTarget(null);
                setPublishContent(undefined);
                setEditingShare(undefined);
              }
            }}
            filePath={publishTarget?.type === "file" ? publishTarget.path : undefined}
            fileKind={publishTarget?.type === "file" ? publishTarget.kind : undefined}
            content={publishContent}
            existingShare={editingShare}
            folderPath={publishTarget?.type === "folder" ? publishTarget.path : undefined}
            folderTree={publishTarget?.type === "folder" ? publishTarget.tree : undefined}
            folderEntries={publishTarget?.type === "folder" ? publishTarget.entries : undefined}
          />
        </Suspense>
      )}

      {/* Phase 11 (real sync) — mounted unconditionally (unlike
          `PublishDialog`, gated on a boolean this file owns) since it reads
          `useGitStore`'s `conflict` field itself and renders nothing when
          it's `null`; opening it is entirely driven by `syncNow` setting
          that field, not by anything in this component's own state. */}
      <Suspense fallback={null}>
        <ConflictResolver />
      </Suspense>

      <ConfirmDialog
        title={isDemoVaultBuild() ? "Reset demo vault?" : "Reset vault?"}
        description={
          isDemoVaultBuild()
            ? "Wipes the in-browser filesystem and git history and re-seeds the original demo vault from scratch. Any files or edits you've made are lost."
            : "Wipes the in-browser filesystem and git history and re-seeds a fresh welcome vault. Any files or edits you've made are lost."
        }
        confirmLabel="Reset"
        destructive
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        onConfirm={() => void handleResetVaultConfirmed()}
      />

      <ConfirmDialog
        title="Load demo vault?"
        description="Replaces your current vault and its git history with the demo vault. Any files or edits you've made are lost."
        confirmLabel="Load demo vault"
        destructive
        open={loadDemoConfirmOpen}
        onOpenChange={setLoadDemoConfirmOpen}
        onConfirm={() => void handleLoadDemoVaultConfirmed()}
      />

      <ImportConflictDialog
        open={pendingImport !== null}
        conflictNames={pendingImport?.conflictNames ?? []}
        onOpenChange={(open) => {
          if (!open) setPendingImport(null);
        }}
        onRename={() => void handleResolveImportConflict("rename")}
        onReplace={() => void handleResolveImportConflict("replace")}
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

/** DESIGN-SPEC Amendments round 4 item 30: "New file"/"New folder" no
 * longer write to the fs (and no longer prefill `untitled.md`) up front —
 * that's what forced the user to fight/clear a prefilled name, and left a
 * stray real file behind if they backed out. Instead a purely-in-memory
 * draft `FileNode` (`name: ""`) is spliced into the rendered tree as the
 * FIRST child of its parent, and `renamingId` is pointed at it — it's
 * rendered by the exact same `TreeRow`/rename-`<Input>` machinery real
 * renames use (`ExplorerTree.tsx`), so its position/font/row-height are
 * pixel-identical to a real row by construction, not by separately
 * matching CSS. `ExplorerTree`'s own `commitRename` already treats an
 * empty/unchanged draft name as a cancel (`trimmed && trimmed !==
 * node.name`, and this draft's `node.name` is exactly `""`), so "empty
 * confirms cancels silently" falls out of existing logic for free — the
 * caller (`handleTreeRenameCommit`/`handleTreeRenameCancel` below) only
 * needs to route a real commit to `createFile`/`createFolder` (the ONLY
 * point a real fs write ever happens for a new node) and route a cancel to
 * just dropping the draft, no fs call at all. */
function insertDraftNode(nodes: FileNode[], parentPath: string, draft: FileNode): FileNode[] {
  return nodes.map((node) => {
    if (node.id === parentPath) {
      return { ...node, children: [draft, ...(node.children ?? [])] };
    }
    if (node.children) {
      return { ...node, children: insertDraftNode(node.children, parentPath, draft) };
    }
    return node;
  });
}

/**
 * Phase 10.5 (folder shares) — converts a folder `FileNode` subtree (from
 * `useDecoratedTree`, already in memory — no extra fs read needed for the
 * SHAPE) into `PublishDialog`'s vault-agnostic inputs: a `CheckboxTreeNode`
 * tree keyed by RELPATH (not the full vault path — see `CheckboxTree.tsx`'s
 * doc) and a flat list of every file's relpath + CURRENT buffer content
 * (`useBufferStore.ensureLoaded`, same idempotent read every other call
 * site in this file uses). `PublishDialog` itself never touches `fs/`/
 * `useBufferStore` — this is the one place that boundary gets crossed for
 * the folder-publish flow, mirroring `handleOpenPublish`'s existing
 * single-file `ensureLoaded` call.
 */
async function readFolderPublishData(root: FileNode): Promise<{ tree: CheckboxTreeNode[]; entries: FolderPublishEntry[] }> {
  const prefixLen = root.path.length + 1; // strip "<root.path>/"

  function toCheckboxNodes(nodes: FileNode[]): CheckboxTreeNode[] {
    return nodes.map((n) => ({
      id: n.path.slice(prefixLen),
      name: n.name,
      type: n.type,
      kind: n.kind,
      children: n.type === "folder" ? toCheckboxNodes(n.children ?? []) : undefined,
    }));
  }

  const filePaths: { relpath: string; vaultPath: string }[] = [];
  function collectFiles(nodes: FileNode[]): void {
    for (const n of nodes) {
      if (n.type === "file") filePaths.push({ relpath: n.path.slice(prefixLen), vaultPath: n.path });
      else collectFiles(n.children ?? []);
    }
  }
  collectFiles(root.children ?? []);

  const entries: FolderPublishEntry[] = [];
  for (const fp of filePaths) {
    await useBufferStore.getState().ensureLoaded(fp.vaultPath);
    const buf = useBufferStore.getState().buffers[fp.vaultPath];
    entries.push({ relpath: fp.relpath, content: buf?.content ?? "" });
  }

  return { tree: toCheckboxNodes(root.children ?? []), entries };
}

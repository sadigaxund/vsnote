/**
 * Settings — a full editor-area VIEW, not a modal (Phase 6.5c, DESIGN-SPEC
 * Amendments item 11: "the current dialog 'feels slapped in' ... open
 * Settings as a TAB in the editor area, VSCode-style: left category nav +
 * searchable content"). Opened exactly like any file (`App.tsx`'s
 * `handleOpenSettings` calls `useTabsStore.openFile` with
 * `kind: "settings"`, `path: SETTINGS_TAB_PATH` — see `lib/settingsTab.ts`),
 * routed here by `EditorContent.tsx`'s `kind === "settings"` branch, which
 * ignores mode/loaded/missing/diff entirely for this kind: this is a VIEW
 * over `useSettingsStore`, not a document with Rendered/Source/Diff
 * representations of file content. That's the whole trick behind fitting a
 * non-file view into a tab model built around "content keyed by FILE" —
 * `useTabsStore`'s `OpenTab` shape didn't need to change at all, it already
 * only ever needed `path`/`name`/`kind`, and a virtual, never-on-disk path
 * satisfies that just as well as a real one. Because it's a plain tab, the
 * existing tab-tree persistence (`useTabsStore`'s `persist` middleware)
 * already restores an open Settings tab across a reload for free.
 *
 * Composition only — no new local primitive needed. `Select`/`Slider`/
 * `Switch`/`RadioGroup`/`Input`/`Button`/`DataList`/`Kbd`/`Badge` from the
 * library; the left category nav and the search-filtered row list are
 * plain layout over those (a `<Button variant="ghost"|"secondary">` list,
 * not a new "SettingsNav" component — too thin to warrant one, same
 * reasoning `docs/COMPONENT-BACKLOG.md`'s notes section gives for "solved
 * by composition" gaps). The one visual carry-over from the old modal is
 * the native `<input type="color">` accent swatch (see that file's history
 * in git blame / `docs/COMPONENT-BACKLOG.md`'s `ColorPicker`/`ColorField`
 * row, still `planned`) — still no library `ColorPicker` exists (checked
 * `skills/components.json`), so this stays the pragmatic choice.
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  DataList,
  FormField,
  Input,
  Kbd,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Switch,
} from "my-you-eye";
import {
  Eye,
  GitBranch,
  HardDrive,
  Keyboard as KeyboardIcon,
  Loader2,
  Palette,
  Search as SearchIcon,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import {
  DEFAULT_GIT_COMMIT_TEMPLATE,
  RENDERED_CONTENT_WIDTH_FULL,
  THEME_OPTIONS,
  useSettingsStore,
  type AppTheme,
  type UiDensity,
} from "../stores/useSettingsStore";
import { defaultModeFor } from "../filetypes/registry";
import { useGitStore } from "../stores/useGitStore";
import { useFsStore } from "../stores/useFsStore";
import {
  computeGitRemoteUrl,
  DEFAULT_GIT_REPO_NAME,
  describeConnectionTest,
  resolveGitCredential,
  testGitConnection,
  validateRepoName,
  type ConnectionTestResult,
} from "../git/remote";
import { isHttpRemoteUrl } from "../git/syncStatus";
import { clampSyncIntervalMinutes, MIN_SYNC_INTERVAL_MINUTES } from "../git/autoSyncPolicy";
import { buildTemplateVars, renderCommitTemplate } from "../git/commitTemplate";
import { requestPersistentStorage, type StoragePersistenceStatus } from "../fs/persistence";
import { isDemoVaultBuild } from "../fs/seed";
import { useShareStore } from "../share/useShareStore";
import { SharedPanel } from "./local/SharedPanel";
import { VaultSetupPanel } from "./local/VaultSetupPanel";
import { createApiToken, type ShareOut } from "../share/api";
import type { EditorMode, FileKind } from "../types";

// Phase 10 (sharing) — the Publish dialog composes Dialog/Select/Switch/etc.
// from the library; lazy the same way `App.tsx`'s own instance is, so
// opening Settings never pays for it unless "Edit policy…" is actually
// clicked.
const PublishDialog = lazy(() => import("./local/PublishDialog").then((m) => ({ default: m.PublishDialog })));

export interface SettingsViewProps {
  /** Boot-time `navigator.storage.persist()` result, threaded down from
   * `App.tsx` (`EditorArea.tsx`'s doc) — this view re-requests it itself as
   * a fallback only if the Settings tab somehow opens before that boot
   * request has resolved. */
  storagePersistence?: StoragePersistenceStatus;
  onExportVault?: () => void;
  onRequestResetVault?: () => void;
}

const THEME_LABELS: Record<AppTheme, string> = {
  dark: "Dark (VSNote default)",
  default: "Default",
  neon: "Neon",
  contrast: "Contrast",
  glass: "Glass",
  comic: "Comic",
  brutal: "Brutal",
  stark: "Stark",
  frosted: "Frosted",
  metallic: "Metallic",
};

const TAB_SIZES = [2, 4, 8] as const;

/** File kinds whose registry entry offers both Rendered and Source — the
 * only ones a "default view mode" choice is meaningful for (a code file has
 * no Rendered mode to default *to*). */
const DEFAULT_MODE_KINDS: { kind: FileKind; label: string }[] = [
  { kind: "md", label: "Markdown" },
  { kind: "json", label: "JSON" },
  { kind: "html", label: "HTML" },
  { kind: "csv", label: "CSV" },
];

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "⌘K", description: "Command palette: file jump and commands" },
  { keys: "⌘P", description: "Go to file" },
  { keys: "⌘S", description: "Save the active buffer" },
  { keys: "⌘F", description: "Find in the current view" },
  { keys: "⌘E", description: "Toggle Rendered / Source" },
  { keys: "⌘W", description: "Close the active tab (best-effort)" },
  { keys: "⌘⇧W", description: "Close the active tab (fallback for ⌘W)" },
  { keys: "⌘⇧Z", description: "Toggle zen mode (content-area fullscreen)" },
  { keys: "Esc", description: "Exit zen mode, or close the palette / find widget / dialogs" },
];

interface SettingRow {
  id: string;
  label: string;
  keywords?: string;
  content: ReactNode;
  /** Round 7 item 46 — the page is full-bleed but a row's CONTROLS are not:
   * rows cap at a comfortable measure so sliders/inputs never span the
   * window. Tables and multi-column panels (shares, server vault) opt out. */
  wide?: boolean;
}

/** Round 7 item 46 — max measure for a normal settings row. */
const ROW_MAX_WIDTH = "36rem";

interface Category {
  id: string;
  label: string;
  icon: ReactNode;
  rows: SettingRow[];
}

function rowMatches(row: SettingRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.label.toLowerCase().includes(q) || (row.keywords ?? "").toLowerCase().includes(q);
}

export function SettingsView({ storagePersistence, onExportVault, onRequestResetVault }: SettingsViewProps) {
  const theme = useSettingsStore((s) => s.theme);
  const accent = useSettingsStore((s) => s.accent);
  const uiDensity = useSettingsStore((s) => s.uiDensity);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const editorLineSpacing = useSettingsStore((s) => s.editorLineSpacing);
  const renderedContentWidth = useSettingsStore((s) => s.renderedContentWidth);
  const renderedMargin = useSettingsStore((s) => s.renderedMargin);
  const renderedLineSpacing = useSettingsStore((s) => s.renderedLineSpacing);
  const readingViewDefaultMode = useSettingsStore((s) => s.readingViewDefaultMode);
  const gitAuthToken = useSettingsStore((s) => s.gitAuthToken);
  const setGitAuthToken = useSettingsStore((s) => s.setGitAuthToken);
  // DESIGN-SPEC Amendments round 5 item 41 — repository name, vault display
  // name, and the Advanced custom-remote override.
  const gitRepoName = useSettingsStore((s) => s.gitRepoName);
  const setGitRepoName = useSettingsStore((s) => s.setGitRepoName);
  const vaultDisplayName = useSettingsStore((s) => s.vaultDisplayName);
  const setVaultDisplayName = useSettingsStore((s) => s.setVaultDisplayName);
  const gitRemoteOverrideEnabled = useSettingsStore((s) => s.gitRemoteOverrideEnabled);
  const setGitRemoteOverrideEnabled = useSettingsStore((s) => s.setGitRemoteOverrideEnabled);
  const gitRemoteOverrideUrl = useSettingsStore((s) => s.gitRemoteOverrideUrl);
  const setGitRemoteOverrideUrl = useSettingsStore((s) => s.setGitRemoteOverrideUrl);
  const gitRemoteOverrideToken = useSettingsStore((s) => s.gitRemoteOverrideToken);
  const setGitRemoteOverrideToken = useSettingsStore((s) => s.setGitRemoteOverrideToken);
  const gitCommitTemplate = useSettingsStore((s) => s.gitCommitTemplate);
  const setGitCommitTemplate = useSettingsStore((s) => s.setGitCommitTemplate);
  const gitDeviceName = useSettingsStore((s) => s.gitDeviceName);
  const setGitDeviceName = useSettingsStore((s) => s.setGitDeviceName);
  const showGitStatusInExplorer = useSettingsStore((s) => s.showGitStatusInExplorer);
  const setShowGitStatusInExplorer = useSettingsStore((s) => s.setShowGitStatusInExplorer);
  // Phase 17 Milestone C1 — auto-sync policy.
  const gitSyncPolicy = useSettingsStore((s) => s.gitSyncPolicy);
  const setGitSyncPolicy = useSettingsStore((s) => s.setGitSyncPolicy);
  const gitSyncIntervalMinutes = useSettingsStore((s) => s.gitSyncIntervalMinutes);
  const setGitSyncIntervalMinutes = useSettingsStore((s) => s.setGitSyncIntervalMinutes);

  const setTheme = useSettingsStore((s) => s.setTheme);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const setUiDensity = useSettingsStore((s) => s.setUiDensity);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const setTabSize = useSettingsStore((s) => s.setTabSize);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const setEditorLineSpacing = useSettingsStore((s) => s.setEditorLineSpacing);
  const setRenderedContentWidth = useSettingsStore((s) => s.setRenderedContentWidth);
  const setRenderedMargin = useSettingsStore((s) => s.setRenderedMargin);
  const setRenderedLineSpacing = useSettingsStore((s) => s.setRenderedLineSpacing);
  const setReadingViewDefaultMode = useSettingsStore((s) => s.setReadingViewDefaultMode);

  const branch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);

  const [activeCategory, setActiveCategory] = useState("appearance");
  const [query, setQuery] = useState("");

  // Phase 10 (sharing) — reachability/auth state + owner's share list live
  // in `share/useShareStore.ts` (ephemeral, not persisted — see that
  // module's doc); this view just reads/drives it. `editingShare` is this
  // view's OWN local "Edit policy…" dialog instance (separate from
  // `App.tsx`'s publish-a-new-share instance — the two never need to be
  // open at once, and edit mode never reads file content, so it doesn't
  // need any of the plumbing a fresh publish does).
  const reachability = useShareStore((s) => s.reachability);
  const authenticated = useShareStore((s) => s.authenticated);
  const shareUsername = useShareStore((s) => s.username);
  const isAdmin = useShareStore((s) => s.isAdmin);
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const probeShareBackend = useShareStore((s) => s.probe);
  const loginShareBackend = useShareStore((s) => s.login);
  const logoutShareBackend = useShareStore((s) => s.logout);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [editingShare, setEditingShare] = useState<ShareOut | null>(null);

  // DESIGN-SPEC Amendments round 5, item 40 — admin-only share blob size
  // limit. `adminMaxBlobBytes` lives in useShareStore (same home as every
  // other backend-derived value here). `maxBlobMbOverride` is null until
  // the admin actually edits the field — while null the input just DISPLAYS
  // the store's current value (derived inline, not synced via a second
  // effect: setState-in-effect for a value already available at render
  // time is an anti-pattern lint flags). It's reset to null on a
  // successful save so the field goes back to reflecting the store.
  const isAdminSignedIn = authenticated && isAdmin;
  const adminMaxBlobBytes = useShareStore((s) => s.adminMaxBlobBytes);
  const adminSettingsError = useShareStore((s) => s.adminSettingsError);
  const fetchAdminSettings = useShareStore((s) => s.fetchAdminSettings);
  const updateAdminSettings = useShareStore((s) => s.updateAdminSettings);
  const [maxBlobMbOverride, setMaxBlobMbOverride] = useState<string | null>(null);
  const [savingMaxBlob, setSavingMaxBlob] = useState(false);
  const maxBlobMbDisplay =
    maxBlobMbOverride ?? (adminMaxBlobBytes != null ? String(Math.round(adminMaxBlobBytes / (1024 * 1024))) : "");

  useEffect(() => {
    if (isAdminSignedIn) void fetchAdminSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminSignedIn]);

  // Phase 11 (real sync) — "Test connection" state for the Git & Sync
  // category. Plain local state (not a store): purely transient UI
  // feedback for one button in one view, same reasoning `loginError`/
  // `loggingIn` would get if they weren't ALSO needed by the boot-time
  // probe effect above (they are, hence useShareStore; this isn't).
  const [gitTokenDraft, setGitTokenDraft] = useState(gitAuthToken);
  // Phase 17 Milestone C1 — same draft-then-blur-commit pattern as
  // `gitTokenDraft` above: free typing while focused (never clamped
  // mid-keystroke, which would otherwise fight a user clearing the field to
  // type a new value), clamped via `clampSyncIntervalMinutes` only once, on
  // blur.
  const [gitSyncIntervalDraft, setGitSyncIntervalDraft] = useState(String(gitSyncIntervalMinutes));
  const [gitTesting, setGitTesting] = useState(false);
  const [gitTestResult, setGitTestResult] = useState<ConnectionTestResult | null>(null);
  const [gitTokenGenerating, setGitTokenGenerating] = useState(false);
  const [gitTokenGenerateError, setGitTokenGenerateError] = useState<string | null>(null);
  // Item 41 — the Advanced override's own credential field, same
  // draft-then-blur-commit pattern as `gitTokenDraft` above (never writes
  // the store on every keystroke of a secret).
  const [gitOverrideTokenDraft, setGitOverrideTokenDraft] = useState(gitRemoteOverrideToken);

  // Item 41(a) — the ONE resolved-settings object both the "Remote URL"
  // display below AND `useGitStore.ts`'s `remoteConfig()` derive from, via
  // the exact same `git/remote.ts` pure resolvers — never a second,
  // independently-computed guess that could drift from what sync actually
  // talks to.
  const gitRemoteSettings = useMemo(
    () => ({ repoName: gitRepoName, overrideEnabled: gitRemoteOverrideEnabled, overrideUrl: gitRemoteOverrideUrl }),
    [gitRepoName, gitRemoteOverrideEnabled, gitRemoteOverrideUrl],
  );
  const resolvedRemoteUrl = computeGitRemoteUrl(gitRemoteSettings);
  const repoNameError = gitRepoName.trim() === "" ? null : validateRepoName(gitRepoName);
  const overrideUrlError =
    gitRemoteOverrideEnabled && gitRemoteOverrideUrl.trim() !== "" && !isHttpRemoteUrl(gitRemoteOverrideUrl)
      ? "Enter a full http or https URL."
      : null;

  useEffect(() => {
    // Single-origin refactor (Phase 10.5a) — there's no more configurable
    // backend URL to gate a re-probe on; a plain mount-once probe (Settings
    // "Sharing" category mounting) is all this ever needs.
    void probeShareBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot's `navigator.storage.persist()` request (App.tsx) usually resolves
  // long before anyone opens Settings; this is only a fallback for the rare
  // case this tab mounts before that promise settles.
  const [ownPersistence, setOwnPersistence] = useState<StoragePersistenceStatus | undefined>(undefined);
  useMemo(() => {
    if (storagePersistence !== undefined || ownPersistence !== undefined) return;
    void requestPersistentStorage().then(setOwnPersistence);
    // Deliberately a one-shot `useMemo` "run once" trick, not `useEffect` —
    // this view never needs to re-request once either value is known, and
    // avoiding an extra effect keeps this simple. Safe because
    // `requestPersistentStorage` is itself idempotent (checks `persisted()`
    // first) even if this somehow ran twice under StrictMode's double-invoke.
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistence = storagePersistence ?? ownPersistence;

  const categories: Category[] = [
    {
      id: "appearance",
      label: "Appearance",
      icon: <Palette size={15} />,
      rows: [
        {
          id: "theme",
          label: "Theme",
          keywords: "appearance color scheme dark light palette",
          content: (
            <FormField label="Theme">
              <Select value={theme} onValueChange={(v) => setTheme(v as AppTheme)}>
                <SelectTrigger size="sm" style={{ width: 220 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {THEME_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ),
        },
        {
          id: "accent",
          label: "Accent color",
          keywords: "color accent teal primary swatch",
          content: (
            <FormField label="Accent color">
              <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}>
                <input
                  type="color"
                  aria-label="Accent color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-ui-sm)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-muted)" }}>{accent}</span>
              </div>
            </FormField>
          ),
        },
        {
          id: "density",
          label: "UI density",
          keywords: "compact default comfortable spacing density layout tree rows tabs chrome bands",
          content: (
            <FormField
              label="UI density"
              hint="Scales chrome height, row/tab padding, and icon spacing."
            >
              <RadioGroup
                value={uiDensity}
                onValueChange={(v) => setUiDensity(v as UiDensity)}
                style={{ display: "flex", gap: 18 }}
                aria-label="UI density"
              >
                {(
                  [
                    { value: "compact", label: "Compact" },
                    { value: "default", label: "Default" },
                    { value: "comfortable", label: "Comfortable" },
                  ] as const
                ).map((d) => (
                  <label key={d.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <RadioGroupItem value={d.value} />
                    {d.label}
                  </label>
                ))}
              </RadioGroup>
            </FormField>
          ),
        },
      ],
    },
    {
      id: "editor",
      label: "Editor",
      icon: <SlidersHorizontal size={15} />,
      rows: [
        {
          id: "font-size",
          label: "Font size",
          keywords: "editor text size source rendered",
          content: (
            <FormField label="Font size" hint="Applies to Source and Rendered views.">
              <Slider
                min={11}
                max={20}
                step={1}
                value={editorFontSize}
                showValue
                onChange={(e) => setEditorFontSize(Number(e.target.value))}
                aria-label="Editor font size"
              />
            </FormField>
          ),
        },
        {
          id: "tab-size",
          label: "Tab size",
          keywords: "indent spaces tabs",
          content: (
            <FormField label="Tab size">
              <RadioGroup
                value={String(tabSize)}
                onValueChange={(v) => setTabSize(Number(v))}
                style={{ display: "flex", gap: 18 }}
                aria-label="Tab size"
              >
                {TAB_SIZES.map((n) => (
                  <label key={n} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <RadioGroupItem value={String(n)} />
                    {n} spaces
                  </label>
                ))}
              </RadioGroup>
            </FormField>
          ),
        },
        {
          id: "word-wrap",
          label: "Word wrap",
          keywords: "wrap long lines source diff",
          content: (
            <FormField label="Word wrap" hint="Source and Diff modes only.">
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch checked={wordWrap} onCheckedChange={setWordWrap} aria-label="Word wrap" />
                <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Wrap long lines</span>
              </label>
            </FormField>
          ),
        },
        {
          id: "editor-line-spacing",
          label: "Line spacing",
          keywords: "line height editor source diff",
          content: (
            <FormField label="Line spacing" hint="Source and Diff modes.">
              <Slider
                min={1.2}
                max={2.2}
                step={0.1}
                value={editorLineSpacing}
                showValue
                onChange={(e) => setEditorLineSpacing(Number(e.target.value))}
                aria-label="Editor line spacing"
              />
            </FormField>
          ),
        },
      ],
    },
    {
      id: "rendered-view",
      label: "Rendered view",
      icon: <Eye size={15} />,
      rows: [
        {
          id: "content-width",
          label: "Content max-width",
          keywords: "column measure reading width ch rendered markdown full",
          content: (
            <FormField label="Content max-width" hint="The rendered markdown reading column width.">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-muted)" }}>
                    {renderedContentWidth === RENDERED_CONTENT_WIDTH_FULL ? "Full" : renderedContentWidth}
                  </span>
                </div>
                <Slider
                  min={40}
                  max={100}
                  step={2}
                  value={renderedContentWidth === RENDERED_CONTENT_WIDTH_FULL ? 100 : renderedContentWidth}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setRenderedContentWidth(next >= 100 ? RENDERED_CONTENT_WIDTH_FULL : next);
                  }}
                  aria-label="Rendered content max-width"
                />
              </div>
            </FormField>
          ),
        },
        {
          id: "margins",
          label: "Left/right margins",
          keywords: "padding margin rendered content gutter",
          content: (
            <FormField label="Left/right margins" hint="Space outside the reading column, in pixels.">
              <Slider
                min={16}
                max={96}
                step={4}
                value={renderedMargin}
                showValue
                onChange={(e) => setRenderedMargin(Number(e.target.value))}
                aria-label="Rendered left/right margins"
              />
            </FormField>
          ),
        },
        {
          id: "rendered-line-spacing",
          label: "Line spacing",
          keywords: "line height rendered markdown prose",
          content: (
            <FormField label="Line spacing">
              <Slider
                min={1.4}
                max={2.4}
                step={0.1}
                value={renderedLineSpacing}
                showValue
                onChange={(e) => setRenderedLineSpacing(Number(e.target.value))}
                aria-label="Rendered line spacing"
              />
            </FormField>
          ),
        },
        {
          id: "default-view-mode",
          label: "Default view mode",
          // DESIGN-SPEC Amendments item 11: "name it 'Default view mode',
          // never just 'mode'" — this is the exact row that confused the
          // user in the old dialog (labeled just "Default mode per file
          // type" there); every sub-row below spells out
          // "Default view when opening <Kind>:" per the spec's own example.
          keywords: "mode default markdown json html csv rendered source view open",
          content: (
            <FormField
              label="Default view mode"
              hint="Rendered or Source, per file type."
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DEFAULT_MODE_KINDS.map(({ kind, label }) => {
                  const value = readingViewDefaultMode[kind] ?? defaultModeFor(kind);
                  return (
                    <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ fontSize: 12.5, color: "var(--color-fg)" }}>
                        Default view when opening {label}:
                      </span>
                      <Select value={value} onValueChange={(v) => setReadingViewDefaultMode(kind, v as EditorMode)}>
                        <SelectTrigger size="sm" style={{ width: 130 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rendered">Rendered</SelectItem>
                          <SelectItem value="source">Source</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </FormField>
          ),
        },
      ],
    },
    {
      id: "git-sync",
      label: "Git & Sync",
      icon: <GitBranch size={15} />,
      rows: [
        // Phase 17 Milestone C2 — the server-mounted vault setup wizard /
        // mirror-remotes management surface. First row in this category:
        // when the server has no vault repo yet, this IS the primary thing
        // to do here (the rows below still work, but sync has nothing
        // authoritative to talk to until this wizard's step 1 completes).
        {
          id: "server-vault",
          wide: true,
          label: "Server vault",
          keywords: "vault wizard init mirror remote ssh key token setup server github gitlab gitea mounted legacy branch",
          content: <VaultSetupPanel clientRepoName={gitRepoName} />,
        },
        {
          id: "repo-info",
          label: "Repository",
          keywords: "branch repo git info vault ahead behind resolved",
          content: (
            <FormField label="Repository" hint="Exactly what Sync talks to right now, not a guess.">
              <DataList
                items={[
                  { label: "Repository", value: gitRepoName.trim() || DEFAULT_GIT_REPO_NAME },
                  { label: "Branch", value: branch },
                  { label: "Ahead / behind", value: `↑${ahead} ↓${behind}` },
                  // Item 41(a) — the SAME `computeGitRemoteUrl` call (and the
                  // same `gitRemoteSettings`) that `useGitStore.ts`'s
                  // `remoteConfig()` uses for every real push/pull/fetch, so
                  // this can never drift from what Sync actually does.
                  { label: "Remote URL", value: resolvedRemoteUrl },
                ]}
                density="compact"
              />
            </FormField>
          ),
        },
        // Round 6 item 15 ("clean tree") — decorations default OFF; the
        // Source Control panel is the home of change state.
        {
          id: "git-status-in-explorer",
          label: "Show git status in explorer",
          keywords: "git status letters tree explorer decorations colors clean",
          content: (
            <FormField label="Show git status in explorer" hint="Colors file names and shows status letters in the tree.">
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch
                  checked={showGitStatusInExplorer}
                  onCheckedChange={setShowGitStatusInExplorer}
                  aria-label="Show git status in explorer"
                  data-testid="git-status-in-explorer"
                />
                <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Off keeps the tree clean; changes stay in Source Control.</span>
              </label>
            </FormField>
          ),
        },
        {
          id: "repo-name",
          label: "Repository name",
          keywords: "repo name url path vault git",
          content: (
            <FormField
              label="Repository name"
              hint="Becomes the implicit remote path. Letters, digits, hyphens, underscores only."
              error={repoNameError ?? undefined}
            >
              <Input
                size="sm"
                value={gitRepoName}
                invalid={!!repoNameError}
                onChange={(e) => setGitRepoName(e.target.value)}
                aria-label="Repository name"
                data-testid="git-repo-name"
                style={{ width: 220, fontFamily: "var(--font-mono)" }}
              />
            </FormField>
          ),
        },
        {
          id: "vault-name",
          label: "Vault name",
          keywords: "vault display name rename tree folder label",
          content: (
            <FormField label="Vault name" hint="Renames the tree's top folder label only, not any file path.">
              <Input
                size="sm"
                value={vaultDisplayName}
                placeholder="vault"
                onChange={(e) => {
                  setVaultDisplayName(e.target.value);
                  void useFsStore.getState().refresh();
                }}
                aria-label="Vault name"
                data-testid="vault-display-name"
                style={{ width: 220 }}
              />
            </FormField>
          ),
        },
        {
          id: "remote-sync",
          label: "Remote sync",
          keywords: "remote url https token sync auth push pull ssh key test connection generate",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)" }}>Remote sync</span>
                <Badge variant={gitTestResult?.ok ? "success" : "neutral"} tone="soft">
                  {gitTestResult?.ok ? (gitTestResult.repoExists ? "Connected" : "Connected, repo not created yet") : "Fast-forward only"}
                </Badge>
              </div>
              <FormField
                label="Personal access token"
                hint="A write scoped API token. Sign in under Sharing, then click Generate token."
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    size="sm"
                    type="password"
                    placeholder="vsn_••••••••••••••••"
                    value={gitTokenDraft}
                    disabled={gitRemoteOverrideEnabled}
                    onChange={(e) => setGitTokenDraft(e.target.value)}
                    onBlur={() => setGitAuthToken(gitTokenDraft)}
                    aria-label="Personal access token"
                    style={{ flex: 1 }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!authenticated || gitTokenGenerating || gitRemoteOverrideEnabled}
                    data-testid="git-generate-token"
                    onClick={() => {
                      setGitTokenGenerating(true);
                      setGitTokenGenerateError(null);
                      createApiToken("vsnote-git-sync", "write")
                        .then((created) => {
                          setGitTokenDraft(created.token);
                          setGitAuthToken(created.token);
                        })
                        .catch((err) => {
                          setGitTokenGenerateError(err instanceof Error ? err.message : "Could not generate a token.");
                        })
                        .finally(() => setGitTokenGenerating(false));
                    }}
                  >
                    {gitTokenGenerating ? <Loader2 size={13} className="animate-spin" /> : "Generate token"}
                  </Button>
                </div>
              </FormField>
              {gitRemoteOverrideEnabled && (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  Unused while the custom remote override below is on.
                </span>
              )}
              {!authenticated && !gitRemoteOverrideEnabled && (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  Sign in under Sharing to generate a token, or paste one you have.
                </span>
              )}
              {gitTokenGenerateError && (
                <Alert variant="danger" size="sm">
                  {gitTokenGenerateError}
                </Alert>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="git-test-connection"
                  // DESIGN-SPEC Amendments round 4 item 27: this button's own
                  // label ("Test connection") was overflowing/wrapping inside
                  // the fixed `h-8` button height at some densities — the
                  // library's `Button` doesn't set `whitespace-nowrap` on its
                  // own (unlike some of its other primitives), so a squeezed
                  // flex row could wrap the label onto a second line and clip
                  // it. `shrink: 0` keeps the button at its natural
                  // (label-sized) width instead of letting the flex row
                  // shrink it below that.
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  onClick={() => {
                    if (gitRemoteOverrideEnabled) setGitRemoteOverrideToken(gitOverrideTokenDraft);
                    else setGitAuthToken(gitTokenDraft);
                    setGitTesting(true);
                    setGitTestResult(null);
                    // Item 41(e) — tests whichever remote is ACTIVE right
                    // now: the same `gitRemoteSettings`-derived URL and the
                    // same `resolveGitCredential` token selection
                    // `useGitStore.ts`'s `remoteConfig()` uses for a real
                    // sync, so "Test connection" never validates a
                    // different remote than the one Sync would actually use.
                    void testGitConnection({
                      url: resolvedRemoteUrl,
                      token: resolveGitCredential({
                        token: gitTokenDraft,
                        overrideEnabled: gitRemoteOverrideEnabled,
                        overrideUrl: gitRemoteOverrideUrl,
                        overrideToken: gitOverrideTokenDraft,
                      }),
                    })
                      .then(setGitTestResult)
                      .finally(() => setGitTesting(false));
                  }}
                >
                  {gitTesting ? <Loader2 size={13} className="animate-spin" /> : "Test connection"}
                </Button>
                {gitTestResult && !gitTesting && (
                  <span
                    data-testid="git-test-result"
                    style={{ fontSize: 12.5, color: gitTestResult.ok ? "var(--color-muted)" : "var(--git-deleted)" }}
                  >
                    {describeConnectionTest(gitTestResult, gitRemoteOverrideEnabled).message}
                  </span>
                )}
              </div>
            </div>
          ),
        },
        {
          id: "custom-remote",
          label: "Advanced: custom remote",
          keywords: "advanced custom remote external github gitea token credential override",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: gitRemoteOverrideEnabled ? 1 : 0.85 }}>
              <FormField label="Advanced: custom remote override" hint="For an external GitHub, Gitea, or other VSNote remote. Off by default.">
                <Switch
                  checked={gitRemoteOverrideEnabled}
                  onCheckedChange={setGitRemoteOverrideEnabled}
                  aria-label="Advanced: custom remote override"
                  data-testid="git-override-enabled"
                />
              </FormField>
              {gitRemoteOverrideEnabled && (
                <>
                  <FormField label="Custom remote URL" hint="A full http or https git remote URL." error={overrideUrlError ?? undefined}>
                    <Input
                      size="sm"
                      value={gitRemoteOverrideUrl}
                      invalid={!!overrideUrlError}
                      placeholder="https://github.com/you/notes.git"
                      onChange={(e) => setGitRemoteOverrideUrl(e.target.value)}
                      aria-label="Custom remote URL"
                      data-testid="git-override-url"
                      style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                    />
                  </FormField>
                  <FormField label="Custom remote credential" hint="A personal access token for that remote. Kept separate from the token above.">
                    <Input
                      size="sm"
                      type="password"
                      placeholder="ghp_••••••••••••••••"
                      value={gitOverrideTokenDraft}
                      onChange={(e) => setGitOverrideTokenDraft(e.target.value)}
                      onBlur={() => setGitRemoteOverrideToken(gitOverrideTokenDraft)}
                      aria-label="Custom remote credential"
                      data-testid="git-override-token"
                      style={{ width: "100%" }}
                    />
                  </FormField>
                  <Alert variant="note" size="sm">
                    Sync stays fast-forward or auto-merge here too. It never force-pushes.
                  </Alert>
                </>
              )}
            </div>
          ),
        },
        {
          id: "commit-template",
          label: "Default commit message",
          keywords: "commit message template device timestamp date time files branch sync auto-commit merge",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <FormField
                label="Default commit message"
                hint="Prefills the commit box. Supports {device} {timestamp} {date} {time} {files} {branch}."
              >
                <Input
                  size="sm"
                  value={gitCommitTemplate}
                  onChange={(e) => setGitCommitTemplate(e.target.value)}
                  aria-label="Default commit message template"
                  data-testid="git-commit-template"
                  style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                />
              </FormField>
              {gitCommitTemplate.trim() === "" && (
                <Button type="button" variant="ghost" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setGitCommitTemplate(DEFAULT_GIT_COMMIT_TEMPLATE)}>
                  Reset to default
                </Button>
              )}
              <span data-testid="git-commit-template-preview" style={{ fontSize: 12, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>
                Preview: {renderCommitTemplate(
                  gitCommitTemplate,
                  buildTemplateVars({ device: gitDeviceName || "device", branch, files: ["architecture.md"] }),
                )}
              </span>
            </div>
          ),
        },
        {
          id: "device-name",
          label: "Device name",
          keywords: "device name hostname computer template sync",
          content: (
            <FormField label="Device name" hint="Auto-detected from your browser; editable.">
              <Input
                size="sm"
                value={gitDeviceName}
                onChange={(e) => setGitDeviceName(e.target.value)}
                aria-label="Device name"
                data-testid="git-device-name"
                style={{ width: 220, fontFamily: "var(--font-mono)" }}
              />
            </FormField>
          ),
        },
        // Phase 17 Milestone C1 — every policy still runs the exact same
        // Sync pipeline (`useGitStore.getState().syncNow()`); this only
        // decides when it fires on its own. See `git/autoSyncPolicy.ts`.
        {
          id: "auto-sync",
          label: "Auto-sync",
          keywords: "auto sync automatic interval minutes open close save schedule background",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <FormField label="Auto-sync" hint="Every policy runs the same Sync pipeline; this only decides when.">
                <Select value={gitSyncPolicy} onValueChange={(v) => setGitSyncPolicy(v as typeof gitSyncPolicy)}>
                  <SelectTrigger size="sm" data-testid="git-sync-policy" style={{ width: 240 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual, click Sync</SelectItem>
                    <SelectItem value="interval">Every N minutes</SelectItem>
                    <SelectItem value="open-close">On app open and close</SelectItem>
                    <SelectItem value="on-save">After each save</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {gitSyncPolicy === "interval" && (
                <FormField label="Interval" hint={`Minutes between syncs. Minimum ${MIN_SYNC_INTERVAL_MINUTES}.`}>
                  <Input
                    size="sm"
                    type="number"
                    min={MIN_SYNC_INTERVAL_MINUTES}
                    value={gitSyncIntervalDraft}
                    onChange={(e) => setGitSyncIntervalDraft(e.target.value)}
                    onBlur={() => {
                      const clamped = clampSyncIntervalMinutes(Number(gitSyncIntervalDraft));
                      setGitSyncIntervalDraft(String(clamped));
                      setGitSyncIntervalMinutes(clamped);
                    }}
                    aria-label="Auto-sync interval in minutes"
                    data-testid="git-sync-interval-minutes"
                    style={{ width: 100 }}
                  />
                </FormField>
              )}
              {gitSyncPolicy !== "manual" && (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  Skips a run while a sync is in progress, while signed out, or while a conflict is waiting on you.
                </span>
              )}
            </div>
          ),
        },
      ],
    },
    {
      id: "sharing",
      label: "Sharing",
      icon: <Share2 size={15} />,
      rows: [
        {
          id: "share-backend",
          label: "Backend connection",
          keywords: "share publish backend server url connect sign in login token offline reachability",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {reachability === "offline" && (
                <Alert variant="warning" size="sm" title="Backend not running">
                  Start it with <code>npm run server</code> from the repo root. The rest of VSNote works fine
                  without it; only sharing needs it.
                </Alert>
              )}
              {/* Phase 10.5a (single-origin refactor, roadmap §5.4) — no more
                  Backend URL field: the backend is same-origin, so "Test
                  connection" is just a re-probe. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge
                  variant={reachability === "online" ? "success" : reachability === "offline" ? "danger" : "neutral"}
                  tone="soft"
                  data-testid="share-backend-status"
                >
                  {reachability === "online" ? "Online" : reachability === "offline" ? "Offline" : reachability === "checking" ? "Checking…" : "Unknown"}
                </Badge>
                <Button type="button" variant="secondary" size="sm" data-testid="share-backend-test" onClick={() => void probeShareBackend()}>
                  {reachability === "checking" ? <Loader2 size={13} className="animate-spin" /> : "Test connection"}
                </Button>
                {reachability === "online" && authenticated && (
                  <>
                    <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>Signed in as {shareUsername}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="share-signout"
                      onClick={() => void logoutShareBackend()}
                    >
                      Sign out
                    </Button>
                  </>
                )}
              </div>
              {reachability === "online" && !authenticated && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input
                      size="sm"
                      placeholder="Username"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      aria-label="Backend username"
                      data-testid="share-login-username"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Input
                      size="sm"
                      type="password"
                      placeholder="Password"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      aria-label="Backend password"
                      data-testid="share-login-password"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={loggingIn}
                      data-testid="share-login-submit"
                      style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                      onClick={() => void loginShareBackend(loginUser, loginPass)}
                    >
                      {loggingIn ? <Loader2 size={13} className="animate-spin" /> : "Sign in"}
                    </Button>
                  </div>
                  {loginError && (
                    <Alert variant="danger" size="sm">
                      {loginError}
                    </Alert>
                  )}
                </div>
              )}
            </div>
          ),
        },
        {
          id: "shared-panel",
          wide: true,
          label: "Shared",
          keywords: "shares links published revoke regenerate hits audit expiry password access",
          content: <SharedPanel authenticated={authenticated} onEditShare={setEditingShare} />,
        },
        // DESIGN-SPEC Amendments round 5, item 40 — admin-only, hidden
        // entirely (not disabled) for a non-admin/signed-out caller, same
        // treatment `rowMatches`/search already gives every other row: a
        // row that isn't in this array can't be found by search either.
        ...(isAdminSignedIn
          ? [
              {
                id: "admin-blob-limit",
                label: "Share size limit",
                keywords: "admin blob size limit max upload mb bytes share",
                content: (
                  <FormField label="Share size limit" hint="Maximum share upload size in MB, from 1 to 100.">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Input
                        size="sm"
                        type="number"
                        min={1}
                        max={100}
                        value={maxBlobMbDisplay}
                        onChange={(e) => setMaxBlobMbOverride(e.target.value)}
                        aria-label="Share size limit in megabytes"
                        data-testid="admin-max-blob-mb"
                        style={{ width: 90 }}
                      />
                      <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>MB</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={savingMaxBlob}
                        data-testid="admin-max-blob-save"
                        onClick={() => {
                          const mb = Number(maxBlobMbDisplay);
                          if (!Number.isFinite(mb) || mb < 1 || mb > 100) return;
                          setSavingMaxBlob(true);
                          void updateAdminSettings(Math.round(mb * 1024 * 1024))
                            .then((ok) => {
                              if (ok) setMaxBlobMbOverride(null);
                            })
                            .finally(() => setSavingMaxBlob(false));
                        }}
                      >
                        {savingMaxBlob ? <Loader2 size={13} className="animate-spin" /> : "Save"}
                      </Button>
                    </div>
                    {adminSettingsError && (
                      <Alert variant="danger" size="sm" style={{ marginTop: 8 }}>
                        {adminSettingsError}
                      </Alert>
                    )}
                  </FormField>
                ),
              },
            ]
          : []),
      ],
    },
    {
      id: "storage",
      label: "Storage",
      icon: <HardDrive size={15} />,
      rows: [
        {
          id: "persistence",
          label: "Persistence status",
          keywords: "storage persist indexeddb quota durability",
          content: (
            <FormField label="Persistence status" hint="Whether the browser has granted this vault a persistent IndexedDB bucket.">
              {persistence === undefined ? (
                <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>Checking…</span>
              ) : (
                <Badge
                  variant={persistence === "granted" ? "success" : persistence === "denied" ? "warning" : "neutral"}
                  tone="soft"
                >
                  {persistence === "granted" ? "Persistent storage granted" : persistence === "denied" ? "Storage not persisted" : "Unsupported in this browser"}
                </Badge>
              )}
            </FormField>
          ),
        },
        {
          id: "export",
          label: "Export vault as .zip",
          keywords: "export download zip backup archive",
          content: (
            <FormField label="Export vault" hint="Downloads every file in the vault, zipped, client-side.">
              {/* FormField is a stretch column — without alignSelf the button
                  goes full width (round 6 item 21: buttons natural width). */}
              <Button type="button" variant="secondary" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => onExportVault?.()}>
                Export vault as .zip
              </Button>
            </FormField>
          ),
        },
        // Round 6 item 21 — the reset row exists ONLY in demo builds. In a
        // real vault this button was a one-click self-destruct sitting next
        // to Export; non-demo users who truly want a wipe still have the
        // command palette's "Reset vault…" behind its confirm dialog.
        ...(isDemoVaultBuild()
          ? [
              {
                id: "reset",
                label: "Reset demo vault",
                keywords: "reset demo vault wipe restore reseed",
                content: (
                  <FormField label="Reset demo vault" hint="Wipes the in-browser filesystem and git history, then re-seeds the demo vault. Cannot be undone.">
                    <Button type="button" variant="danger" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => onRequestResetVault?.()}>
                      Reset demo vault…
                    </Button>
                  </FormField>
                ),
              },
            ]
          : []),
      ],
    },
    {
      id: "keyboard",
      label: "Keyboard",
      icon: <KeyboardIcon size={15} />,
      rows: [
        {
          id: "shortcuts",
          label: "Keyboard shortcuts",
          keywords: "kbd shortcuts hotkeys palette save search close zen esc",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {SHORTCUTS.map((s) => (
                <div key={s.keys} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Kbd style={{ minWidth: 56, textAlign: "center" }}>{s.keys}</Kbd>
                  <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>{s.description}</span>
                </div>
              ))}
            </div>
          ),
        },
      ],
    },
  ];

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;
  const visibleCategory = categories.find((c) => c.id === activeCategory) ?? categories[0];

  return (
    <>
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }} data-testid="settings-view">
      {/* Chrome default is `user-select: none` (DESIGN-SPEC Amendments item
          12); Settings is a form surface, not document content, so it stays
          the default — the native inputs above remain selectable/typeable
          via `index.css`'s `input, textarea` exception regardless. */}
      {/* Round 6 item 20 — full-width view (the old 760px cap squeezed the
          Sharing table and Git rows); the reading measure is handled per-row,
          not by capping the whole view. */}
      <div style={{ padding: "40px 40px 120px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: "0 0 4px" }}>Settings</h1>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 20px" }}>
          Editor, theme, and per-file-type defaults, saved automatically.
        </p>

        <div style={{ position: "relative", marginBottom: 24, maxWidth: "28rem" }}>
          <SearchIcon
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)", pointerEvents: "none" }}
          />
          <Input
            size="sm"
            placeholder="Search settings…"
            aria-label="Search settings"
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 30, width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          <nav
            aria-label="Settings categories"
            style={{ display: "flex", flexDirection: "column", gap: 2, width: 172, flexShrink: 0 }}
          >
            {categories.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant={!searching && c.id === activeCategory ? "secondary" : "ghost"}
                size="sm"
                data-testid={`settings-nav-${c.id}`}
                onClick={() => setActiveCategory(c.id)}
                style={{ justifyContent: "flex-start", gap: 8, width: "100%" }}
              >
                {c.icon}
                {c.label}
              </Button>
            ))}
          </nav>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 22 }}>
            {searching ? (
              categories
                .map((c) => ({ category: c, rows: c.rows.filter((r) => rowMatches(r, trimmedQuery)) }))
                .filter(({ rows }) => rows.length > 0)
                .map(({ category, rows }, groupIndex) => (
                  <div key={category.id} data-testid={`settings-group-${category.id}`}>
                    {groupIndex > 0 && <Separator style={{ marginBottom: 22 }} />}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-muted)",
                        marginBottom: 12,
                      }}
                    >
                      {category.icon}
                      {category.label}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                      {rows.map((row) => (
                        <div key={row.id} data-testid={`settings-row-${row.id}`} style={row.wide ? undefined : { maxWidth: ROW_MAX_WIDTH }}>
                          {row.content}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }} data-testid={`settings-group-${visibleCategory.id}`}>
                {visibleCategory.rows.map((row) => (
                  <div key={row.id} data-testid={`settings-row-${row.id}`} style={row.wide ? undefined : { maxWidth: ROW_MAX_WIDTH }}>
                    {row.content}
                  </div>
                ))}
              </div>
            )}
            {searching && !categories.some((c) => c.rows.some((r) => rowMatches(r, trimmedQuery))) && (
              <p style={{ fontSize: 13, color: "var(--color-muted)" }}>No settings match "{trimmedQuery}".</p>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
    {editingShare && (
      <Suspense fallback={null}>
        <PublishDialog
          open={editingShare !== null}
          onOpenChange={(open) => !open && setEditingShare(null)}
          existingShare={editingShare}
        />
      </Suspense>
    )}
    </>
  );
}

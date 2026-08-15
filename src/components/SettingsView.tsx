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
import { useMemo, useState, type ReactNode } from "react";
import {
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
  Palette,
  Search as SearchIcon,
  SlidersHorizontal,
} from "lucide-react";
import {
  THEME_OPTIONS,
  useSettingsStore,
  type SlateTheme,
  type UiDensity,
} from "../stores/useSettingsStore";
import { defaultModeFor } from "../filetypes/registry";
import { useGitStore } from "../stores/useGitStore";
import { requestPersistentStorage, type StoragePersistenceStatus } from "../fs/persistence";
import type { EditorMode, FileKind } from "../types";

export interface SettingsViewProps {
  /** Boot-time `navigator.storage.persist()` result, threaded down from
   * `App.tsx` (`EditorArea.tsx`'s doc) — this view re-requests it itself as
   * a fallback only if the Settings tab somehow opens before that boot
   * request has resolved. */
  storagePersistence?: StoragePersistenceStatus;
  onExportVault?: () => void;
  onRequestResetVault?: () => void;
}

const THEME_LABELS: Record<SlateTheme, string> = {
  dark: "Dark (Slate default)",
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
  { keys: "⌘K", description: "Command palette — file jump + commands, grouped" },
  { keys: "⌘P", description: "Go to file" },
  { keys: "⌘S", description: "Save the active buffer (clears the dirty dot, keeps git-dirty)" },
  { keys: "⌘F", description: "Find — CM6 search in Source/Diff, note-text search in Rendered" },
  { keys: "⌘E", description: "Toggle Rendered / Source (Obsidian muscle memory)" },
  { keys: "⌘W", description: "Close the active tab (best-effort — some browsers reserve this)" },
  { keys: "⌘⇧W", description: "Close the active tab — guaranteed fallback for ⌘W" },
  { keys: "⌘⇧Z", description: "Toggle zen mode (content-area fullscreen)" },
  { keys: "Esc", description: "Exit zen mode, or close the palette / find widget / dialogs" },
];

interface SettingRow {
  id: string;
  label: string;
  keywords?: string;
  content: ReactNode;
}

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
  const gitRemoteUrl = useSettingsStore((s) => s.gitRemoteUrl);
  const gitAuthToken = useSettingsStore((s) => s.gitAuthToken);

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
              <Select value={theme} onValueChange={(v) => setTheme(v as SlateTheme)}>
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
          keywords: "compact comfortable spacing density layout tree rows tabs",
          content: (
            <FormField label="UI density" hint="Tree row and tab strip horizontal spacing.">
              <RadioGroup
                value={uiDensity}
                onValueChange={(v) => setUiDensity(v as UiDensity)}
                style={{ display: "flex", gap: 18 }}
                aria-label="UI density"
              >
                {(["comfortable", "compact"] as const).map((d) => (
                  <label key={d} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <RadioGroupItem value={d} />
                    {d === "comfortable" ? "Comfortable" : "Compact"}
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
            <FormField label="Word wrap" hint="Source and Diff modes — Rendered always wraps.">
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
          keywords: "column measure reading width ch rendered markdown",
          content: (
            <FormField label="Content max-width" hint="The rendered markdown reading column, in characters (ch).">
              <Slider
                min={40}
                max={100}
                step={2}
                value={renderedContentWidth}
                showValue
                onChange={(e) => setRenderedContentWidth(Number(e.target.value))}
                aria-label="Rendered content max-width"
              />
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
              hint="Which view a file of this type opens in — Rendered (WYSIWYG) or Source (raw text)."
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
        {
          id: "repo-info",
          label: "Repository",
          keywords: "branch repo git info vault ahead behind",
          content: (
            <FormField label="Repository">
              <DataList
                items={[
                  { label: "Repository", value: "vault" },
                  { label: "Branch", value: branch },
                  { label: "Ahead / behind", value: `↑${ahead} ↓${behind}` },
                ]}
                density="compact"
              />
            </FormField>
          ),
        },
        {
          id: "remote-sync",
          label: "Remote sync — coming soon",
          keywords: "remote url https token sync auth push pull ssh key",
          content: (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)" }}>Remote sync</span>
                <Badge variant="neutral" tone="soft">
                  Coming soon
                </Badge>
              </div>
              <FormField label="Remote URL (HTTPS)" hint="Real sync isn't wired up yet — stored, not used.">
                <Input
                  size="sm"
                  disabled
                  placeholder="https://github.com/you/vault.git"
                  value={gitRemoteUrl}
                  onChange={() => {}}
                  aria-label="Remote URL"
                />
              </FormField>
              <FormField
                label="Personal access token"
                hint="HTTPS + token only — browsers can't speak SSH (no raw TCP), so there's no SSH-key management here. Real sync will use isomorphic-git over HTTPS."
              >
                <Input
                  size="sm"
                  type="password"
                  disabled
                  placeholder="ghp_••••••••••••••••"
                  value={gitAuthToken}
                  onChange={() => {}}
                  aria-label="Personal access token"
                />
              </FormField>
            </div>
          ),
        },
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
              <Button type="button" variant="secondary" size="sm" onClick={() => onExportVault?.()}>
                Export vault as .zip
              </Button>
            </FormField>
          ),
        },
        {
          id: "reset",
          label: "Reset demo vault",
          keywords: "reset demo vault wipe restore reseed",
          content: (
            <FormField label="Reset demo vault" hint="Wipes the in-browser filesystem and git history, then re-seeds the original demo vault. Cannot be undone.">
              <Button type="button" variant="danger" size="sm" onClick={() => onRequestResetVault?.()}>
                Reset demo vault…
              </Button>
            </FormField>
          ),
        },
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
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }} data-testid="settings-view">
      {/* Chrome default is `user-select: none` (DESIGN-SPEC Amendments item
          12); Settings is a form surface, not document content, so it stays
          the default — the native inputs above remain selectable/typeable
          via `index.css`'s `input, textarea` exception regardless. */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px 120px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: "0 0 4px" }}>Settings</h1>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 20px" }}>
          Editor, theme, and per-file-type defaults — saved automatically.
        </p>

        <div style={{ position: "relative", marginBottom: 24 }}>
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
                        <div key={row.id} data-testid={`settings-row-${row.id}`}>
                          {row.content}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }} data-testid={`settings-group-${visibleCategory.id}`}>
                {visibleCategory.rows.map((row) => (
                  <div key={row.id} data-testid={`settings-row-${row.id}`}>
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
  );
}

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
 * representations of file content.
 *
 * **Split into a thin shell + one file per category (docs/PLAN-2026-09-05-
 * refresh.md §2 item 4)** — this file used to be ~1400 lines holding every
 * category's rows inline. It now owns exactly three things: the left
 * category nav, the search-filtered row list, and routing between
 * categories — nothing about any one category's fields. Each
 * `settings/<Category>.tsx` module exports a `use<Category>Rows()` hook
 * returning the same `SettingRow[]` shape this shell has always rendered
 * and searched (`settings/types.ts`), so search/grouping/testids are
 * unchanged by the split.
 *
 * **Page width (plan §2 item 1).** The content column caps at ~52rem,
 * centered in the full width of the view — `SettingsRow`'s own
 * `controlWidth` (plan §2 item 3) sizes individual fields (numbers/short
 * enums ~12rem, text ~24rem, full-row for textareas/tables) inside that
 * column — see `local/SettingsRow.tsx`.
 *
 * **R4 defect B — category nav is a horizontal row, not a left column.**
 * R3-3 (round 10 item 103, superseded here) only compacted the search
 * field onto the title row and left the category list as a VSCode-style
 * left column — stacked behind the activity bar, the Explorer, AND that
 * column, the exact "cascading left panels" look the owner asked to kill.
 * The category nav is now a sticky, horizontal, wrapping row of icon+label
 * tabs directly under the title row, and content spans the view's full
 * width below it (its own reading column still centers/caps at 52rem).
 * Built on `my-you-eye`'s `Tabs`/`TabsList`/`TabsTrigger` (`pills` variant
 * — a discrete "switch which panel is showing" choice, which is exactly
 * what the library's own docs say `Tabs` is for and `SegmentedControl` is
 * NOT: `components.json`'s `SegmentedControl` entry describes itself as "a
 * form control... not navigation. Use it instead of Tabs when the choice
 * sets a value"). `Tabs`/`TabsList` give the row native roving-tabindex
 * keyboard nav (arrow keys move focus between triggers) for free; only
 * `TabsContent` is skipped since this shell already renders exactly one
 * category's rows itself (search-filtered grouping needs that same manual
 * control). Sticky like the old left nav was: `top` matches the page's
 * top padding, and there is no `overflow`/`transform` between it and
 * `ScrollArea`'s own scrollport, so it stops flush with the top of the
 * view as the content scrolls beneath it — only the title row scrolls
 * away.
 */
import { useMemo, useState } from "react";
import { Input, ScrollArea, Separator, Tabs, TabsList, TabsTrigger } from "my-you-eye";
import {
  Eye,
  GitBranch,
  HardDrive,
  Keyboard as KeyboardIcon,
  Package,
  Palette,
  Search as SearchIcon,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import { useAppearanceRows } from "./settings/Appearance";
import { useEditorRows } from "./settings/Editor";
import { useRenderedRows } from "./settings/Rendered";
import { useGitRows } from "./settings/Git";
import { useSharingRows } from "./settings/Sharing";
import { useStorageRows } from "./settings/Storage";
import { usePacksRows } from "./settings/Packs";
import { useKeyboardRows } from "./settings/Keyboard";
import { rowMatches, type SettingsCategory } from "./settings/types";
import { requestPersistentStorage, type StoragePersistenceStatus } from "../fs/persistence";

export interface SettingsViewProps {
  /** Boot-time `navigator.storage.persist()` result, threaded down from
   * `App.tsx` (`EditorArea.tsx`'s doc) — this view re-requests it itself as
   * a fallback only if the Settings tab somehow opens before that boot
   * request has resolved. */
  storagePersistence?: StoragePersistenceStatus;
  onExportVault?: () => void;
  onRequestResetVault?: () => void;
  /** Storage onboarding (plan §1 item 4) — opens the existing "Restore from
   * remote?" confirm dialog `App.tsx` already owns for the command
   * palette's "Restore from remote…" entry. */
  onRestoreFromRemote?: () => void;
}

export function SettingsView({ storagePersistence, onExportVault, onRequestResetVault, onRestoreFromRemote }: SettingsViewProps) {
  const [activeCategory, setActiveCategory] = useState("appearance");
  const [query, setQuery] = useState("");

  // Boot's `navigator.storage.persist()` request (App.tsx) usually resolves
  // long before anyone opens Settings; this is only a fallback for the rare
  // case this tab mounts before that promise settles.
  const [ownPersistence, setOwnPersistence] = useState<StoragePersistenceStatus | undefined>(undefined);
  useMemo(() => {
    if (storagePersistence !== undefined || ownPersistence !== undefined) return;
    void requestPersistentStorage().then(setOwnPersistence);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistence = storagePersistence ?? ownPersistence;

  const categories: SettingsCategory[] = [
    { id: "appearance", label: "Appearance", icon: <Palette size={15} />, rows: useAppearanceRows() },
    { id: "editor", label: "Editor", icon: <SlidersHorizontal size={15} />, rows: useEditorRows() },
    { id: "rendered-view", label: "Rendered view", icon: <Eye size={15} />, rows: useRenderedRows() },
    { id: "git-sync", label: "Git & Sync", icon: <GitBranch size={15} />, rows: useGitRows() },
    { id: "sharing", label: "Sharing", icon: <Share2 size={15} />, rows: useSharingRows() },
    { id: "packs", label: "Packs", icon: <Package size={15} />, rows: usePacksRows() },
    {
      id: "storage",
      label: "Storage",
      icon: <HardDrive size={15} />,
      rows: useStorageRows({ persistence, onExportVault, onRequestResetVault, onRestoreFromRemote }),
    },
    { id: "keyboard", label: "Keyboard", icon: <KeyboardIcon size={15} />, rows: useKeyboardRows() },
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
      <div style={{ padding: "40px 40px 120px" }}>
        {/* Title row: title left, search field (~280px) + its hint beneath
            it on the right. This row is free to scroll away — only the
            category tabs below stay sticky (R4 defect B). */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "8px 24px",
            marginBottom: 20,
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: 0 }}>Settings</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 280, maxWidth: "100%", flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
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
            <p style={{ fontSize: 11, color: "var(--color-muted)", margin: 0 }}>
              Editor, theme, and per-file-type defaults, saved automatically.
            </p>
          </div>
        </div>

        {/* R4 defect B — horizontal, sticky, wrapping category row (replaces
            the left nav column). `top` matches the page's 40px top padding
            and there is no `overflow`/`transform` between this and
            `ScrollArea`'s own scrollport, so it sticks flush with the top of
            the view once the title row scrolls past it. A background is set
            explicitly (not just inherited) so content scrolling underneath
            doesn't show through the sticky row. */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            marginInline: -40,
            paddingInline: 40,
            paddingBlock: "10px 12px",
            marginBottom: 20,
            background: "var(--app-editor-bg)",
            borderBottom: "1px solid var(--app-border-nested, var(--color-border))",
          }}
        >
          <Tabs value={activeCategory} onValueChange={setActiveCategory} variant="pills">
            <TabsList
              aria-label="Settings categories"
              style={{ flexWrap: "wrap", rowGap: 6, width: "100%" }}
            >
              {categories.map((c) => (
                <TabsTrigger
                  key={c.id}
                  value={c.id}
                  data-testid={`settings-nav-${c.id}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {c.icon}
                  {c.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Plan §2 item 1 — the content column caps at ~52rem, centered in
            the view's full width now that there is no left nav column
            eating into it. */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: "52rem", display: "flex", flexDirection: "column", gap: 22 }}>
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

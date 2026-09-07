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
 * **R4 defect B — category nav is a sticky vertical "map" on the right,
 * not a left column (redone from a horizontal-row first attempt — see
 * DESIGN-SPEC item 119).** R3-3 (round 10 item 103) only compacted the
 * search field onto the title row and left the category list as a
 * VSCode-style left column — stacked behind the activity bar, the
 * Explorer, AND that column, the exact "cascading left panels" look the
 * owner asked to kill. Below the title row this shell is a two-column
 * `.settings-layout` (CSS in `index.css`): `.settings-content` (the
 * reading column, still centering/capping at ~52rem) on the left, and a
 * narrow `.settings-nav-rail` on the right, `position: sticky` so it stays
 * in view while a long category's rows scroll past it. Below ~900px there
 * is no room for a fixed-width rail beside a comfortable reading column,
 * so the CSS reverses the row (rail first, i.e. on top) and reflows the
 * rail itself into a horizontal, wrapping row — still sticky.
 *
 * Built on `my-you-eye`'s `Tabs`/`TabsList`/`TabsTrigger` (`pills` variant
 * — a discrete "switch which panel is showing" choice, which is exactly
 * what the library's own docs say `Tabs` is for and `SegmentedControl` is
 * NOT: `components.json`'s `SegmentedControl` entry describes itself as "a
 * form control... not navigation. Use it instead of Tabs when the choice
 * sets a value"). The library has no dedicated vertical nav/TOC primitive
 * (`components.json` has no `NavList`/`SideNav`/`TOC`, and `Tabs` itself
 * has no `orientation` prop of its own — but it forwards unknown props to
 * Radix's `Tabs.Root`, which DOES support `orientation`), so this passes
 * `orientation="vertical"` through at the wide layout for real up/down
 * roving-tabindex keyboard nav (Radix's own vertical-tablist behavior),
 * and `"horizontal"` at the narrow, wrapping-row layout — tracked via a
 * `matchMedia` listener at the same 900px breakpoint the CSS uses, so the
 * two stay in sync. `index.css`'s rules only reflow layout (flex
 * direction, width, sticky) on top of the library's own visuals — no
 * fork, no local component needed. `TabsContent` is skipped since this
 * shell renders every category's rows itself, continuously, and needs the
 * same manual control for search-filtered grouping.
 *
 * **The rail is a scroll-spy table of contents, not a switcher (owner
 * follow-up).** Content is ALL categories' sections stacked in one
 * continuous scroll (search still filters rows per section, hiding a
 * section entirely when nothing in it matches) — there is no more "only
 * the active category's rows are mounted" behavior. Clicking a
 * `TabsTrigger` (`activationMode="manual"`, so arrow-key roving focus
 * doesn't also trigger a scroll on every keypress — only Enter/Space or a
 * click does) smooth-scrolls that section's heading to
 * `SETTINGS_SCROLL_SPY_OFFSET` below the scrollport's top; `Tabs`' `value`
 * is NOT set directly by that click, only `activeCategory` state is,
 * except `activeCategory` is ALSO the thing a scroll listener keeps in
 * sync with whichever section's heading has scrolled past that same
 * offset — so a manual scroll (no click at all) updates the highlighted
 * item exactly the way a click does, and `aria-selected` (driven by
 * `Tabs`' controlled `value`) always reflects real scroll position, per
 * the owner's ask. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Matches `index.css`'s `.settings-layout`/`.settings-nav-rail` breakpoint
 * — the rail is a vertical right-side column above this width, a
 * horizontal wrapping row below it. Kept as one shared literal so the
 * `Tabs` `orientation` this component picks (for correct up/down vs.
 * left/right roving-tabindex keyboard nav) never drifts from the CSS. */
const SETTINGS_NAV_RAIL_BREAKPOINT = "(max-width: 900px)";

/** Both the target gap a click-driven scroll leaves above a section's
 * heading, and the threshold line the scroll-spy watches: a section counts
 * as "current" once its heading has scrolled up to (or past) this many
 * pixels from the scrollport's top. Keeping click-target and spy-threshold
 * the same number is what makes a click's resulting highlight match the
 * section it just scrolled to, instead of the spy immediately overriding
 * it with its neighbor. */
const SETTINGS_SCROLL_SPY_OFFSET = 16;

export function SettingsView({ storagePersistence, onExportVault, onRequestResetVault, onRestoreFromRemote }: SettingsViewProps) {
  const [activeCategory, setActiveCategory] = useState("appearance");
  const [query, setQuery] = useState("");

  const [navRailNarrow, setNavRailNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(SETTINGS_NAV_RAIL_BREAKPOINT).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(SETTINGS_NAV_RAIL_BREAKPOINT);
    const onChange = () => setNavRailNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

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

  // Every category renders its section continuously now (search narrows
  // each section's ROWS, and drops a section entirely once none of its
  // rows match — it never picks a single "active" category to show).
  const sections = categories
    .map((c) => ({ category: c, rows: searching ? c.rows.filter((r) => rowMatches(r, trimmedQuery)) : c.rows }))
    .filter(({ rows }) => rows.length > 0);
  const sectionIds = sections.map((s) => s.category.id);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const setSectionRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) sectionRefs.current.set(id, el);
      else sectionRefs.current.delete(id);
    },
    [],
  );

  // Scroll-spy: keeps `activeCategory` (and therefore `Tabs`' `aria-
  // selected`) synced to whichever section's heading has scrolled up to
  // `SETTINGS_SCROLL_SPY_OFFSET` from the scrollport's top — on ANY
  // scroll, not only a click-driven one. Re-subscribes when the set of
  // rendered sections changes (a search narrowing which sections exist).
  const sectionIdsKey = sectionIds.join(",");
  useEffect(() => {
    const container = scrollAreaRef.current;
    if (!container) return;
    let raf = 0;
    const computeCurrent = () => {
      // Scrolled to (or within a hair of) the bottom: the last section
      // wins outright, even if it's short enough that its OWN heading
      // never reaches SETTINGS_SCROLL_SPY_OFFSET (a section shorter than
      // one screenful can't be scrolled any further once it's the last
      // one) — otherwise the final category could never highlight.
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      if (atBottom && sectionIds.length > 0) return sectionIds[sectionIds.length - 1];

      const containerTop = container.getBoundingClientRect().top;
      let current: string | undefined;
      for (const id of sectionIds) {
        const el = sectionRefs.current.get(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - containerTop;
        if (top <= SETTINGS_SCROLL_SPY_OFFSET + 1) current = id;
        else break; // sections are in DOM/visual top-to-bottom order
      }
      return current ?? sectionIds[0];
    };
    const update = () => {
      raf = 0;
      const current = computeCurrent();
      setActiveCategory((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIdsKey]);

  // Click (or Enter/Space, since `activationMode="manual"` keeps arrow-key
  // roving focus from also triggering a scroll) target: smooth-scrolls the
  // category's section heading to the same offset the spy above watches.
  // A category filtered out of the current search has no mounted section
  // to scroll to — a no-op rather than an error.
  const scrollToCategory = useCallback((id: string) => {
    const container = scrollAreaRef.current;
    const section = sectionRefs.current.get(id);
    if (!container || !section) return;
    const delta = section.getBoundingClientRect().top - container.getBoundingClientRect().top - SETTINGS_SCROLL_SPY_OFFSET;
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }, []);

  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="flex-1"
      style={{ minHeight: 0, background: "var(--app-editor-bg)" }}
      data-testid="settings-view"
    >
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              width: "var(--settings-side-column-width)",
              maxWidth: "100%",
              flexShrink: 0,
            }}
          >
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

        {/* R4 defect B (owner correction) — content column on the left,
            sticky vertical category rail on the right; `.settings-layout` /
            `.settings-nav-rail` in index.css own the responsive reflow
            (right-side column above ~900px, a wrapping top row below it). */}
        <div className="settings-layout">
          <div className="settings-content">
            <div style={{ width: "100%", maxWidth: "52rem", display: "flex", flexDirection: "column", gap: 22 }}>
              {sections.map(({ category, rows }, groupIndex) => (
                <div key={category.id} ref={setSectionRef(category.id)} data-testid={`settings-group-${category.id}`}>
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
              ))}
              {searching && sections.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--color-muted)" }}>No settings match "{trimmedQuery}".</p>
              )}
            </div>
          </div>

          <nav className="settings-nav-rail" aria-label="Settings categories">
            <Tabs
              value={activeCategory}
              onValueChange={scrollToCategory}
              variant="pills"
              orientation={navRailNarrow ? "horizontal" : "vertical"}
              activationMode="manual"
            >
              <TabsList>
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
          </nav>
        </div>
      </div>
    </ScrollArea>
  );
}

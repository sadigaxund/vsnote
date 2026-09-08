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
 * **Title row shares the body's column grid (DESIGN-SPEC item 129, R7).**
 * The title row used to be a plain `space-between` flex row spanning the
 * view's full padded width, so "Settings" sat flush at the padding edge
 * while the reading column below it — centered within the leftover space
 * after the nav rail — only happened to share that edge when the column
 * was too narrow to hit its 52rem cap. Above that width the two edges
 * drifted apart. The title row now mirrors `.settings-layout`'s own
 * geometry: a `flex: 1 1 auto` left item (matching `.settings-content`)
 * holding a `width: 100%, maxWidth: 52rem` box the `<h1>` sits in — same
 * cap, same centering, same left edge as the reading column below,
 * whatever the viewport — plus a fixed `--settings-side-column-width`
 * (280px) right block for the search field, unchanged, which is what
 * already lined it up with the nav rail (item 119).
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
 * **Round 5 (design-health P1) — the rail is `SettingsNavRail`
 * (`components/local/SettingsNavRail.tsx`), not `my-you-eye`'s `Tabs`.**
 * The `Tabs`/`TabsList`/`TabsTrigger` (`pills` variant) version above
 * looked and read as a tab switcher — filled active pill,
 * `role="tablist"`/`role="tab"`, `aria-selected` — even though it never
 * behaved like one: every section is always mounted, a click just
 * smooth-scrolls to an already-rendered section, and "current" tracks
 * scroll position, not a click (the critique this round fixed named this
 * exactly: "rail semantics contradict its look: pills + aria-selected over
 * a continuous-scroll TOC"). The library has no vertical NavList/SideNav/
 * TOC primitive to reach for instead (checked
 * `skills/my-you-eye/components.json`: `Tabs` is the only navigation-group
 * component, and none of its three variants — `filing`/`pills`/`underline`
 * — is a plain, unfilled current-row look with a leading accent bar), so
 * per CLAUDE.md rule 2's missing-component protocol this is now a local
 * component: plain text rows (icon + label), `role="navigation"` on the
 * `<nav>`, one `role="list"` `<ul>` per group with a `Separator` between
 * groups (three groups, two dividers, no group labels — see
 * `navRailGroups` below), and `aria-current="true"` on the current row
 * instead of `aria-selected`. Filed upstream as
 * sadigaxund/my-you-eye#41; entry in `docs/COMPONENT-BACKLOG.md`.
 * `SettingsNavRail` keeps the same roving-tabindex up/down (vertical) /
 * left/right (horizontal) keyboard nav Radix's `Tabs.Root` gave the old
 * version for free, tracked via the same `matchMedia` listener at the
 * 900px breakpoint (`navRailNarrow` below) so orientation stays in sync
 * with `index.css`'s reflow. Every existing `data-testid="settings-nav-
 * <id>"` is unchanged.
 *
 * **The rail is a scroll-spy table of contents, not a switcher (owner
 * follow-up, unchanged this round).** Content is ALL categories' sections
 * stacked in one continuous scroll (search still filters rows per section,
 * hiding a section entirely when nothing in it matches) — there is no
 * "only the active category's rows are mounted" behavior. Clicking a rail
 * row (`onSelect` below) smooth-scrolls that section's heading to
 * `SETTINGS_SCROLL_SPY_OFFSET` below the scrollport's top without directly
 * setting `activeCategory` — `activeCategory` (and therefore the rail's
 * `aria-current`) is set ONLY by the scroll listener that watches every
 * section's position on ANY scroll (click-driven or manual), so a manual
 * scroll updates the current row exactly the way a click does. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input, ScrollArea, Separator } from "my-you-eye";
import { SettingsNavRail } from "./local/SettingsNavRail";
import { SettingsSectionErrorBoundary } from "./local/SettingsSectionErrorBoundary";
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
import { SETTINGS_FOCUS_SEARCH_EVENT, consumePendingSettingsSearchFocus } from "../lib/settingsTab";
import { modKey } from "../lib/platform";

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

  // Ctrl+, / Cmd+, (`App.tsx`'s global shortcut handler): opens this tab
  // and calls `requestSettingsSearchFocus()`. Handles both the "already
  // mounted, just focus" case (the event listener) and the "mounting for
  // the first time, the event already fired before we could listen" case
  // (the pending-flag check on mount) — see `lib/settingsTab.ts`'s doc.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (consumePendingSettingsSearchFocus()) searchInputRef.current?.focus();
    const onFocusRequest = () => searchInputRef.current?.focus();
    window.addEventListener(SETTINGS_FOCUS_SEARCH_EVENT, onFocusRequest);
    return () => window.removeEventListener(SETTINGS_FOCUS_SEARCH_EVENT, onFocusRequest);
  }, []);

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
    {
      id: "storage",
      label: "Storage",
      icon: <HardDrive size={15} />,
      rows: useStorageRows({ persistence, onExportVault, onRequestResetVault, onRestoreFromRemote }),
    },
    { id: "packs", label: "Packs", icon: <Package size={15} />, rows: usePacksRows() },
    { id: "keyboard", label: "Keyboard", icon: <KeyboardIcon size={15} />, rows: useKeyboardRows() },
  ];
  // DESIGN-SPEC item 119 (round 4) — the rail groups these 8 categories
  // into three clusters with two thin, unlabeled dividers: Appearance /
  // Editor / Rendered view (look-and-feel of the editor), Git & Sync /
  // Sharing / Storage (the vault's data lifecycle), Packs / Keyboard
  // (extensibility + reference). `SettingsNavRail` renders one `<ul>` per
  // group with a `Separator` between groups — this array is that same
  // grouping, not a second source of truth for category order.
  const navRailGroups = [categories.slice(0, 3), categories.slice(3, 6), categories.slice(6, 8)];

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
            category tabs below stay sticky (R4 defect B).
            R7 item 129 — this row now shares `.settings-layout`'s exact
            column geometry (flex:1 1 auto content area, 28px gap, a
            280px-wide right block) instead of a plain `space-between` row,
            so the title's box and the reading column's `52rem` box are two
            IDENTICAL-width `flex:1 1 auto` items centered the same way —
            their left edges coincide at any viewport width, not just the
            ones narrow enough that the reading column never hits its cap.
            The search block keeps the same fixed 280px
            (`--settings-side-column-width`) it always had, which is also
            the nav rail's width, so this row's right block lines up with
            the rail below it too. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            columnGap: 28,
            rowGap: 8,
            marginBottom: 20,
          }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: "52rem" }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: 0 }}>Settings</h1>
            </div>
          </div>
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
                ref={searchInputRef}
                size="sm"
                placeholder={`Search settings (${modKey()}+,)`}
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
            <div style={{ width: "100%", maxWidth: "52rem", display: "flex", flexDirection: "column", gap: "var(--settings-section-gap)" }}>
              {sections.map(({ category, rows }, groupIndex) => (
                <div key={category.id} ref={setSectionRef(category.id)} data-testid={`settings-group-${category.id}`}>
                  {groupIndex > 0 && <Separator style={{ marginBottom: "var(--settings-section-gap)" }} />}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--settings-control-gap)",
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
                  <SettingsSectionErrorBoundary sectionLabel={category.label}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-row-gap)" }}>
                      {rows.map((row) => (
                        <div key={row.id} data-testid={`settings-row-${row.id}`}>
                          {row.content}
                        </div>
                      ))}
                    </div>
                  </SettingsSectionErrorBoundary>
                </div>
              ))}
              {searching && sections.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--color-muted)" }}>No settings match "{trimmedQuery}".</p>
              )}
            </div>
          </div>

          <SettingsNavRail
            groups={navRailGroups}
            activeId={activeCategory}
            onSelect={scrollToCategory}
            orientation={navRailNarrow ? "horizontal" : "vertical"}
            aria-label="Settings categories"
          />
        </div>
      </div>
    </ScrollArea>
  );
}

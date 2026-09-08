/**
 * The Markii extension page (R5-9, "Markii as an extension" — owner
 * decision: Markii's settings used to be scattered across Settings' old
 * "Packs" category plus a couple of Rendered-view rows; they now live
 * here, an editor-area VIEW opened as a tab exactly like `SettingsView`/
 * `SharedView` — see `lib/extensionTab.ts`'s doc for the tab plumbing).
 *
 * **Shell reused, not reinvented.** Same "content column + right rail"
 * shell `SettingsView.tsx` uses: `.settings-layout`/`.settings-content`/
 * `.settings-nav-rail` (already in `index.css`, applied here rather than
 * duplicated — this file never edits that CSS), `SettingsRow`/
 * `SettingsSection` (`local/SettingsRow.tsx`) for every row, and
 * `SettingsNavRail` (`local/SettingsNavRail.tsx`) as the scroll-spy TOC —
 * five sections instead of Settings' eight categories, otherwise the exact
 * same click-to-scroll / scroll-to-highlight mechanics, copied rather than
 * abstracted into a shared hook: `SettingsView.tsx` is owned by another
 * worker this round, and the two view's search/scroll-spy bookkeeping is
 * small enough that a premature shared abstraction would cost more than it
 * saves. If a second extension ever needs this exact shell, THAT'S the
 * moment to lift it into `local/`.
 *
 * **Row naming.** Where an equivalent setting exists upstream
 * (markii-org/markii-obsidian's `src/settings-tab.ts`, fetched via `gh api`
 * for R5-9), this page uses that file's exact wording — "Hide script
 * blocks", "Turn off script execution on this device" among them (renamed
 * only where VSNote's own vocabulary differs, e.g. "Render components in
 * the Preview pane" for their "Render components in Reading view" —
 * VSNote's rendered surface is the Preview pane). "Directive rendering"
 * (Rendering) has no upstream analogue — new here. R5-9's "Run scripts when
 * a note opens" (also straight from upstream) and "Default for automatic
 * runs" ("Per-tier defaults," new here) were REMOVED in R5-9b — see below.
 *
 * **What's real vs. state-only (R5-9b).** Every row this page renders now
 * has a real consumer — see `useMarkiiExtensionSettingsStore.ts`'s module
 * doc for the authoritative, per-row list of what reads what; this file
 * just renders whatever that store holds. The master `Enabled` switch
 * (Extensions panel row), Directive rendering, Completion, "Turn off script
 * execution on this device", Hide script blocks, Render components in
 * Preview, Fence sugar, and Reveal hint are all wired into
 * `LivePreviewEditor.tsx`/`MarkdownPreviewPane.tsx`/`useMarkiiStore.runNote`.
 * "Run scripts when a note opens" and "Default for automatic runs" are GONE
 * from this page (not merely hidden) — both were the auto/scheduled script
 * trigger this repo already rejected once as a dead toggle; see
 * `docs/ARCHITECTURE.md`'s Known limitations "No auto or scheduled script
 * trigger" entry.
 *
 * **Component packs moves in verbatim** (`extensions/Packs.tsx`, moved
 * from `components/settings/Packs.tsx` this round — see that file's own
 * doc) as this page's fifth section, unchanged rows/testids.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, ScrollArea, Separator, Switch } from "my-you-eye";
import { BookOpen, Bug, RefreshCw, Search as SearchIcon, ShieldCheck } from "lucide-react";
import { SettingsRow } from "./local/SettingsRow";
import { SettingsNavRail, type SettingsNavRailItem } from "./local/SettingsNavRail";
import { SettingsSectionErrorBoundary } from "./local/SettingsSectionErrorBoundary";
import { useToast } from "./local/useToast";
import { usePacksRows } from "./extensions/Packs";
import { rowMatches, type SettingRow } from "./settings/types";
import { useMarkiiExtensionSettingsStore } from "../stores/useMarkiiExtensionSettingsStore";
import { useMarkiiStore } from "../stores/useMarkiiStore";
import { MARKII_CORE_VERSION, MARKII_DOCS_URL, MARKII_ISSUES_URL, MARKII_PROJECT_URL } from "../lib/markiiVersion";

/** Same offset SettingsView's scroll-spy uses — see that file's doc for why
 * click-target and spy-threshold must share one number. */
const EXTENSION_SCROLL_SPY_OFFSET = 16;

function useAboutRows(): SettingRow[] {
  return [
    {
      // No "Version" row: the page header already reads
      // `v0.13.0 · markii-org`, and repeating it as a setting row makes a
      // static fact look like something the reader can act on.
      id: "markii-about-project",
      label: "Project",
      keywords: "markii github repo upstream markii-org version core",
      content: (
        <SettingsRow label="Project" hint="markii-org/markii on GitHub." controlWidth="narrow">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.open(MARKII_PROJECT_URL, "_blank", "noopener,noreferrer")}
          >
            markii-org/markii
          </Button>
        </SettingsRow>
      ),
    },
  ];
}

function useRenderingRows(): SettingRow[] {
  const directiveRenderingEnabled = useMarkiiExtensionSettingsStore((s) => s.directiveRenderingEnabled);
  const setDirectiveRenderingEnabled = useMarkiiExtensionSettingsStore((s) => s.setDirectiveRenderingEnabled);
  const hideScriptBlocks = useMarkiiExtensionSettingsStore((s) => s.hideScriptBlocks);
  const setHideScriptBlocks = useMarkiiExtensionSettingsStore((s) => s.setHideScriptBlocks);
  const renderComponentsInPreview = useMarkiiExtensionSettingsStore((s) => s.renderComponentsInPreview);
  const setRenderComponentsInPreview = useMarkiiExtensionSettingsStore((s) => s.setRenderComponentsInPreview);

  return [
    {
      id: "markii-directive-rendering",
      label: "Directive rendering",
      keywords: "markii directive live preview decorations render",
      content: (
        <SettingsRow label="Directive rendering" hint="Renders directives inline while you edit a .mk.md note's live preview." controlWidth="narrow">
          <Switch checked={directiveRenderingEnabled} onCheckedChange={setDirectiveRenderingEnabled} aria-label="Directive rendering" data-testid="markii-directive-rendering" />
        </SettingsRow>
      ),
    },
    {
      id: "markii-hide-script-blocks",
      label: "Hide script blocks",
      keywords: "markii script fence hide preview output",
      content: (
        <SettingsRow label="Hide script blocks" hint="Leaves script markers out of the preview. Failures still show on the values they feed." controlWidth="narrow">
          <Switch checked={hideScriptBlocks} onCheckedChange={setHideScriptBlocks} aria-label="Hide script blocks" data-testid="markii-hide-script-blocks" />
        </SettingsRow>
      ),
    },
    {
      id: "markii-render-components-preview",
      label: "Render components in the Preview pane",
      keywords: "markii component preview pane render inline",
      content: (
        <SettingsRow label="Render components in the Preview pane" hint="Shows a .mk.md note's components inline in the Preview pane." controlWidth="narrow">
          <Switch checked={renderComponentsInPreview} onCheckedChange={setRenderComponentsInPreview} aria-label="Render components in the Preview pane" data-testid="markii-render-components-preview" />
        </SettingsRow>
      ),
    },
  ];
}

function useEditorSectionRows(): SettingRow[] {
  const completionEnabled = useMarkiiExtensionSettingsStore((s) => s.completionEnabled);
  const setCompletionEnabled = useMarkiiExtensionSettingsStore((s) => s.setCompletionEnabled);
  const fenceSugarEnabled = useMarkiiExtensionSettingsStore((s) => s.fenceSugarEnabled);
  const setFenceSugarEnabled = useMarkiiExtensionSettingsStore((s) => s.setFenceSugarEnabled);
  const revealHintEnabled = useMarkiiExtensionSettingsStore((s) => s.revealHintEnabled);
  const setRevealHintEnabled = useMarkiiExtensionSettingsStore((s) => s.setRevealHintEnabled);

  return [
    {
      id: "markii-completion",
      label: "Completion",
      keywords: "markii completion autocomplete directive attribute",
      content: (
        <SettingsRow label="Completion" hint="Directive name/attribute completion while typing in a .mk.md note." controlWidth="narrow">
          <Switch checked={completionEnabled} onCheckedChange={setCompletionEnabled} aria-label="Completion" data-testid="markii-completion" />
        </SettingsRow>
      ),
    },
    {
      id: "markii-fence-sugar",
      label: "Fence sugar",
      keywords: "markii fence sugar container shorthand syntax",
      content: (
        <SettingsRow label="Fence sugar" hint="Shorthand container-fence syntax for directives." controlWidth="narrow">
          <Switch checked={fenceSugarEnabled} onCheckedChange={setFenceSugarEnabled} aria-label="Fence sugar" data-testid="markii-fence-sugar" />
        </SettingsRow>
      ),
    },
    {
      id: "markii-reveal-hint",
      label: "Reveal hint",
      keywords: "markii reveal hint raw syntax cursor",
      content: (
        <SettingsRow label="Reveal hint" hint="Shows a small hint to reveal a directive's raw syntax under the cursor." controlWidth="narrow">
          <Switch checked={revealHintEnabled} onCheckedChange={setRevealHintEnabled} aria-label="Reveal hint" data-testid="markii-reveal-hint" />
        </SettingsRow>
      ),
    },
  ];
}

/**
 * R5-9b — this section used to also carry "Run scripts when a note opens"
 * and "Default for automatic runs" rows. Both persisted state with no
 * reader (R5-9's own module doc, before this round, said so plainly), and
 * both are the auto/scheduled script trigger this repo already rejected
 * once as a dead toggle (`useMarkiiStore.ts`'s "No `auto`/`scheduled`
 * trigger exists yet" note; `docs/ARCHITECTURE.md`'s Known limitations "No
 * auto or scheduled script trigger"). Removed rather than left dead —
 * building a scheduler was out of scope for this round. See
 * `useMarkiiExtensionSettingsStore.ts`'s module doc for the full record.
 */
function useScriptingRows(onManageGrants: () => void): SettingRow[] {
  const scriptsDisabledOnDevice = useMarkiiExtensionSettingsStore((s) => s.scriptsDisabledOnDevice);
  const setScriptsDisabledOnDevice = useMarkiiExtensionSettingsStore((s) => s.setScriptsDisabledOnDevice);

  return [
    {
      id: "markii-scripts-disabled-device",
      label: "Turn off script execution on this device",
      keywords: "markii script disable device local run execute",
      content: (
        <SettingsRow label="Turn off script execution on this device" hint="No note runs its scripts. Your grants are left as they are." controlWidth="narrow">
          <Switch checked={scriptsDisabledOnDevice} onCheckedChange={setScriptsDisabledOnDevice} aria-label="Turn off script execution on this device" data-testid="markii-scripts-disabled-device" />
        </SettingsRow>
      ),
    },
    {
      id: "markii-manage-grants",
      label: "Script permissions",
      keywords: "markii grant permission manage revoke net bundle",
      content: (
        <SettingsRow label="Script permissions" hint="Every grant this vault has recorded, per note. Listed under Component packs below." controlWidth="text">
          <Button type="button" variant="ghost" size="sm" onClick={onManageGrants} data-testid="markii-manage-grants-link">
            <ShieldCheck size={13} aria-hidden />
            Manage grants
          </Button>
        </SettingsRow>
      ),
    },
  ];
}

export function ExtensionPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("about");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refreshPacks = useMarkiiStore((s) => s.refreshPacks);
  const refreshGrants = useMarkiiStore((s) => s.refreshGrants);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const setSectionRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) sectionRefs.current.set(id, el);
      else sectionRefs.current.delete(id);
    },
    [],
  );

  const scrollToSection = useCallback((id: string) => {
    const container = scrollAreaRef.current;
    const section = sectionRefs.current.get(id);
    if (!container || !section) return;
    const delta = section.getBoundingClientRect().top - container.getBoundingClientRect().top - EXTENSION_SCROLL_SPY_OFFSET;
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }, []);

  const packsRows = usePacksRows();
  const sectionDefs = [
    { id: "about", label: "About", rows: useAboutRows() },
    { id: "rendering", label: "Rendering", rows: useRenderingRows() },
    { id: "editor", label: "Editor", rows: useEditorSectionRows() },
    { id: "scripting", label: "Scripting", rows: useScriptingRows(() => scrollToSection("packs")) },
    { id: "packs", label: "Component packs", rows: packsRows },
  ];

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;
  const sections = sectionDefs
    .map((s) => ({ section: s, rows: searching ? s.rows.filter((r) => rowMatches(r, trimmedQuery)) : s.rows }))
    .filter(({ rows }) => rows.length > 0);
  const sectionIds = sections.map((s) => s.section.id);
  const sectionIdsKey = sectionIds.join(",");

  useEffect(() => {
    const container = scrollAreaRef.current;
    if (!container) return;
    let raf = 0;
    const computeCurrent = () => {
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      if (atBottom && sectionIds.length > 0) return sectionIds[sectionIds.length - 1];
      const containerTop = container.getBoundingClientRect().top;
      let current: string | undefined;
      for (const id of sectionIds) {
        const el = sectionRefs.current.get(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - containerTop;
        if (top <= EXTENSION_SCROLL_SPY_OFFSET + 1) current = id;
        else break;
      }
      return current ?? sectionIds[0];
    };
    const update = () => {
      raf = 0;
      const current = computeCurrent();
      setActiveSection((prev) => (prev === current ? prev : current));
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

  // `SettingsNavRailItem.icon` is generic (it's Settings' own TOC), but this
  // page's five sections read fine as plain text rows — `null` renders
  // nothing where Settings would put a category icon.
  const navItems: SettingsNavRailItem[] = useMemo(
    () => sectionDefs.map((s) => ({ id: s.id, label: s.label, icon: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleReload = () => {
    void Promise.all([refreshPacks(), refreshGrants()]).then(() => {
      toast({ title: "Markii reloaded", description: "Packs and script permissions were re-read from the vault." });
    });
  };

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }} data-testid="extension-page-markii">
      <div style={{ padding: "40px 40px 120px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", columnGap: 28, rowGap: 8, marginBottom: 20 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: "52rem" }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: 0 }}>Markii</h1>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "4px 0 0" }}>
                v{MARKII_CORE_VERSION} · markii-org
              </p>
              <p style={{ fontSize: 13, color: "var(--color-fg)", margin: "10px 0 0", maxWidth: "40rem" }}>
                Directives, live-preview decorations, component packs, and sandboxed note scripts for .mk.md files.
                Built in. This extension cannot be removed, only turned off.
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(MARKII_DOCS_URL, "_blank", "noopener,noreferrer")}
                  data-testid="markii-extension-docs"
                >
                  <BookOpen size={13} aria-hidden />
                  Docs
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(MARKII_ISSUES_URL, "_blank", "noopener,noreferrer")}
                  data-testid="markii-extension-report-issue"
                >
                  <Bug size={13} aria-hidden />
                  Report issue
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleReload} data-testid="markii-extension-reload">
                  <RefreshCw size={13} aria-hidden />
                  Reload
                </Button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "var(--settings-side-column-width)", maxWidth: "100%", flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <SearchIcon size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)", pointerEvents: "none" }} />
              <Input
                ref={searchInputRef}
                size="sm"
                placeholder="Search Markii settings"
                aria-label="Search Markii settings"
                data-testid="extension-page-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 30, width: "100%" }}
              />
            </div>
          </div>
        </div>

        <div className="settings-layout">
          <div className="settings-content">
            <div style={{ width: "100%", maxWidth: "52rem", display: "flex", flexDirection: "column", gap: "var(--settings-section-gap)" }}>
              {sections.map(({ section, rows }, groupIndex) => (
                <div key={section.id} ref={setSectionRef(section.id)} data-testid={`extension-group-${section.id}`}>
                  {groupIndex > 0 && <Separator style={{ marginBottom: "var(--settings-section-gap)" }} />}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-muted)",
                      marginBottom: 12,
                    }}
                  >
                    {section.label}
                  </div>
                  {section.id === "scripting" && (
                    <p style={{ fontSize: 11, color: "var(--color-muted)", margin: "-4px 0 12px" }}>Stored on this device only. Never synced, never shared.</p>
                  )}
                  <SettingsSectionErrorBoundary sectionLabel={section.label}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-row-gap)" }}>
                      {rows.map((row) => (
                        <div key={row.id} data-testid={`extension-row-${row.id}`}>
                          {row.content}
                        </div>
                      ))}
                    </div>
                  </SettingsSectionErrorBoundary>
                </div>
              ))}
              {searching && sections.length === 0 && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>No settings match "{trimmedQuery}".</p>}
            </div>
          </div>

          <SettingsNavRail groups={[navItems]} activeId={activeSection} onSelect={scrollToSection} orientation="vertical" aria-label="Markii extension sections" />
        </div>
      </div>
    </ScrollArea>
  );
}

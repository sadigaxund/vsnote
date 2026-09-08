/**
 * Extensions activity view (R5-9, "Markii as an extension" — owner
 * decision: Markii's settings used to be scattered across a Settings >
 * Packs category and a couple of Rendered-view rows; they now live behind
 * this rail icon instead, the same way a real editor's extensions list
 * works).
 *
 * Was a documented stub before this round (see git history/DESIGN-SPEC
 * Amendments round 3 item 20 and the removed "No extension marketplace is
 * planned" copy this file used to carry) — that was true when nothing here
 * used the extension concept for anything real. It's false now: Markii is
 * a real, built-in extension, so the stub copy became misleading and is
 * replaced (see this round's `docs/ARCHITECTURE.md`/`docs/DESIGN-SPEC.md`
 * edits for the matching non-goal-line corrections).
 *
 * One row today (Markii, built in, cannot be removed) — the row shape
 * (icon, name, one-line description, version, an `Enabled` `Switch`) is
 * generic on purpose: `docs/ARCHITECTURE.md`'s new "extension model"
 * section sketches what a second, non-built-in entry would need. Clicking
 * anywhere on a row except the `Switch` opens that extension's page as an
 * editor-area tab (`lib/extensionTab.ts`, the same "virtual tab" plumbing
 * `SETTINGS_TAB_PATH`/`SHARED_TAB_PATH` already use) — the `Switch` itself
 * is a small hit target inside the row and stops the click from bubbling
 * into that row-open handler, same pattern as any list row with an inline
 * action control (e.g. `SourceControlPanel.tsx`'s file rows have no inline
 * control, but `SettingsView`'s Packs rows already do this same "row click
 * vs. inner button click" split for pack enable/disable).
 *
 * Renders inside the shared `local/SidebarContainer` region shell, same as
 * every other activity view, so the region's width/collapse state stays
 * consistent even here.
 */
import { Badge, Switch } from "my-you-eye";
import { Blocks } from "lucide-react";
import { SidebarContainer } from "./local/SidebarContainer";
import { useMarkiiExtensionSettingsStore } from "../stores/useMarkiiExtensionSettingsStore";
import { MARKII_CORE_VERSION } from "../lib/markiiVersion";

export interface ExtensionsPanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Opens the Markii extension page tab — `App.tsx`'s `handleOpenExtension`. */
  onOpenExtension: () => void;
}

export function ExtensionsPanel({ width, onWidthChange, collapsed, onCollapsedChange, onOpenExtension }: ExtensionsPanelProps) {
  const enabled = useMarkiiExtensionSettingsStore((s) => s.enabled);
  const setEnabled = useMarkiiExtensionSettingsStore((s) => s.setEnabled);

  return (
    <SidebarContainer
      testId="extensions-panel"
      label="EXTENSIONS"
      width={width}
      onWidthChange={onWidthChange}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: "8px 0" }}>
        <li>
          <div
            role="button"
            tabIndex={0}
            data-testid="extension-row-markii"
            onClick={onOpenExtension}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenExtension();
              }
            }}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              width: "100%",
              padding: "10px 14px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--sidebar-item-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Blocks size={16} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>Markii</span>
                <Badge variant="neutral" tone="soft" style={{ fontSize: 10 }}>
                  v{MARKII_CORE_VERSION}
                </Badge>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Directives, component packs, and note scripts for .mk.md files.
              </p>
            </div>
            <span
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              style={{ flexShrink: 0, paddingTop: 2 }}
            >
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Markii enabled"
                data-testid="extension-markii-enabled"
              />
            </span>
          </div>
        </li>
      </ul>
    </SidebarContainer>
  );
}

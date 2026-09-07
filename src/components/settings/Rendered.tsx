/**
 * Settings -> Rendered view category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4).
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "my-you-eye";
import { SettingsRow } from "../local/SettingsRow";
import { RENDERED_CONTENT_WIDTH_FULL, useSettingsStore } from "../../stores/useSettingsStore";
import { defaultModeFor } from "../../filetypes/registry";
import type { EditorMode, FileKind } from "../../types";
import type { SettingRow } from "./types";

/** File kinds whose registry entry offers both Rendered and Source — the
 * only ones a "default view mode" choice is meaningful for (a code file has
 * no Rendered mode to default *to*). */
const DEFAULT_MODE_KINDS: { kind: FileKind; label: string }[] = [
  { kind: "md", label: "Markdown" },
  { kind: "json", label: "JSON" },
  { kind: "html", label: "HTML" },
  { kind: "csv", label: "CSV" },
];

export function useRenderedRows(): SettingRow[] {
  const renderedContentWidth = useSettingsStore((s) => s.renderedContentWidth);
  const setRenderedContentWidth = useSettingsStore((s) => s.setRenderedContentWidth);
  const renderedMargin = useSettingsStore((s) => s.renderedMargin);
  const setRenderedMargin = useSettingsStore((s) => s.setRenderedMargin);
  const renderedLineSpacing = useSettingsStore((s) => s.renderedLineSpacing);
  const setRenderedLineSpacing = useSettingsStore((s) => s.setRenderedLineSpacing);
  const readingViewDefaultMode = useSettingsStore((s) => s.readingViewDefaultMode);
  const setReadingViewDefaultMode = useSettingsStore((s) => s.setReadingViewDefaultMode);

  return [
    {
      id: "content-width",
      label: "Content max-width",
      keywords: "column measure reading width ch rendered markdown full",
      content: (
        <SettingsRow label="Content max-width" hint="The rendered markdown reading column width." controlWidth="text">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>
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
        </SettingsRow>
      ),
    },
    {
      id: "margins",
      label: "Left/right margins",
      keywords: "padding margin rendered content gutter",
      content: (
        <SettingsRow label="Left/right margins" hint="Space outside the reading column, in pixels." controlWidth="text">
          <Slider min={16} max={96} step={4} value={renderedMargin} showValue onChange={(e) => setRenderedMargin(Number(e.target.value))} aria-label="Rendered left/right margins" />
        </SettingsRow>
      ),
    },
    {
      id: "rendered-line-spacing",
      label: "Line spacing",
      keywords: "line height rendered markdown prose",
      content: (
        <SettingsRow label="Line spacing" controlWidth="text">
          <Slider min={1.4} max={2.4} step={0.1} value={renderedLineSpacing} showValue onChange={(e) => setRenderedLineSpacing(Number(e.target.value))} aria-label="Rendered line spacing" />
        </SettingsRow>
      ),
    },
    {
      id: "default-view-mode",
      label: "Default view mode",
      // DESIGN-SPEC Amendments item 11: "name it 'Default view mode', never
      // just 'mode'" — this is the exact row that confused the user in the
      // old dialog; every sub-row below spells out "Default view when
      // opening <Kind>:" per the spec's own example.
      keywords: "mode default markdown json html csv rendered source view open",
      content: (
        <SettingsRow label="Default view mode" hint="Rendered or Source, per file type." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {DEFAULT_MODE_KINDS.map(({ kind, label }) => {
              const value = readingViewDefaultMode[kind] ?? defaultModeFor(kind);
              return (
                <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span className="settings-hint" style={{ color: "var(--color-fg)" }}>Default view when opening {label}:</span>
                  <Select value={value} onValueChange={(v) => setReadingViewDefaultMode(kind, v as EditorMode)}>
                    <SelectTrigger size="sm" style={{ width: "12rem" }}>
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
        </SettingsRow>
      ),
    },
  ];
}

/**
 * Settings -> Editor category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4).
 */
import { RadioGroup, RadioGroupItem, Slider, Switch } from "my-you-eye";
import { SettingsRow } from "../local/SettingsRow";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { SettingRow } from "./types";

const TAB_SIZES = [2, 4, 8] as const;

export function useEditorRows(): SettingRow[] {
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const setTabSize = useSettingsStore((s) => s.setTabSize);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const editorLineSpacing = useSettingsStore((s) => s.editorLineSpacing);
  const setEditorLineSpacing = useSettingsStore((s) => s.setEditorLineSpacing);

  return [
    {
      id: "font-size",
      label: "Font size",
      keywords: "editor text size source rendered",
      content: (
        <SettingsRow label="Font size" hint="Applies to Source and Rendered views." controlWidth="narrow">
          <Slider min={11} max={20} step={1} value={editorFontSize} showValue onChange={(e) => setEditorFontSize(Number(e.target.value))} aria-label="Editor font size" />
        </SettingsRow>
      ),
    },
    {
      id: "tab-size",
      label: "Tab size",
      keywords: "indent spaces tabs",
      content: (
        <SettingsRow label="Tab size" controlWidth="text">
          <RadioGroup value={String(tabSize)} onValueChange={(v) => setTabSize(Number(v))} style={{ display: "flex", gap: "var(--settings-control-gap-lg)" }} aria-label="Tab size">
            {TAB_SIZES.map((n) => (
              <label key={n} style={{ display: "flex", alignItems: "center", gap: "var(--settings-control-gap)", fontSize: 13, cursor: "pointer" }}>
                <RadioGroupItem value={String(n)} />
                {n} spaces
              </label>
            ))}
          </RadioGroup>
        </SettingsRow>
      ),
    },
    {
      id: "word-wrap",
      label: "Word wrap",
      keywords: "wrap long lines source diff",
      content: (
        <SettingsRow label="Word wrap" hint="Source and Diff modes only." controlWidth="text">
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <Switch checked={wordWrap} onCheckedChange={setWordWrap} aria-label="Word wrap" />
            <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Wrap long lines</span>
          </label>
        </SettingsRow>
      ),
    },
    {
      id: "editor-line-spacing",
      label: "Line spacing",
      keywords: "line height editor source diff",
      content: (
        <SettingsRow label="Line spacing" hint="Source and Diff modes." controlWidth="narrow">
          <Slider min={1.2} max={2.2} step={0.1} value={editorLineSpacing} showValue onChange={(e) => setEditorLineSpacing(Number(e.target.value))} aria-label="Editor line spacing" />
        </SettingsRow>
      ),
    },
  ];
}

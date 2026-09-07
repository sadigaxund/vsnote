/**
 * Settings -> Appearance category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4). Returns
 * the row list the shell (`SettingsView.tsx`) both renders and searches —
 * same `SettingRow[]` shape the shell has always used, just built here
 * instead of inline.
 */
import {
  ColorField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "my-you-eye";
import { SettingsRow } from "../local/SettingsRow";
import { THEME_OPTIONS, useSettingsStore, type AppTheme, type UiDensity } from "../../stores/useSettingsStore";
import type { SettingRow } from "./types";

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

/** Quick-pick swatches for the accent `ColorField` (my-you-eye 2026.8.3).
 * Just the VSNote default teal for now — `useSettingsStore`'s `accent`
 * initial value — until COMPONENT-BACKLOG.md §2.3's named-preset-tokens
 * follow-up lands. */
const ACCENT_PRESETS = ["#27d2c5"];

export function useAppearanceRows(): SettingRow[] {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const uiDensity = useSettingsStore((s) => s.uiDensity);
  const setUiDensity = useSettingsStore((s) => s.setUiDensity);

  return [
    {
      id: "theme",
      label: "Theme",
      keywords: "appearance color scheme dark light palette",
      content: (
        <SettingsRow label="Theme" controlWidth="narrow">
          <Select value={theme} onValueChange={(v) => setTheme(v as AppTheme)}>
            <SelectTrigger size="sm" style={{ width: "100%" }} data-testid="settings-theme">
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
        </SettingsRow>
      ),
    },
    {
      id: "accent",
      label: "Accent color",
      keywords: "color accent teal primary swatch",
      content: (
        <SettingsRow label="Accent color" controlWidth="narrow">
          <ColorField label="Accent color" value={accent} onChange={setAccent} presets={ACCENT_PRESETS} />
        </SettingsRow>
      ),
    },
    {
      id: "density",
      label: "UI density",
      keywords: "compact default comfortable spacing density layout tree rows tabs chrome bands",
      content: (
        <SettingsRow label="UI density" hint="Scales chrome height, row/tab padding, and icon spacing." controlWidth="text">
          <RadioGroup value={uiDensity} onValueChange={(v) => setUiDensity(v as UiDensity)} style={{ display: "flex", gap: "var(--settings-control-gap-lg)" }} aria-label="UI density">
            {(
              [
                { value: "compact", label: "Compact" },
                { value: "default", label: "Default" },
                { value: "comfortable", label: "Comfortable" },
              ] as const
            ).map((d) => (
              <label key={d.value} style={{ display: "flex", alignItems: "center", gap: "var(--settings-control-gap)", fontSize: 13, cursor: "pointer" }}>
                <RadioGroupItem value={d.value} />
                {d.label}
              </label>
            ))}
          </RadioGroup>
        </SettingsRow>
      ),
    },
  ];
}

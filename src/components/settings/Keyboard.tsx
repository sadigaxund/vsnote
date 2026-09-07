/**
 * Settings -> Keyboard category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4).
 */
import { Kbd } from "my-you-eye";
import { SettingsRow } from "../local/SettingsRow";
import type { SettingRow } from "./types";

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "⌘K", description: "Command palette: file jump and commands" },
  { keys: "⌘,", description: "Open Settings, focused on search" },
  { keys: "⌘P", description: "Go to file" },
  { keys: "⌘S", description: "Save the active buffer" },
  { keys: "⌘F", description: "Find in the current view" },
  { keys: "⌘E", description: "Toggle Rendered / Source" },
  { keys: "⌘W", description: "Close the active tab (best-effort)" },
  { keys: "⌘⇧W", description: "Close the active tab (fallback for ⌘W)" },
  { keys: "⌘⇧Z", description: "Toggle zen mode (content-area fullscreen)" },
  { keys: "Esc", description: "Exit zen mode, or close the palette / find widget / dialogs" },
];

export function useKeyboardRows(): SettingRow[] {
  return [
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      keywords: "kbd shortcuts hotkeys palette save search close zen esc settings comma",
      content: (
        <SettingsRow label="Keyboard shortcuts" controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} style={{ display: "flex", alignItems: "center", gap: "var(--settings-control-gap-lg)" }}>
                <Kbd style={{ minWidth: 56, textAlign: "center" }}>{s.keys}</Kbd>
                <span className="settings-hint" style={{ color: "var(--color-muted)" }}>{s.description}</span>
              </div>
            ))}
          </div>
        </SettingsRow>
      ),
    },
  ];
}

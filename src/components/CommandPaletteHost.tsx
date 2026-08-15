/**
 * Command palette (⌘K) + file jump (⌘P) — DESIGN-SPEC "Misc / settings":
 * "Command palette (⌘K): file jump + commands (toggle mode, theme, sync,
 * new file…), grouped results." Pure composition over the library's
 * `CommandPalette` (already supports grouped results + per-action
 * `shortcut`/`icon` — see `CommandPaletteProps.groups`) and the local
 * `FileIcon`; no new local primitive needed.
 *
 * One instance serves both bindings via `mode`:
 *  - `"files"` (⌘P) — every open-able file, no groups, "Go to file…".
 *  - `"commands"` (⌘K) — the same file list PLUS a "Commands" group, per
 *    DESIGN-SPEC's grouped-results requirement.
 *
 * `React.lazy`-loaded from `App.tsx` (only imported once ⌘K/⌘P is pressed
 * for the first time) per IMPLEMENTATION-PLAN.md Phase 5's bundle-
 * discipline note — the file list/command list themselves are built in
 * `App.tsx` (plain data, no heavy imports) so opening the palette the
 * first time only pays for this file's `CommandPalette`/`FileIcon` import,
 * not a second copy of the app's file tree logic.
 */
import { CommandPalette, type CommandAction } from "my-you-eye";
import { FileIcon } from "./local/FileIcon";
import type { FileNode } from "../types";

export interface CommandPaletteHostProps {
  mode: "files" | "commands";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileNode[];
  commands: { id: string; label: string; shortcut?: string; icon?: React.ReactNode }[];
  onSelectFile: (path: string) => void;
  onSelectCommand: (id: string) => void;
}

export function CommandPaletteHost({
  mode,
  open,
  onOpenChange,
  files,
  commands,
  onSelectFile,
  onSelectCommand,
}: CommandPaletteHostProps) {
  const fileActions: CommandAction[] = files.map((f) => ({
    id: `file:${f.path}`,
    label: f.name,
    keywords: [f.path],
    icon: <FileIcon kind={f.kind} name={f.name} size={14} />,
  }));

  const commandActions: CommandAction[] = commands.map((c) => ({
    id: `cmd:${c.id}`,
    label: c.label,
    shortcut: c.shortcut,
    icon: c.icon,
  }));

  const actions = mode === "files" ? fileActions : [...fileActions, ...commandActions];
  const groups =
    mode === "files"
      ? undefined
      : [
          { label: "Files", actionIds: fileActions.map((a) => a.id) },
          { label: "Commands", actionIds: commandActions.map((a) => a.id) },
        ];

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      groups={groups}
      placeholder={mode === "files" ? "Go to file…" : "Type a command or search files…"}
      emptyText={mode === "files" ? "No matching files" : "No matching files or commands"}
      onSelect={(action) => {
        if (action.id.startsWith("file:")) onSelectFile(action.id.slice("file:".length));
        else onSelectCommand(action.id.slice("cmd:".length));
      }}
    />
  );
}

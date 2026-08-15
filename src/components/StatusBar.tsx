/**
 * App status bar: branch/sync/diff (left), cursor/encoding/lang/bell
 * (right). Composition over `local/StatusBar` + `local/DiffStatChip`.
 */
import { Bell, Cloud, GitBranch } from "lucide-react";
import { DiffStatChip } from "./local/DiffStatChip";
import { StatusBar as StatusBarShell, StatusBarItem } from "./local/StatusBar";
import type { CursorPosition, GitSummary } from "../types";

export interface AppStatusBarProps {
  git: GitSummary;
  cursor: CursorPosition;
  encoding: string;
  eol: string;
  language: string;
  onSync?: () => void;
}

export function AppStatusBar({ git, cursor, encoding, eol, language, onSync }: AppStatusBarProps) {
  return (
    <StatusBarShell
      left={
        <>
          <StatusBarItem
            icon={<GitBranch size={12} />}
            label={git.branch}
            tooltip={`On branch ${git.branch}`}
            tone="primary"
          />
          <StatusBarItem
            label={`↑${git.ahead} ↓${git.behind}`}
            tooltip="Ahead / behind remote"
            onClick={onSync}
          />
          <StatusBarItem
            icon={<Cloud size={12} />}
            label={git.syncedLabel}
            tooltip="Click to sync now"
            onClick={onSync}
          />
          <StatusBarItem label={<DiffStatChip added={git.diff.added} removed={git.diff.removed} />} />
          <StatusBarItem
            label={`${git.untracked} untracked`}
            tooltip="Untracked files"
            tone="warning"
          />
        </>
      }
      right={
        <>
          <StatusBarItem label={`Ln ${cursor.line}, Col ${cursor.column}`} tooltip="Go to line" />
          <StatusBarItem label={encoding} tooltip="Select encoding" />
          <StatusBarItem label={eol} tooltip="Select end of line sequence" />
          <StatusBarItem label={language} tooltip="Select language mode" />
          <StatusBarItem icon={<Bell size={12} />} label="" tooltip="Notifications" />
        </>
      }
    />
  );
}

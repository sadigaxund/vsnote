/**
 * App status bar: branch/sync/diff (left), cursor/encoding/lang/bell
 * (right). Composition over `local/StatusBar` + `local/DiffStatChip`.
 *
 * Phase 5b sync-lifecycle polish (IMPLEMENTATION-PLAN.md Phase 5): the sync
 * segment shows the library's `Spinner` while `git.syncing` is truthy
 * (swapping out the static cloud glyph) and the "synced Xm ago" label is
 * re-derived from `git.lastSyncedAt` on a tick interval, not a store
 * write — a plain re-render every 15s (`useState` counter bumped from
 * `setInterval`) is enough to make the label visibly count up, since
 * `formatSyncedLabel` is pure and cheap to recompute. The interval also
 * fires once immediately (see the effect) so a slow next tick never leaves
 * a stale label on screen right after a fresh sync.
 *
 * DESIGN-SPEC Amendments item 16 (typing-latency bug): the Ln/Col readout
 * used to arrive as a `cursor` prop computed in `App.tsx` from a `useState`
 * that every keystroke, in every pane, in every mode (including Rendered,
 * where this value isn't even shown), updated — re-rendering the entire
 * shell once per keystroke. It now reads `useCursorStore` directly via a
 * targeted selector scoped to the FOCUSED pane only (`activePaneId`), so
 * only this one status-bar item re-renders when the caret moves; `App` and
 * everything else stays untouched. Still gated to Source/Diff modes (the
 * only modes with a real CM6 selection worth showing) — Rendered mode/no
 * tab show the neutral `1,1` placeholder, exactly as before.
 */
import { useEffect, useState } from "react";
import { Bell, Cloud, GitBranch, ShieldAlert } from "lucide-react";
import { Spinner } from "my-you-eye";
import { DiffStatChip } from "./local/DiffStatChip";
import { StatusBar as StatusBarShell, StatusBarItem } from "./local/StatusBar";
import { formatSyncedLabel } from "../lib/relativeTime";
import { findLeaf, useTabsStore } from "../stores/useTabsStore";
import { useCursorStore } from "../stores/useCursorStore";
import type { GitSummary } from "../types";

/** How often the "synced Xm ago" label re-derives from `lastSyncedAt`.
 * Coarser than a second (nothing in the label resolves finer than a
 * minute) but frequent enough that a session left open genuinely watches
 * it advance rather than only updating on the next sync. */
const SYNCED_LABEL_TICK_MS = 15_000;

export interface AppStatusBarProps {
  git: GitSummary;
  encoding: string;
  eol: string;
  language: string;
  onSync?: () => void;
  /** "denied" shows the muted eviction-risk warning (Phase 5b durability
   * safeguard); "granted"/"unsupported"/undefined (still resolving at
   * boot) render nothing — never nags, per the brief. */
  storagePersistence?: "granted" | "denied" | "unsupported";
}

export function AppStatusBar({ git, encoding, eol, language, onSync, storagePersistence }: AppStatusBarProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), SYNCED_LABEL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Targeted subscriptions (see module doc): `activePaneId` only changes on
  // focus switches (rare), and `useCursorStore`'s selector only returns a
  // new reference when the FOCUSED pane's own position actually changes —
  // typing in a background/unfocused pane (not normally possible without
  // focusing it first) wouldn't re-render this component either way.
  const activePaneId = useTabsStore((s) => s.activePaneId);
  const activeTabMode = useTabsStore((s) => {
    const leaf = findLeaf(s.tree, s.activePaneId);
    return leaf?.tabs.find((t) => t.path === leaf.activeTabId)?.mode;
  });
  const rawCursor = useCursorStore((s) => s.byPane[activePaneId]);
  const cursor = activeTabMode === "source" || activeTabMode === "diff" ? (rawCursor ?? { line: 1, column: 1 }) : { line: 1, column: 1 };

  const syncedLabel = formatSyncedLabel(git.lastSyncedAt);
  const syncLabelText = git.syncing
    ? `${git.syncing === "push" ? "pushing" : git.syncing === "pull" ? "pulling" : "syncing"}…`
    : git.syncError
      ? "sync failed"
      : syncedLabel;

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
            tooltip="Ahead / behind remote (real — see Settings → Git & Sync) — click to sync"
            onClick={onSync}
          />
          <StatusBarItem
            icon={
              git.syncing ? (
                <Spinner size="sm" aria-label="Syncing" />
              ) : (
                <Cloud size={12} color={git.syncError ? "var(--git-deleted)" : undefined} />
              )
            }
            label={syncLabelText}
            tooltip={git.syncError ?? "Click to sync now"}
            tone={git.syncError ? "danger" : undefined}
            onClick={onSync}
          />
          <StatusBarItem label={<DiffStatChip added={git.diff.added} removed={git.diff.removed} />} />
          <StatusBarItem
            label={`${git.untracked} untracked`}
            tooltip="Untracked files"
            tone="warning"
          />
          {storagePersistence === "denied" && (
            <StatusBarItem
              icon={<ShieldAlert size={12} />}
              label="storage not persisted"
              tooltip="The browser denied persistent storage for this vault — it may be evicted under disk pressure (e.g. low disk space). Your work still saves locally; consider exporting a backup (⌘K → Export vault as .zip)."
            />
          )}
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

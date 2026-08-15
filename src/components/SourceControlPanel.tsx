/**
 * Source Control sidebar panel — the activity-bar icon with the changed-
 * count badge (DESIGN-SPEC "Git features"): changed-file list with status
 * letters (click -> opens that file in Diff mode), commit message box +
 * Commit button (a real commit via `git/commit.ts`'s `commitAll`, then
 * `useGitStore.refresh()` — the same refresh every other file op already
 * calls, so the tree letters/badge/chip/status-bar all clear together, not
 * through a separate code path), and push/pull buttons driving the
 * simulated remote (`git/remote.ts`, already wired into `useGitStore`).
 *
 * Pure composition over the library's `Button`/`Textarea`/`ScrollArea`/
 * `Tooltip` plus the local `FileIcon` and the shared `lib/gitStatusColor`
 * map (also used by `ExplorerTree`) — nothing here is a missing-primitive
 * case (no new entry needed in docs/COMPONENT-BACKLOG.md), same as
 * `Sidebar.tsx`.
 */
import { useState } from "react";
import { Button, ScrollArea, Textarea, Tooltip } from "my-you-eye";
import { ArrowDownToLine, ArrowUpFromLine, GitCommitHorizontal } from "lucide-react";
import { FileIcon } from "./local/FileIcon";
import { STATUS_COLOR } from "../lib/gitStatusColor";
import { commitAll } from "../git/commit";
import { useGitStore } from "../stores/useGitStore";
import { inferFileKind } from "../stores/useFsStore";

export interface SourceControlPanelProps {
  onOpenDiff: (path: string) => void;
}

export function SourceControlPanel({ onOpenDiff }: SourceControlPanelProps) {
  const statuses = useGitStore((s) => s.statuses);
  const changedCount = useGitStore((s) => s.changedCount);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const syncing = useGitStore((s) => s.syncing);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);

  const files = Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b));

  async function handleCommit() {
    const trimmed = message.trim();
    if (!trimmed || changedCount === 0 || committing) return;
    setCommitting(true);
    try {
      await commitAll(trimmed);
      setMessage("");
      await useGitStore.getState().refresh();
    } finally {
      setCommitting(false);
    }
  }

  return (
    <aside
      style={{
        width: 288,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--app-sidebar-bg)",
        borderRight: "1px solid var(--app-chrome-border)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "var(--app-chrome-sidebar-header-h)",
          padding: "0 12px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--color-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          SOURCE CONTROL
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Tooltip content={`Pull (behind ${behind})`} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Pull"
              disabled={!!syncing}
              onClick={() => void useGitStore.getState().pull()}
              style={{ width: 22, height: 22, color: "var(--color-muted)" }}
            >
              <ArrowDownToLine size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={`Push (ahead ${ahead})`} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Push"
              disabled={!!syncing}
              onClick={() => void useGitStore.getState().push()}
              style={{ width: 22, height: 22, color: "var(--color-muted)" }}
            >
              <ArrowUpFromLine size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div style={{ padding: "0 10px 10px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <Textarea
          placeholder={`Message (${changedCount} change${changedCount === 1 ? "" : "s"})`}
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, resize: "vertical" }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleCommit()}
          disabled={!message.trim() || changedCount === 0 || committing}
        >
          <GitCommitHorizontal size={14} />
          {committing ? "Committing…" : "Commit"}
        </Button>
      </div>

      <ScrollArea className="flex-1" style={{ minHeight: 0 }}>
        {files.length === 0 ? (
          <div style={{ padding: "24px 14px", fontSize: 12, color: "var(--color-muted)", fontFamily: "var(--font-sans)" }}>
            No changes.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "0 0 12px" }}>
            {files.map(([path, status]) => {
              const name = path.slice(path.lastIndexOf("/") + 1);
              const kind = inferFileKind(name);
              return (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => onOpenDiff(path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      minHeight: "var(--app-chrome-tree-row-h)",
                      padding: "0 10px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: "inherit",
                      font: "inherit",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--color-surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <FileIcon kind={kind} name={name} size={14} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontFamily: "var(--font-sans)",
                        color: STATUS_COLOR[status],
                        textDecoration: status === "D" ? "line-through" : undefined,
                      }}
                    >
                      {name}
                    </span>
                    <span
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                        color: STATUS_COLOR[status],
                        width: 12,
                        textAlign: "right",
                      }}
                    >
                      {status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}

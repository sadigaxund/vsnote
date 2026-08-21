/**
 * Source Control sidebar panel — the activity-bar icon with the changed-
 * count badge (DESIGN-SPEC "Git features"): changed-file list with status
 * letters (click -> opens that file in Diff mode), commit message box +
 * Commit button (a real commit via `git/commit.ts`'s `commitAll`, then
 * `useGitStore.refresh()` — the same refresh every other file op already
 * calls, so the tree letters/badge/chip/status-bar all clear together, not
 * through a separate code path), and push/pull buttons driving the REAL
 * remote (Phase 11 — `git/remote.ts`'s `realPush`/`realPull` over
 * isomorphic-git + smart-HTTP, wired into `useGitStore`).
 *
 * Renders inside the shared `local/SidebarContainer` region shell (DESIGN-
 * SPEC Amendments round 3 item 20's course-correction — see that file's
 * doc: this used to hardcode its own frozen `width: 288` with no resize/
 * collapse of its own). Otherwise pure composition over the library's
 * `Button`/`Textarea`/`ScrollArea`/`Tooltip` plus the local `FileIcon` and
 * the shared `lib/gitStatusColor` map (also used by `ExplorerTree`).
 *
 * Phase 11 (roadmap §5.3) — the commit message box PREFILLS from
 * `useSettingsStore`'s `gitCommitTemplate`/`gitDeviceName`, rendered via
 * `git/commitTemplate.ts`, whenever the box is still showing a
 * template-generated value (i.e. the user hasn't typed their own message
 * yet this "cycle") — it stops re-deriving the instant the user edits it
 * by hand, and starts fresh again after the next successful commit. This
 * is the SAME template `useGitStore.ts`'s `syncNow` uses for its own
 * auto-commit and merge commits — one source of truth, three call sites.
 */
import { useState } from "react";
import { Alert, Button, ConfirmDialog, ScrollArea, Textarea, Tooltip, useToast } from "my-you-eye";
import { ArrowDownToLine, ArrowUpFromLine, GitCommitHorizontal } from "lucide-react";
import { FileIcon } from "./local/FileIcon";
import { SidebarContainer } from "./local/SidebarContainer";
import { STATUS_COLOR } from "../lib/gitStatusColor";
import { commitAll } from "../git/commit";
import { buildTemplateVars, renderCommitTemplate } from "../git/commitTemplate";
import { useGitStore } from "../stores/useGitStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { inferFileKind } from "../stores/useFsStore";

export interface SourceControlPanelProps {
  onOpenDiff: (path: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function SourceControlPanel({ onOpenDiff, width, onWidthChange, collapsed, onCollapsedChange }: SourceControlPanelProps) {
  const statuses = useGitStore((s) => s.statuses);
  const changedCount = useGitStore((s) => s.changedCount);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const syncing = useGitStore((s) => s.syncing);
  const branch = useGitStore((s) => s.branch);
  const syncError = useGitStore((s) => s.syncError);
  const syncErrorCode = useGitStore((s) => s.syncErrorCode);
  const gitCommitTemplate = useSettingsStore((s) => s.gitCommitTemplate);
  const gitDeviceName = useSettingsStore((s) => s.gitDeviceName);
  const remoteOverrideEnabled = useSettingsStore((s) => s.gitRemoteOverrideEnabled);
  // Round 6 item 19 — the unrelated-history escape hatch: offered only when
  // a sync actually failed with a "remote refused/differs" class of error,
  // and only for the built-in backend remote (an external GitHub/Gitea
  // remote can't be reset by us, and force-push stays forbidden).
  const [replaceRemoteOpen, setReplaceRemoteOpen] = useState(false);
  const offerReplaceRemote = !remoteOverrideEnabled && (syncErrorCode === "diverged" || syncErrorCode === "http");
  // `userMessage === null` means "the user hasn't typed anything this
  // cycle" — the box then DERIVES its displayed value straight from the
  // template on every render (no effect, no setState-during-effect: this
  // is the plain "value computed from props/state" pattern, not
  // synchronizing with an external system), so it stays live as files
  // change (e.g. `{files}` going from "1 file" to "3 files" as more edits
  // land) right up until the user types their own message. `commitAll`ing
  // clears it back to `null` so the next cycle prefills fresh again.
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const { toast } = useToast();

  const files = Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b));

  const templateMessage =
    changedCount === 0
      ? ""
      : renderCommitTemplate(gitCommitTemplate, buildTemplateVars({ device: gitDeviceName, branch, files: Object.keys(statuses) }));
  const message = userMessage ?? templateMessage;

  // Phase 11 (real sync) — Pull/Push here call the SAME `useGitStore`
  // actions the status bar's sync segment does, but as direct one-shot
  // buttons rather than through `App.tsx`'s `handleSyncNow` — so this
  // panel needs its own honest failure surface (a toast) instead of
  // silently relying on someone else clicking the status bar next. Every
  // sync action already guarantees `syncing` clears and `syncError` is set
  // on failure (see `useGitStore`'s doc) — this just reads that back.
  async function handleSyncAction(kind: "pull" | "push") {
    await useGitStore.getState()[kind]();
    const { syncError, ahead: aheadNow, behind: behindNow } = useGitStore.getState();
    if (syncError) {
      toast({ title: kind === "pull" ? "Pull failed" : "Push failed", description: syncError, variant: "danger" });
      return;
    }
    toast({
      title: kind === "pull" ? "Pulled from remote" : "Pushed to remote",
      description: `↑${aheadNow} ↓${behindNow}`,
      variant: "success",
    });
  }

  async function handleCommit() {
    const trimmed = message.trim();
    if (!trimmed || changedCount === 0 || committing) return;
    setCommitting(true);
    try {
      await commitAll(trimmed);
      setUserMessage(null); // next cycle derives fresh from the template again
      await useGitStore.getState().refresh();
    } finally {
      setCommitting(false);
    }
  }

  return (
    <SidebarContainer
      testId="scm-panel"
      label="SOURCE CONTROL"
      headerActions={
        <>
          <Tooltip content={`Pull (behind ${behind})`} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Pull"
              disabled={!!syncing}
              onClick={() => void handleSyncAction("pull")}
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
              onClick={() => void handleSyncAction("push")}
              style={{ width: 22, height: 22, color: "var(--color-muted)" }}
            >
              <ArrowUpFromLine size={14} />
            </Button>
          </Tooltip>
        </>
      }
      width={width}
      onWidthChange={onWidthChange}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
    >
      <div style={{ padding: "0 10px 10px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <Textarea
          placeholder={`Message (${changedCount} change${changedCount === 1 ? "" : "s"})`}
          aria-label="Commit message"
          value={message}
          onChange={(e) => setUserMessage(e.target.value)}
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
        {offerReplaceRemote && (
          <Alert variant="danger" size="sm" title="Remote refuses this history" data-testid="scm-replace-remote-alert">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span>{syncError}</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                style={{ alignSelf: "flex-start" }}
                disabled={!!syncing}
                data-testid="scm-replace-remote"
                onClick={() => setReplaceRemoteOpen(true)}
              >
                Replace remote with local…
              </Button>
            </div>
          </Alert>
        )}
      </div>

      <ConfirmDialog
        title="Replace remote with local?"
        description="Deletes the server's copy of this repository and pushes your local history into a fresh one. Anything on the remote that is not in your local vault is permanently lost. Your local files are untouched."
        confirmLabel="Replace remote"
        destructive
        open={replaceRemoteOpen}
        onOpenChange={setReplaceRemoteOpen}
        onConfirm={() => {
          setReplaceRemoteOpen(false);
          void useGitStore
            .getState()
            .replaceRemoteWithLocal()
            .then(() => {
              const { syncError: errAfter } = useGitStore.getState();
              if (errAfter) toast({ title: "Replace remote failed", description: errAfter, variant: "danger" });
              else toast({ title: "Remote replaced", description: "The remote now mirrors your local history.", variant: "success" });
            });
        }}
      />

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
                      e.currentTarget.style.background = "var(--sidebar-item-hover)";
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
    </SidebarContainer>
  );
}

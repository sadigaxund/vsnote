/**
 * Settings -> Git & Sync category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4). Keeps
 * DESIGN-SPEC item 52 intact: until `gitSyncSetupComplete`, this category is
 * NOTHING but the setup panel (plus the "Show git status in explorer" row,
 * which governs local-git display, not sync, and stays visible on both
 * sides of the gate).
 */
import { useMemo, useState } from "react";
import { Alert, Badge, Button, FormField, Input, Switch } from "my-you-eye";
import { GitBranch, Loader2 } from "lucide-react";
import { SettingsRow } from "../local/SettingsRow";
import { VaultSetupPanel } from "../local/VaultSetupPanel";
import { SyncSetupPanel } from "../SyncSetupPanel";
import { useSettingsStore, DEFAULT_GIT_COMMIT_TEMPLATE } from "../../stores/useSettingsStore";
import { useGitStore } from "../../stores/useGitStore";
import {
  computeGitRemoteUrl,
  DEFAULT_GIT_REPO_NAME,
  describeConnectionTest,
  resolveGitCredential,
  testGitConnection,
  type ConnectionTestResult,
} from "../../git/remote";
import { isHttpRemoteUrl } from "../../git/syncStatus";
import { clampSyncIntervalMinutes, MIN_SYNC_INTERVAL_MINUTES } from "../../git/autoSyncPolicy";
import { buildTemplateVars, renderCommitTemplate } from "../../git/commitTemplate";
import { createApiToken } from "../../share/api";
import { useShareStore } from "../../share/useShareStore";
import type { SettingRow } from "./types";

function gitStatusRow(showGitStatusInExplorer: boolean, setShowGitStatusInExplorer: (v: boolean) => void): SettingRow {
  return {
    id: "git-status-in-explorer",
    label: "Show git status in explorer",
    keywords: "git status letters tree explorer decorations colors clean",
    content: (
      <SettingsRow label="Show git status in explorer" hint="Colors file names and shows status letters in the tree." controlWidth="text">
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <Switch
            checked={showGitStatusInExplorer}
            onCheckedChange={setShowGitStatusInExplorer}
            aria-label="Show git status in explorer"
            data-testid="git-status-in-explorer"
          />
          <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Off keeps the tree clean; changes stay in Source Control.</span>
        </label>
      </SettingsRow>
    ),
  };
}

export function useGitRows(): SettingRow[] {
  const gitAuthToken = useSettingsStore((s) => s.gitAuthToken);
  const setGitAuthToken = useSettingsStore((s) => s.setGitAuthToken);
  const gitRepoName = useSettingsStore((s) => s.gitRepoName);
  const gitRemoteOverrideEnabled = useSettingsStore((s) => s.gitRemoteOverrideEnabled);
  const setGitRemoteOverrideEnabled = useSettingsStore((s) => s.setGitRemoteOverrideEnabled);
  const gitRemoteOverrideUrl = useSettingsStore((s) => s.gitRemoteOverrideUrl);
  const setGitRemoteOverrideUrl = useSettingsStore((s) => s.setGitRemoteOverrideUrl);
  const gitRemoteOverrideToken = useSettingsStore((s) => s.gitRemoteOverrideToken);
  const setGitRemoteOverrideToken = useSettingsStore((s) => s.setGitRemoteOverrideToken);
  const gitCommitTemplate = useSettingsStore((s) => s.gitCommitTemplate);
  const setGitCommitTemplate = useSettingsStore((s) => s.setGitCommitTemplate);
  const gitDeviceName = useSettingsStore((s) => s.gitDeviceName);
  const setGitDeviceName = useSettingsStore((s) => s.setGitDeviceName);
  const showGitStatusInExplorer = useSettingsStore((s) => s.showGitStatusInExplorer);
  const setShowGitStatusInExplorer = useSettingsStore((s) => s.setShowGitStatusInExplorer);
  const gitSyncOnInterval = useSettingsStore((s) => s.gitSyncOnInterval);
  const setGitSyncOnInterval = useSettingsStore((s) => s.setGitSyncOnInterval);
  const gitSyncOnOpenClose = useSettingsStore((s) => s.gitSyncOnOpenClose);
  const setGitSyncOnOpenClose = useSettingsStore((s) => s.setGitSyncOnOpenClose);
  const gitSyncOnSave = useSettingsStore((s) => s.gitSyncOnSave);
  const setGitSyncOnSave = useSettingsStore((s) => s.setGitSyncOnSave);
  const gitSyncOnFocus = useSettingsStore((s) => s.gitSyncOnFocus);
  const setGitSyncOnFocus = useSettingsStore((s) => s.setGitSyncOnFocus);
  const gitSyncSetupComplete = useSettingsStore((s) => s.gitSyncSetupComplete);
  const setGitSyncSetupComplete = useSettingsStore((s) => s.setGitSyncSetupComplete);
  const gitSyncIntervalMinutes = useSettingsStore((s) => s.gitSyncIntervalMinutes);
  const setGitSyncIntervalMinutes = useSettingsStore((s) => s.setGitSyncIntervalMinutes);

  const branch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);

  const authenticated = useShareStore((s) => s.authenticated);

  const [gitTokenDraft, setGitTokenDraft] = useState(gitAuthToken);
  const [seenAuthToken, setSeenAuthToken] = useState(gitAuthToken);
  if (gitAuthToken !== seenAuthToken) {
    setSeenAuthToken(gitAuthToken);
    setGitTokenDraft(gitAuthToken);
  }
  const [gitSyncIntervalDraft, setGitSyncIntervalDraft] = useState(String(gitSyncIntervalMinutes));
  const [gitTesting, setGitTesting] = useState(false);
  const [gitTestResult, setGitTestResult] = useState<ConnectionTestResult | null>(null);
  const [gitTokenGenerating, setGitTokenGenerating] = useState(false);
  const [gitTokenGenerateError, setGitTokenGenerateError] = useState<string | null>(null);
  const [gitOverrideTokenDraft, setGitOverrideTokenDraft] = useState(gitRemoteOverrideToken);

  const gitRemoteSettings = useMemo(
    () => ({ repoName: gitRepoName, overrideEnabled: gitRemoteOverrideEnabled, overrideUrl: gitRemoteOverrideUrl }),
    [gitRepoName, gitRemoteOverrideEnabled, gitRemoteOverrideUrl],
  );
  const resolvedRemoteUrl = computeGitRemoteUrl(gitRemoteSettings);
  const overrideUrlError =
    gitRemoteOverrideEnabled && gitRemoteOverrideUrl.trim() !== "" && !isHttpRemoteUrl(gitRemoteOverrideUrl)
      ? "Enter a full http or https URL."
      : null;

  const statusRow = gitStatusRow(showGitStatusInExplorer, setShowGitStatusInExplorer);

  if (!gitSyncSetupComplete) {
    return [
      {
        id: "sync-setup",
        label: "Set up sync",
        keywords: "git sync setup enable remote server token begin start",
        content: <SyncSetupPanel />,
      },
      statusRow,
    ];
  }

  return [
    {
      id: "server-vault",
      label: "Server vault",
      keywords: "vault wizard init mirror remote ssh key token setup server github gitlab gitea mounted legacy branch",
      content: <VaultSetupPanel clientRepoName={gitRepoName} />,
    },
    {
      id: "repo-info",
      label: "Vault identity",
      keywords: "branch repo git info vault ahead behind identity name",
      content: (
        <SettingsRow label="Vault identity" hint="What Sync talks to right now, not a guess." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                data-testid="vault-identity-chip"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 12px",
                  borderRadius: "var(--radius-ui)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  color: "var(--color-fg)",
                }}
              >
                <GitBranch size={13} style={{ color: "var(--color-primary)" }} aria-hidden />
                {gitRepoName.trim() || DEFAULT_GIT_REPO_NAME}
                <span style={{ color: "var(--color-muted)" }}>·</span>
                {branch}
              </span>
              <Badge variant="neutral" tone="soft">{`↑${ahead} ↓${behind}`}</Badge>
            </div>
            <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
              {gitRemoteOverrideEnabled && gitRemoteOverrideUrl.trim() !== ""
                ? `Syncs with ${gitRemoteOverrideUrl.trim()}`
                : "Syncs with this VSNote server. The server's own vault folder is the durable copy of your notes."}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              style={{ alignSelf: "flex-start" }}
              data-testid="sync-rerun-setup"
              onClick={() => setGitSyncSetupComplete(false)}
            >
              Rerun setup
            </Button>
          </div>
        </SettingsRow>
      ),
    },
    statusRow,
    {
      id: "remote-sync",
      label: "Remote sync",
      keywords: "remote url https token sync auth push pull ssh key test connection generate",
      content: (
        <SettingsRow label="Remote sync" controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge variant={gitTestResult?.ok ? "success" : "neutral"} tone="soft">
                {gitTestResult?.ok ? (gitTestResult.repoExists ? "Connected" : "Connected, repo not created yet") : "Fast-forward only"}
              </Badge>
            </div>
            <FormField label="Personal access token" hint="Authenticates sync to this server. Generate one right here once signed in.">
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  size="sm"
                  type="password"
                  placeholder="vsn_••••••••••••••••"
                  value={gitTokenDraft}
                  disabled={gitRemoteOverrideEnabled}
                  onChange={(e) => setGitTokenDraft(e.target.value)}
                  onBlur={() => setGitAuthToken(gitTokenDraft)}
                  aria-label="Personal access token"
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!authenticated || gitTokenGenerating || gitRemoteOverrideEnabled}
                  data-testid="git-generate-token"
                  onClick={() => {
                    setGitTokenGenerating(true);
                    setGitTokenGenerateError(null);
                    createApiToken("vsnote-git-sync", "write")
                      .then((created) => {
                        setGitTokenDraft(created.token);
                        setGitAuthToken(created.token);
                      })
                      .catch((err) => {
                        setGitTokenGenerateError(err instanceof Error ? err.message : "Could not generate a token.");
                      })
                      .finally(() => setGitTokenGenerating(false));
                  }}
                >
                  {gitTokenGenerating ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Generate token"}
                </Button>
              </div>
            </FormField>
            {gitRemoteOverrideEnabled && (
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Unused while the custom remote override below is on.</span>
            )}
            {!authenticated && !gitRemoteOverrideEnabled && (
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Sign in under Sharing to generate a token, or paste one you have.</span>
            )}
            {gitTokenGenerateError && (
              <Alert variant="danger" size="sm">
                {gitTokenGenerateError}
              </Alert>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="git-test-connection"
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => {
                  if (gitRemoteOverrideEnabled) setGitRemoteOverrideToken(gitOverrideTokenDraft);
                  else setGitAuthToken(gitTokenDraft);
                  // A blank or malformed override URL, with the override
                  // toggle ON, must never silently test the IMPLICIT remote
                  // instead (that would report "Connected" while the user
                  // believes their custom remote works) nor produce the
                  // generic "Could not reach the remote host" copy —
                  // `resolveGitRemoteUrl` falls back to the implicit remote
                  // for real sync on purpose (a half-filled Advanced section
                  // must not break sync), but "Test connection" specifically
                  // must call out the misconfiguration instead of testing
                  // something the user didn't ask for.
                  if (gitRemoteOverrideEnabled && (gitRemoteOverrideUrl.trim() === "" || overrideUrlError)) {
                    setGitTestResult({
                      ok: false,
                      code: "not-configured",
                      message: gitRemoteOverrideUrl.trim() === "" ? "Enter a custom remote URL first." : "Fix the custom remote URL first.",
                    });
                    return;
                  }
                  setGitTesting(true);
                  setGitTestResult(null);
                  void testGitConnection({
                    url: resolvedRemoteUrl,
                    token: resolveGitCredential({
                      token: gitTokenDraft,
                      overrideEnabled: gitRemoteOverrideEnabled,
                      overrideUrl: gitRemoteOverrideUrl,
                      overrideToken: gitOverrideTokenDraft,
                    }),
                  })
                    .then(setGitTestResult)
                    .finally(() => setGitTesting(false));
                }}
              >
                {gitTesting ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Test connection"}
              </Button>
              {gitTestResult && !gitTesting && (
                <span
                  data-testid="git-test-result"
                  style={{ fontSize: 12.5, color: gitTestResult.ok ? "var(--color-muted)" : "var(--git-deleted)" }}
                >
                  {describeConnectionTest(gitTestResult, gitRemoteOverrideEnabled).message}
                </span>
              )}
            </div>
          </div>
        </SettingsRow>
      ),
    },
    {
      id: "custom-remote",
      label: "Advanced: custom remote",
      keywords: "advanced custom remote external github gitea token credential override",
      content: (
        <SettingsRow label="Advanced: custom remote" hint="For an external GitHub, Gitea, or other VSNote remote. Off by default." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: gitRemoteOverrideEnabled ? 1 : 0.85 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <Switch
                checked={gitRemoteOverrideEnabled}
                onCheckedChange={setGitRemoteOverrideEnabled}
                aria-label="Advanced: custom remote override"
                data-testid="git-override-enabled"
              />
              <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Use a custom remote instead of this server</span>
            </label>
            {gitRemoteOverrideEnabled && (
              <>
                <FormField label="Custom remote URL" hint="A full http or https git remote URL." error={overrideUrlError ?? undefined}>
                  <Input
                    size="sm"
                    value={gitRemoteOverrideUrl}
                    invalid={!!overrideUrlError}
                    placeholder="https://github.com/you/notes.git"
                    onChange={(e) => setGitRemoteOverrideUrl(e.target.value)}
                    aria-label="Custom remote URL"
                    data-testid="git-override-url"
                    style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                  />
                </FormField>
                <FormField label="Custom remote credential" hint="A personal access token for that remote. Kept separate from the token above.">
                  <Input
                    size="sm"
                    type="password"
                    placeholder="ghp_••••••••••••••••"
                    value={gitOverrideTokenDraft}
                    onChange={(e) => setGitOverrideTokenDraft(e.target.value)}
                    onBlur={() => setGitRemoteOverrideToken(gitOverrideTokenDraft)}
                    aria-label="Custom remote credential"
                    data-testid="git-override-token"
                    style={{ width: "100%" }}
                  />
                </FormField>
                <Alert variant="note" size="sm">
                  Sync stays fast-forward or auto-merge here too. It never force-pushes.
                </Alert>
              </>
            )}
          </div>
        </SettingsRow>
      ),
    },
    {
      id: "commit-template",
      label: "Default commit message",
      keywords: "commit message template device timestamp date time files branch sync auto-commit merge",
      content: (
        <SettingsRow label="Default commit message" hint="Prefills the commit box. Supports {device} {timestamp} {date} {time} {files} {branch}." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input
              size="sm"
              value={gitCommitTemplate}
              onChange={(e) => setGitCommitTemplate(e.target.value)}
              aria-label="Default commit message template"
              data-testid="git-commit-template"
              style={{ width: "100%", fontFamily: "var(--font-mono)" }}
            />
            {gitCommitTemplate.trim() === "" && (
              <Button type="button" variant="ghost" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setGitCommitTemplate(DEFAULT_GIT_COMMIT_TEMPLATE)}>
                Reset to default
              </Button>
            )}
            <span data-testid="git-commit-template-preview" style={{ fontSize: 12, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>
              Preview: {renderCommitTemplate(gitCommitTemplate, buildTemplateVars({ device: gitDeviceName || "device", branch, files: ["architecture.md"] }))}
            </span>
          </div>
        </SettingsRow>
      ),
    },
    {
      id: "device-name",
      label: "Device name",
      keywords: "device name hostname computer template sync",
      content: (
        <SettingsRow label="Device name" hint="Auto-detected from your browser; editable." controlWidth="text">
          <Input
            size="sm"
            value={gitDeviceName}
            onChange={(e) => setGitDeviceName(e.target.value)}
            aria-label="Device name"
            data-testid="git-device-name"
            style={{ width: "100%", fontFamily: "var(--font-mono)" }}
          />
        </SettingsRow>
      ),
    },
    {
      id: "auto-sync",
      label: "Auto-sync",
      keywords: "auto sync automatic interval minutes open close save schedule background queue",
      content: (
        <SettingsRow label="Auto-sync" hint="All off means manual. Any combination can be on at once." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch checked={gitSyncOnInterval} onCheckedChange={setGitSyncOnInterval} aria-label="Sync every N minutes" data-testid="git-sync-on-interval" />
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>Every</span>
                <Input
                  size="sm"
                  type="number"
                  min={MIN_SYNC_INTERVAL_MINUTES}
                  disabled={!gitSyncOnInterval}
                  value={gitSyncIntervalDraft}
                  onChange={(e) => setGitSyncIntervalDraft(e.target.value)}
                  onBlur={() => {
                    const clamped = clampSyncIntervalMinutes(Number(gitSyncIntervalDraft));
                    setGitSyncIntervalDraft(String(clamped));
                    setGitSyncIntervalMinutes(clamped);
                  }}
                  aria-label="Auto-sync interval in minutes"
                  data-testid="git-sync-interval-minutes"
                  style={{ width: 72 }}
                />
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>minutes</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch checked={gitSyncOnOpenClose} onCheckedChange={setGitSyncOnOpenClose} aria-label="Sync on app open and close" data-testid="git-sync-on-open-close" />
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>On app open and close</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch checked={gitSyncOnSave} onCheckedChange={setGitSyncOnSave} aria-label="Sync after each save" data-testid="git-sync-on-save" />
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>After each save</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch checked={gitSyncOnFocus} onCheckedChange={setGitSyncOnFocus} aria-label="Sync when the window regains focus" data-testid="git-sync-on-focus" />
                <span style={{ fontSize: 13, color: "var(--color-fg)" }}>Sync when the window regains focus</span>
              </label>
            </div>
            {(gitSyncOnInterval || gitSyncOnOpenClose || gitSyncOnSave || gitSyncOnFocus) && (
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Triggers queue into one sync at a time with a short quiet window between runs.</span>
            )}
          </div>
        </SettingsRow>
      ),
    },
  ];
}

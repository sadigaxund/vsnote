/**
 * Settings -> Git & Sync category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4). Keeps
 * DESIGN-SPEC item 52 intact: until `gitSyncSetupComplete`, this category is
 * NOTHING but the setup panel (plus the "Show git status in explorer" row,
 * which governs local-git display, not sync, and stays visible on both
 * sides of the gate).
 */
import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, FormField, Input, Separator, Switch } from "my-you-eye";
import { Check, ExternalLink, GitBranch, Loader2 } from "lucide-react";
import { SettingsRow } from "../local/SettingsRow";
import { Stepper, type StepperStep } from "../local/Stepper";
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

/** Round 5 (design-health P1/P2, `.impeccable/critique/…settingsview…`) —
 * "Remote sync" + "Advanced: custom remote" collapsed into one guided
 * three-step card: a step is marked done from REAL state (a valid remote,
 * a non-empty resolved credential, a last test that actually succeeded),
 * never from "the user clicked through" — there's no separate "Next"
 * button gating step 2/3, since the built-in remote is valid with zero
 * input and existing e2e flows generate a token / click Test connection
 * without ever "completing" step 1 first. */
const CONNECTION_STEPS: StepperStep[] = [
  { id: "remote", label: "Remote" },
  { id: "credential", label: "Credential" },
  { id: "test", label: "Test connection" },
];

/** How long the inline "Saved" confirmation (check + text) shows in the
 * token row before it hands off to the persistent "Token set, ends in
 * ...xxxx" summary line — design-health P0 ("token generation fills field
 * silently, no 'saved'"). */
const TOKEN_SAVED_FLASH_MS = 1500;

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
  const [tokenJustSaved, setTokenJustSaved] = useState(false);
  const tokenSavedTimeoutRef = useRef<number | undefined>(undefined);
  const flashTokenSaved = () => {
    setTokenJustSaved(true);
    window.clearTimeout(tokenSavedTimeoutRef.current);
    tokenSavedTimeoutRef.current = window.setTimeout(() => setTokenJustSaved(false), TOKEN_SAVED_FLASH_MS);
  };

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

  // Guided-card step state, derived from real store state — never from
  // "has the user clicked past this step" (design-health P1: "a step is
  // marked done only from real state").
  const remoteStepDone = !gitRemoteOverrideEnabled || (gitRemoteOverrideUrl.trim() !== "" && !overrideUrlError);
  const committedCredential = resolveGitCredential({
    token: gitAuthToken,
    overrideEnabled: gitRemoteOverrideEnabled,
    overrideUrl: gitRemoteOverrideUrl,
    overrideToken: gitRemoteOverrideToken,
  });
  const credentialStepDone = committedCredential.trim() !== "";
  const testStepDone = gitTestResult?.ok === true;
  // `Stepper`'s `current` marks every index BELOW it "done" — passing one
  // past the last index (3) once the test has actually passed is what lets
  // step 3 itself show as done too, for a real "clear end state" rather
  // than forever sitting on "current".
  const connectionStepIndex = !remoteStepDone ? 0 : !credentialStepDone ? 1 : testStepDone ? 3 : 2;

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
              <span data-testid="vault-identity-chip" className="settings-chip">
                <GitBranch size={13} style={{ color: "var(--color-primary)" }} aria-hidden />
                {gitRepoName.trim() || DEFAULT_GIT_REPO_NAME}
                <span style={{ color: "var(--color-muted)" }}>·</span>
                {branch}
              </span>
              <Badge variant="neutral" tone="soft">{`↑${ahead} ↓${behind}`}</Badge>
            </div>
            <span className="settings-hint" style={{ color: "var(--color-muted)" }}>
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
      // Round 5 (design-health P1/P0/P2) — "Remote sync" and "Advanced:
      // custom remote" collapsed into one guided three-step card. Every
      // testid a spec depends on (`git-generate-token`, `git-test-
      // connection`, `git-test-result`, `git-override-enabled`,
      // `git-override-url`, `git-override-token`) and the "Personal access
      // token" / "Custom remote URL" / "Custom remote credential" labels
      // are unchanged — only their grouping and copy changed.
      id: "connection",
      label: "Connection",
      keywords: "remote url https token credential sync auth push pull ssh key test connection generate advanced custom fast-forward",
      content: (
        <SettingsRow label="Connection" hint="Where sync sends your vault, and proof it can reach it." controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Stepper steps={CONNECTION_STEPS} current={connectionStepIndex} testidPrefix="git-sync" ariaLabel="Git & Sync connection steps" />

            {/* Step 1 — Remote */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-fg)" }}>1. Remote</span>
              {!gitRemoteOverrideEnabled && (
                <span className="settings-hint" style={{ color: "var(--color-muted)" }}>
                  Built-in remote: repository <code style={{ fontFamily: "var(--font-mono)" }}>{gitRepoName.trim() || DEFAULT_GIT_REPO_NAME}</code> on
                  this VSNote server.
                </span>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <Switch
                  checked={gitRemoteOverrideEnabled}
                  onCheckedChange={setGitRemoteOverrideEnabled}
                  aria-label="Advanced: custom remote override"
                  data-testid="git-override-enabled"
                />
                <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Advanced: use a custom remote instead (GitHub, Gitea, another VSNote)</span>
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
                  <FormField label="Custom remote credential" hint="A personal access token for that remote. Kept separate from the token below.">
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

            <Separator />

            {/* Step 2 — Credential */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-fg)" }}>2. Credential</span>
              <FormField label="Personal access token" hint="Authenticates sync to this server. Generate one right here once signed in.">
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    size="sm"
                    type="password"
                    placeholder="vsn_••••••••••••••••"
                    value={gitTokenDraft}
                    disabled={gitRemoteOverrideEnabled}
                    onChange={(e) => setGitTokenDraft(e.target.value)}
                    onBlur={() => {
                      const changed = gitTokenDraft !== gitAuthToken;
                      setGitAuthToken(gitTokenDraft);
                      if (changed && gitTokenDraft.trim() !== "") flashTokenSaved();
                    }}
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
                          flashTokenSaved();
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
              {/* Design-health P0 — token commit (blur OR Generate) gets an
                  explicit "Saved" transition, then hands off to a
                  persistent summary that never shows the token itself,
                  only its last 4 characters. */}
              {tokenJustSaved ? (
                <span data-testid="git-token-saved" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-success)" }}>
                  <Check size={12} aria-hidden /> Saved
                </span>
              ) : (
                !gitRemoteOverrideEnabled &&
                gitAuthToken.trim() !== "" && (
                  <span data-testid="git-token-summary" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    Token set, ends in ...{gitAuthToken.trim().slice(-4)}
                  </span>
                )
              )}
              {gitRemoteOverrideEnabled && (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Unused while the custom remote override above is on.</span>
              )}
              {!authenticated && !gitRemoteOverrideEnabled && (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Sign in under Sharing to generate a token, or paste one you have.</span>
              )}
              {gitTokenGenerateError && (
                <Alert variant="danger" size="sm">
                  {gitTokenGenerateError}
                </Alert>
              )}
            </div>

            <Separator />

            {/* Step 3 — Test connection */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-fg)" }}>3. Test connection</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Badge variant={testStepDone ? "success" : "neutral"} tone="soft">
                  {testStepDone ? "Connected, fast-forward only" : "Not connected"}
                </Badge>
                {testStepDone && (
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    Fast-forward only: sync never force-pushes; a real divergence auto-merges or opens conflict resolution instead.
                  </span>
                )}
              </div>
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
                    // Note (R5-2): "Test connection" is deliberately NOT
                    // preemptively blocked just because the resolved token
                    // is blank — an "unsigned" test against this app's own
                    // implicit remote is expected to make the real request
                    // and surface the real, specific 401 ("regenerate the
                    // token") rather than a generic client-side guess (see
                    // `settings-view.spec.ts`'s "Unsigned 'Test connection'
                    // still degrades to a clear, specific message"). That
                    // request can never trigger a browser credential
                    // popup either way: the implicit remote's 401 comes
                    // from `/git`, whose `WWW-Authenticate` challenge is
                    // already withheld from a browser-shaped caller
                    // (`git_http.py::_is_git_client`, item 26a), and a
                    // custom remote's request is proxied through
                    // `/api/git-proxy`, which now never relays an upstream
                    // `www-authenticate` at all (`git_proxy.py`'s
                    // `NEVER_RELAYED_RESPONSE_HEADERS` — this ticket's
                    // actual root cause).
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
                    className="settings-hint"
                    style={{ color: gitTestResult.ok ? "var(--color-muted)" : "var(--git-deleted)" }}
                  >
                    {describeConnectionTest(gitTestResult, gitRemoteOverrideEnabled).message}
                  </span>
                )}
              </div>
            </div>

            <Separator />

            {/* Design-health "help/documentation" gap ("no docs link on
                Git & Sync") — the README's own "Git & Sync" section
                (`README.md#git--sync`), not an in-app page: this client
                has no doc viewer, and the README is the one place this
                card's guided flow, the fast-forward-only policy, and the
                full sync roadmap pointer are already written up. */}
            <a
              href="https://github.com/sadigaxund/vsnote/blob/main/README.md#git--sync"
              target="_blank"
              rel="noreferrer"
              data-testid="git-sync-docs-link"
              className="settings-hint"
              style={{ display: "inline-flex", alignItems: "center", gap: "var(--settings-control-gap)", color: "var(--color-primary)", alignSelf: "flex-start" }}
            >
              <ExternalLink size={13} aria-hidden />
              Docs: Git &amp; Sync
            </a>
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

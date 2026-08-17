/**
 * Round 7 item 52 — the opt-in Git & Sync setup view. Until
 * `gitSyncSetupComplete` flips true, the Git & Sync category renders
 * NOTHING but this panel: sync is fully off by default and the flow
 * assumes zero git knowledge. Plain-language steps, remote optional, and
 * no implicit server URL is ever displayed as if the user configured it
 * (the "This VSNote server" choice is named in words, never as
 * `http://…/git/vault.git`).
 *
 * Pure composition of `my-you-eye` primitives (RadioGroup/Input/Button/
 * Alert/FormField) — same "no new local primitive" reasoning as
 * `SettingsView.tsx`'s own header doc, so no `docs/COMPONENT-BACKLOG.md`
 * row. Sign-in goes through the EXISTING `useShareStore.login()` (the one
 * auth implementation), and the sync token through the same
 * `createApiToken` the Remote sync row uses.
 */
import { useState } from "react";
import { Alert, Button, FormField, Input, RadioGroup, RadioGroupItem } from "my-you-eye";
import { GitBranch, Loader2 } from "lucide-react";
import { createApiToken } from "../share/api";
import { useShareStore } from "../share/useShareStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useGitStore } from "../stores/useGitStore";
import { DEFAULT_GIT_REPO_NAME } from "../git/remote";
import { isHttpRemoteUrl } from "../git/syncStatus";

type Step = "intro" | "destination";
type Destination = "this-server" | "custom";

export function SyncSetupPanel() {
  const [step, setStep] = useState<Step>("intro");
  const [destination, setDestination] = useState<Destination>("this-server");
  const [customUrl, setCustomUrl] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const authenticated = useShareStore((s) => s.authenticated);
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const login = useShareStore((s) => s.login);
  const reachability = useShareStore((s) => s.reachability);

  const gitAuthToken = useSettingsStore((s) => s.gitAuthToken);
  const gitRepoName = useSettingsStore((s) => s.gitRepoName);
  const branch = useGitStore((s) => s.branch);

  const repoLabel = gitRepoName.trim() || DEFAULT_GIT_REPO_NAME;
  const customUrlValid = isHttpRemoteUrl(customUrl.trim());
  const canFinish =
    destination === "custom" ? customUrlValid : authenticated && gitAuthToken.trim().length > 0;

  async function handleCreateToken() {
    setTokenBusy(true);
    setTokenError(null);
    try {
      const created = await createApiToken("vsnote-git-sync", "write");
      useSettingsStore.getState().setGitAuthToken(created.token);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not create a sync token.");
    } finally {
      setTokenBusy(false);
    }
  }

  function handleFinish() {
    const settings = useSettingsStore.getState();
    if (destination === "custom") {
      settings.setGitRemoteOverrideUrl(customUrl.trim());
      settings.setGitRemoteOverrideToken(customToken);
      settings.setGitRemoteOverrideEnabled(true);
    } else {
      settings.setGitRemoteOverrideEnabled(false);
    }
    settings.setGitSyncSetupComplete(true);
  }

  if (step === "intro") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: "36rem" }} data-testid="sync-setup-intro">
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-fg)" }}>Sync is off</div>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0, lineHeight: 1.6 }}>
          Your notes live only in this browser right now. Sync backs the vault up to a server and keeps a
          history of every change. Nothing is turned on until you finish this setup.
        </p>
        <Button type="button" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setStep("destination")} data-testid="sync-setup-begin">
          Set up sync
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: "36rem" }} data-testid="sync-setup-destination">
      <FormField label="Where should your notes go?">
        <RadioGroup value={destination} onValueChange={(v) => setDestination(v as Destination)}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "6px 0" }}>
            <RadioGroupItem value="this-server" aria-label="This VSNote server" data-testid="sync-setup-this-server" />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, color: "var(--color-fg)", fontWeight: 600 }}>This VSNote server</span>
              <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>The server this app runs on keeps your vault. Easiest.</span>
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "6px 0" }}>
            <RadioGroupItem value="custom" aria-label="A git host you use" data-testid="sync-setup-custom" />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, color: "var(--color-fg)", fontWeight: 600 }}>A git host you use</span>
              <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>GitHub, Gitea, or any https git remote you control.</span>
            </span>
          </label>
        </RadioGroup>
      </FormField>

      {destination === "this-server" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {reachability === "offline" && (
            <Alert variant="warning" size="sm">
              The backend is not reachable right now. Try again when it is, or pick a git host instead.
            </Alert>
          )}
          {reachability !== "offline" && !authenticated && (
            <FormField label="Sign in" hint="Your account on this server. Ask whoever runs it if you have none.">
              <div style={{ display: "flex", gap: 8 }}>
                <Input size="sm" placeholder="Username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} aria-label="Sync username" data-testid="sync-setup-username" />
                <Input size="sm" type="password" placeholder="Password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} aria-label="Sync password" data-testid="sync-setup-password" />
                <Button type="button" size="sm" disabled={loggingIn} onClick={() => void login(loginUser, loginPass)} data-testid="sync-setup-signin" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                  {loggingIn ? <Loader2 size={13} className="animate-spin" /> : "Sign in"}
                </Button>
              </div>
            </FormField>
          )}
          {loginError && !authenticated && (
            <Alert variant="danger" size="sm">
              {loginError}
            </Alert>
          )}
          {authenticated && gitAuthToken.trim() === "" && (
            <FormField label="Sync token" hint="Lets this browser push and pull. Stored only on this device.">
              <Button type="button" size="sm" variant="secondary" disabled={tokenBusy} onClick={() => void handleCreateToken()} data-testid="sync-setup-create-token" style={{ alignSelf: "flex-start" }}>
                {tokenBusy ? <Loader2 size={13} className="animate-spin" /> : "Create sync token"}
              </Button>
            </FormField>
          )}
          {authenticated && gitAuthToken.trim() !== "" && (
            <Alert variant="success" size="sm" data-testid="sync-setup-token-ready">
              Signed in, sync token ready.
            </Alert>
          )}
          {tokenError && (
            <Alert variant="danger" size="sm">
              {tokenError}
            </Alert>
          )}
        </div>
      )}

      {destination === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FormField label="Remote URL" hint="A full https git URL, like https://github.com/you/notes.git">
            <Input size="sm" value={customUrl} invalid={customUrl.trim() !== "" && !customUrlValid} onChange={(e) => setCustomUrl(e.target.value)} aria-label="Remote URL" data-testid="sync-setup-url" style={{ fontFamily: "var(--font-mono)" }} />
          </FormField>
          <FormField label="Access token" hint="A token from that host with permission to push. Optional for public pulls.">
            <Input size="sm" type="password" value={customToken} onChange={(e) => setCustomToken(e.target.value)} aria-label="Remote access token" data-testid="sync-setup-remote-token" />
          </FormField>
        </div>
      )}

      {/* Item 53 — the vault's identity, derived and read-only: repo + branch. */}
      <FormField label="Your vault" hint="An existing repository is never overwritten.">
        <span
          data-testid="sync-setup-identity"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            alignSelf: "flex-start",
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
          {repoLabel}
          <span style={{ color: "var(--color-muted)" }}>·</span>
          {branch}
        </span>
      </FormField>

      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" size="sm" variant="ghost" onClick={() => setStep("intro")}>
          Back
        </Button>
        <Button type="button" size="sm" disabled={!canFinish} onClick={handleFinish} data-testid="sync-setup-finish">
          Turn on sync
        </Button>
      </div>
    </div>
  );
}

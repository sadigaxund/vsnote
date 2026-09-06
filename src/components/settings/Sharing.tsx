/**
 * Settings -> Sharing category (split out of the former monolithic
 * `SettingsView.tsx`, docs/PLAN-2026-09-05-refresh.md §2 item 4). Share
 * MANAGEMENT (list, edit policy, revoke) lives in the "Shared" activity-bar
 * tab now (`SharedView.tsx`, DESIGN-SPEC round 10 item 83) — this category
 * keeps only sharing DEFAULTS: backend sign-in and the admin-only share
 * blob size limit.
 */
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Input } from "my-you-eye";
import { Loader2 } from "lucide-react";
import { SettingsRow } from "../local/SettingsRow";
import { useShareStore } from "../../share/useShareStore";
import { fetchOAuthProviders, oauthStartUrl } from "../../share/oauth";
import type { SettingRow } from "./types";

export function useSharingRows(): SettingRow[] {
  const reachability = useShareStore((s) => s.reachability);
  const authenticated = useShareStore((s) => s.authenticated);
  const shareUsername = useShareStore((s) => s.username);
  const isAdmin = useShareStore((s) => s.isAdmin);
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const probeShareBackend = useShareStore((s) => s.probe);
  const loginShareBackend = useShareStore((s) => s.login);
  const logoutShareBackend = useShareStore((s) => s.logout);

  const [oauthGoogle, setOauthGoogle] = useState(false);
  useEffect(() => {
    void fetchOAuthProviders().then((p) => setOauthGoogle(p.google));
  }, []);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  const isAdminSignedIn = authenticated && isAdmin;
  const adminMaxBlobBytes = useShareStore((s) => s.adminMaxBlobBytes);
  const adminSettingsError = useShareStore((s) => s.adminSettingsError);
  const fetchAdminSettings = useShareStore((s) => s.fetchAdminSettings);
  const updateAdminSettings = useShareStore((s) => s.updateAdminSettings);
  const [maxBlobMbOverride, setMaxBlobMbOverride] = useState<string | null>(null);
  const [savingMaxBlob, setSavingMaxBlob] = useState(false);
  const maxBlobMbDisplay = maxBlobMbOverride ?? (adminMaxBlobBytes != null ? String(Math.round(adminMaxBlobBytes / (1024 * 1024))) : "");

  useEffect(() => {
    if (isAdminSignedIn) void fetchAdminSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminSignedIn]);

  useEffect(() => {
    // Single-origin refactor (Phase 10.5a) — there's no more configurable
    // backend URL to gate a re-probe on; a plain mount-once probe (Settings
    // "Sharing" category mounting) is all this ever needs.
    void probeShareBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: SettingRow[] = [
    {
      id: "share-backend",
      label: "Backend connection",
      keywords: "share publish backend server url connect sign in login token offline reachability",
      content: (
        <SettingsRow label="Backend connection" controlWidth="full">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reachability === "offline" && (
              <Alert variant="warning" size="sm" title="Backend not running">
                Start it with <code>npm run server</code> from the repo root. The rest of VSNote works fine without it; only sharing needs it.
              </Alert>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge
                variant={reachability === "online" ? "success" : reachability === "offline" ? "danger" : "neutral"}
                tone="soft"
                data-testid="share-backend-status"
              >
                {reachability === "online" ? "Online" : reachability === "offline" ? "Offline" : reachability === "checking" ? "Checking…" : "Unknown"}
              </Badge>
              <Button type="button" variant="secondary" size="sm" data-testid="share-backend-test" onClick={() => void probeShareBackend()}>
                {reachability === "checking" ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Test connection"}
              </Button>
              {reachability === "online" && authenticated && (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>Signed in as {shareUsername}</span>
                  <Button type="button" variant="ghost" size="sm" data-testid="share-signout" onClick={() => void logoutShareBackend()}>
                    Sign out
                  </Button>
                </>
              )}
            </div>
            {reachability === "online" && !authenticated && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    size="sm"
                    placeholder="Username"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    aria-label="Backend username"
                    aria-invalid={Boolean(loginError)}
                    data-testid="share-login-username"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Input
                    size="sm"
                    type="password"
                    placeholder="Password"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    aria-label="Backend password"
                    aria-invalid={Boolean(loginError)}
                    data-testid="share-login-password"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={loggingIn}
                    data-testid="share-login-submit"
                    style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                    onClick={() => void loginShareBackend(loginUser, loginPass)}
                  >
                    {loggingIn ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Sign in"}
                  </Button>
                  {oauthGoogle && (
                    <a href={oauthStartUrl("/")} data-testid="settings-oauth-google" className="my-1">
                      Continue with Google
                    </a>
                  )}
                </div>
                {loginError && (
                  <Alert variant="danger" size="sm">
                    {loginError}
                  </Alert>
                )}
              </div>
            )}
          </div>
        </SettingsRow>
      ),
    },
  ];

  if (isAdminSignedIn) {
    rows.push({
      id: "admin-blob-limit",
      label: "Share size limit",
      keywords: "admin blob size limit max upload mb bytes share",
      content: (
        <SettingsRow label="Share size limit" hint="Maximum share upload size in MB, from 1 to 100." controlWidth="text">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Input
                size="sm"
                type="number"
                min={1}
                max={100}
                value={maxBlobMbDisplay}
                onChange={(e) => setMaxBlobMbOverride(e.target.value)}
                aria-label="Share size limit in megabytes"
                data-testid="admin-max-blob-mb"
                style={{ width: 90 }}
              />
              <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>MB</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={savingMaxBlob}
                data-testid="admin-max-blob-save"
                onClick={() => {
                  const mb = Number(maxBlobMbDisplay);
                  if (!Number.isFinite(mb) || mb < 1 || mb > 100) return;
                  setSavingMaxBlob(true);
                  void updateAdminSettings(Math.round(mb * 1024 * 1024))
                    .then((ok) => {
                      if (ok) setMaxBlobMbOverride(null);
                    })
                    .finally(() => setSavingMaxBlob(false));
                }}
              >
                {savingMaxBlob ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Save"}
              </Button>
            </div>
            {adminSettingsError && (
              <Alert variant="danger" size="sm">
                {adminSettingsError}
              </Alert>
            )}
          </div>
        </SettingsRow>
      ),
    });
  }

  return rows;
}

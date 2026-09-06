/**
 * PublishDialog — the Google/Microsoft-style sharing dialog
 * (`docs/ROADMAP-SHARING-AUTH.md` §1), rebuilt as a STEPPED form
 * (docs/PLAN-2026-09-05-refresh.md §4 and §5) reachable from three places:
 * the Explorer row context menu (`ExplorerTree.tsx`'s "Publish…" item), the
 * command palette ("Publish/Share file…"), and the title bar's share icon
 * (`components/TitleBar.tsx`) — all three just set `open`/`filePath` on one
 * shared instance mounted once in `App.tsx`. The Shared view
 * (`components/SharedView.tsx`) mounts a second instance for "Edit
 * policy…"/"Regenerate…"/"Manage tokens…", same as `SettingsView.tsx`'s old
 * "Sharing" category used to.
 *
 * Five fixed steps (`publishDialogLogic.ts`'s `STEP_IDS`), composed from
 * `my-you-eye` (`RadioGroup`, `FormField`, `Input`, `Select`, `Switch`,
 * `Dialog`, `Button`, `Badge`, `Alert`, `Combobox`) plus the local
 * `Stepper` (the library has no Stepper/Wizard — sadigaxund/my-you-eye#35,
 * already filed; see `Stepper.tsx`'s doc) and `SegmentedControl` for the
 * raw/rendered mode picker (already used by the title bar's Rendered/
 * Source/Diff toggle):
 *
 *  1. **Mode** — Raw or Rendered, each with a one-line "what a visitor
 *     gets" description.
 *  2. **Who can open** — Anyone with the link, or Only people I list
 *     (restricted; the People list lives on this step).
 *  3. **Protection** — filtered by mode, mirroring the server's auth
 *     matrix EXACTLY (`publishDialogLogic.ts`'s `authModesFor`): raw offers
 *     none/token only, rendered offers none/password/token. The dialog can
 *     never construct a combination the server would reject.
 *  4. **Link** — alias (validated client-side against the SAME rules the
 *     server enforces, including reserved words — `share/alias.ts`),
 *     expiry, and the two §5 opt-ins `Show title` / `Back link`. Rendered
 *     mode also lists "Links in this file" here (`share/linksInFile.ts`):
 *     every relative link found in the document, each "Shared as /share/x"
 *     or "Not shared" plus a "Share too" action that publishes that
 *     sibling with the SAME policy this dialog currently holds.
 *  5. **Result** — the link with a copy button; for token protection, the
 *     one-time per-share token (§4.2 — `share/api.ts`'s
 *     `createShareToken`, NOT an owner account API token) with a "you will
 *     not see this again" warning and a ready-made `curl` line.
 *
 * Two callers of the SAME component:
 *  - **Publish** (`existingShare` omitted): reads the file's current buffer
 *    content, `POST /api/blobs` then `POST /api/shares`.
 *  - **Edit policy** (`existingShare` set): the same form pre-filled from
 *    the share record, `PATCH /api/shares/{id}` on save — never re-uploads
 *    content (snapshot stays pinned).
 *
 * "Live" toggle: deliberately NOT exposed here — see git history for the
 * unchanged reasoning (`live` is stored but not yet acted on for reads).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from "my-you-eye";
import { Check, Copy, ExternalLink, FileCode, Globe2, Loader2, Lock, Share2, X } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";
import { Stepper } from "./Stepper";
import { useShareStore } from "../../share/useShareStore";
import { fetchOAuthProviders, oauthStartUrl } from "../../share/oauth";
import { validateAlias } from "../../share/alias";
import { buildShareLink } from "../../share/shareLinks";
import { createShareToken } from "../../share/api";
import { extractRelativeFileLinks, statusForLinks, type FileLinkStatus } from "../../share/linksInFile";
import { readTextFile } from "../../fs/operations";
import { displayToFsPath } from "../../fs/paths";
import {
  AUTH_MODE_LABELS,
  GENERAL_ACCESS_DESCRIPTIONS,
  MODE_CHROME,
  RENDER_MODE_DESCRIPTIONS,
  STEP_IDS,
  STEP_LABELS,
  authModesFor,
  dateInputToEpochSeconds,
  derivePublishMode,
  epochSecondsToDateInput,
  type StepId,
} from "./publishDialogLogic";
import type { AuthMode, GeneralAccess, GrantIn, GrantRole, RenderMode, ShareOut, ShareTokenCreateOut } from "../../share/api";
import type { FileKind } from "../../types";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vault display path being published, e.g. `vault/notes/x.md` —
   * omitted only while the dialog is closing/reused, never while `open`. */
  filePath?: string;
  fileKind?: FileKind;
  /** Current buffer content — read by the caller from `useBufferStore`,
   * never by this component (keeps it vault-agnostic, aside from the
   * "Share too" action below, which deliberately reads sibling files
   * directly since it publishes something the caller never asked about). */
  content?: string;
  /** Edit-policy mode: re-open for an existing share instead of publishing
   * a new one. */
  existingShare?: ShareOut;
}

const DELIVERY_OPTIONS: { value: RenderMode; label: string; icon: React.ReactNode }[] = [
  { value: "rendered", label: "Viewer page", icon: <Globe2 size={12} /> },
  { value: "raw", label: "Raw file", icon: <FileCode size={12} /> },
];

export function PublishDialog({ open, onOpenChange, filePath, content, existingShare }: PublishDialogProps) {
  const { toast } = useToast();
  const reachability = useShareStore((s) => s.reachability);
  const authenticated = useShareStore((s) => s.authenticated);
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const login = useShareStore((s) => s.login);
  const publish = useShareStore((s) => s.publish);
  const updateShare = useShareStore((s) => s.updateShare);
  const allShares = useShareStore((s) => s.shares);

  const mode = derivePublishMode({ existingShare, filePath, content });
  const isEditKind = mode?.kind === "edit-file";

  const [step, setStep] = useState<StepId>("mode");

  const [renderMode, setRenderMode] = useState<RenderMode>(() => (existingShare?.render_mode as RenderMode) ?? "rendered");
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>(() => (existingShare?.general_access as GeneralAccess) ?? "link");
  const [linkRole, setLinkRole] = useState<GrantRole>(() => existingShare?.link_role ?? "viewer");
  const [grants, setGrants] = useState<GrantIn[]>(() => existingShare?.grants ?? []);
  const [draftPrincipal, setDraftPrincipal] = useState("");
  const [draftRole, setDraftRole] = useState<GrantRole>("viewer");

  const [authMode, setAuthMode] = useState<AuthMode>(() => (existingShare?.auth_mode as AuthMode) ?? "none");
  const [password, setPassword] = useState("");

  const [alias, setAlias] = useState(() => existingShare?.alias ?? "");
  const [expiryEnabled, setExpiryEnabled] = useState(() => existingShare?.expires_at != null);
  const [expiresLocal, setExpiresLocal] = useState(() => epochSecondsToDateInput(existingShare?.expires_at));
  const [showTitle, setShowTitle] = useState(() => existingShare?.show_title ?? false);
  const [backLink, setBackLink] = useState(() => existingShare?.back_link ?? "");

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [oauthGoogle, setOauthGoogle] = useState(false);
  useEffect(() => {
    void fetchOAuthProviders().then((p) => setOauthGoogle(p.google));
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareOut | null>(null);

  // §4.2 — the one-time per-share token, minted right after a successful
  // publish/save when protection is "API token" (see `handleSubmit`).
  const [mintedToken, setMintedToken] = useState<ShareTokenCreateOut | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"link" | "token" | "curl" | null>(null);

  // §5 "Links in this file" — only meaningful for Rendered mode publishing
  // a real file; computed once from the content the caller handed us.
  const currentFilePath = mode?.kind === "publish-file" ? mode.filePath : mode?.kind === "edit-file" ? mode.share.source_path : undefined;
  const currentContent = mode?.kind === "publish-file" ? mode.content : undefined;
  const fileLinks: FileLinkStatus[] = useMemo(() => {
    if (renderMode !== "rendered" || !currentFilePath || currentContent === undefined) return [];
    return statusForLinks(extractRelativeFileLinks(currentFilePath, currentContent), allShares);
  }, [renderMode, currentFilePath, currentContent, allShares]);
  const [sharingSibling, setSharingSibling] = useState<string | null>(null);

  async function handleShareSibling(targetPath: string) {
    setSharingSibling(targetPath);
    try {
      const fsPath = displayToFsPath(targetPath);
      const siblingContent = await readTextFile(fsPath);
      const filename = targetPath.slice(targetPath.lastIndexOf("/") + 1);
      await publish({
        sourcePath: targetPath,
        filename,
        content: siblingContent,
        renderMode,
        generalAccess,
        authMode: authMode === "token" ? "none" : authMode, // never mint a second silent token
        password: authMode === "password" ? password : undefined,
        grants,
        linkRole,
      });
      toast({ title: "Shared", description: `${filename} is now shared with the same policy.`, variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't share that file", description: err instanceof Error ? err.message : "Try again.", variant: "danger" });
    } finally {
      setSharingSibling(null);
    }
  }

  const aliasCheck = useMemo(() => validateAlias(alias), [alias]);
  const filename = filePath ? filePath.slice(filePath.lastIndexOf("/") + 1) : "";
  const offline = reachability === "offline";

  const availableAuthModes = authModesFor(renderMode);
  // Switching Mode to Raw while Password was selected must not silently
  // submit a rejected combination — fall back to "none" the moment Raw is
  // chosen with an unsupported protection still selected. Adjusted during
  // RENDER (a `useState` snapshot of the last `renderMode` seen — refs
  // can't be read/written during render under this repo's
  // `eslint-plugin-react-hooks` rules, `react-hooks/refs`), the same
  // "adjust state when a prop/derived value changes" pattern
  // `ExplorerTree.tsx`'s `renamingSnapshot` uses, which avoids the
  // `react-hooks/set-state-in-effect` cascading-render warning entirely
  // rather than suppressing it.
  const [lastRenderMode, setLastRenderMode] = useState(renderMode);
  if (lastRenderMode !== renderMode) {
    setLastRenderMode(renderMode);
    if (!availableAuthModes.includes(authMode)) setAuthMode("none");
  }

  const backLinkOptions = useMemo(
    () =>
      allShares
        .filter((s) => !s.revoked_at && (!isEditKind || s.id !== existingShare?.id))
        .map((s) => ({ value: s.alias ?? s.slug, label: `${s.source_path} (${s.alias ?? s.slug})` })),
    [allShares, isEditKind, existingShare],
  );

  const stepIndex = STEP_IDS.indexOf(step);
  const canAdvanceFromLink = aliasCheck.valid && (!expiryEnabled || expiresLocal.length > 0);
  const canSubmit = !offline && authenticated && canAdvanceFromLink && (authMode !== "password" || password.length > 0 || (isEditKind && existingShare?.has_password)) && !submitting;

  function goNext() {
    const order: StepId[] = ["mode", "access", "protection", "link", "result"];
    const idx = order.indexOf(step);
    if (idx < order.length - 2) setStep(order[idx + 1]);
    else void handleSubmit();
  }
  function goBack() {
    const order: StepId[] = ["mode", "access", "protection", "link", "result"];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]);
  }

  function handleAddGrant() {
    const principal = draftPrincipal.trim();
    if (!principal) return;
    setGrants((prev) => (prev.some((g) => g.principal.toLowerCase() === principal.toLowerCase()) ? prev : [...prev, { principal, role: draftRole }]));
    setDraftPrincipal("");
  }

  async function handleLogin() {
    await login(loginUser, loginPass);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setTokenError(null);
    try {
      if (!mode) throw new Error("Nothing to publish.");
      const wasToken = isEditKind ? existingShare?.auth_mode === "token" : false;
      const policyPatch = {
        alias: alias.trim().length > 0 ? alias.trim() : "",
        ...(expiryEnabled ? { expires_at: dateInputToEpochSeconds(expiresLocal) ?? null } : { clear_expiry: true }),
        general_access: generalAccess,
        auth_mode: authMode,
        render_mode: renderMode,
        ...(generalAccess === "link" ? { link_role: linkRole } : {}),
        grants,
        ...(authMode === "password" && password.length > 0 ? { password } : {}),
        ...(authMode !== "password" ? { clear_password: true } : {}),
        show_title: showTitle,
        back_link: backLink,
      };

      let share: ShareOut;
      switch (mode.kind) {
        case "edit-file":
          share = await updateShare(mode.share.id, policyPatch);
          break;
        case "publish-file":
          share = await publish({
            sourcePath: mode.filePath,
            filename,
            content: mode.content,
            renderMode,
            generalAccess,
            authMode,
            password: authMode === "password" ? password : undefined,
            alias: alias.trim(),
            expiresAt: expiryEnabled ? dateInputToEpochSeconds(expiresLocal) : undefined,
            grants,
            linkRole,
          });
          break;
      }
      setResult(share);
      setStep("result");
      if (mode.kind === "publish-file") toast({ title: "Published", description: `${filename} is now shared.`, variant: "success" });

      // §4.2 — mint a fresh per-share token only when token protection is
      // newly in effect (a brand-new share, or an edit that just switched
      // INTO token mode) — never on every save, which would spam mints.
      if (authMode === "token" && !wasToken) {
        try {
          const minted = await createShareToken(share.id, `share ${alias.trim() || filename || share.slug}`);
          setMintedToken(minted);
        } catch (err) {
          setTokenError(err instanceof Error ? err.message : "Could not mint a share token.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const link = result ? buildShareLink(result) : null;
  const curlLine = link && mintedToken ? `curl -H 'Authorization: Bearer ${mintedToken.token}' ${link}` : null;

  async function copyText(field: "link" | "token" | "curl", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // clipboard permission denied — the value is still selectable text
    }
  }

  function resetAndClose(open: boolean) {
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent size="md" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle>{mode ? MODE_CHROME[mode.kind].title : "Publish"}</DialogTitle>
          <DialogDescription>
            {mode?.kind === "edit-file" ? mode.share.source_path : filePath ? `Share "${filePath.split("/").pop()}" with a link.` : ""}
          </DialogDescription>
        </DialogHeader>

        {offline && (
          <Alert variant="warning" title="Backend not running" size="sm">
            Share links need the VSNote backend. Start it with <code>npm run server</code> (listens on 127.0.0.1:8787).
          </Alert>
        )}

        {!offline && !authenticated && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Alert variant="info" size="sm" title="Sign in to publish">
              Publishing requires an owner session on the backend.
            </Alert>
            <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0, whiteSpace: "nowrap" }}>
              No account? Set the VSNOTE_BOOTSTRAP env vars on the server.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <Input size="sm" placeholder="Username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} aria-label="Backend username" data-testid="publish-login-username" />
              <Input
                size="sm"
                type="password"
                placeholder="Password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                aria-label="Backend password"
                data-testid="publish-login-password"
              />
              <Button type="button" size="sm" onClick={handleLogin} disabled={loggingIn} data-testid="publish-login-submit" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                {loggingIn ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Sign in"}
              </Button>
            </div>
            {loginError && (
              <Alert variant="danger" size="sm">
                {loginError}
              </Alert>
            )}
            {oauthGoogle && (
              <a href={oauthStartUrl("/")} data-testid="publish-oauth-google" style={{ fontSize: 12.5, color: "var(--color-primary)" }}>
                Continue with Google instead
              </a>
            )}
          </div>
        )}

        {!offline && authenticated && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Stepper steps={STEP_IDS.map((id) => ({ id, label: STEP_LABELS[id] }))} current={stepIndex} onStepClick={(i) => setStep(STEP_IDS[i])} />

            {step === "mode" && (
              <FormField label="Share as">
                <SegmentedControl size="sm" fullWidth value={renderMode} onChange={setRenderMode} aria-label="Delivery" options={DELIVERY_OPTIONS} />
                <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "8px 0 0" }} data-testid="publish-mode-description">
                  {RENDER_MODE_DESCRIPTIONS[renderMode]}
                </p>
              </FormField>
            )}

            {step === "access" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <FormField label="Who can open it">
                  <RadioGroup value={generalAccess} onValueChange={(v) => setGeneralAccess(v as GeneralAccess)} data-testid="publish-general-access" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <RadioGroupItem value="link" />
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Globe2 size={13} aria-hidden /> Anyone with the link
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <RadioGroupItem value="restricted" />
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Lock size={13} aria-hidden /> Only people I list
                      </span>
                    </label>
                  </RadioGroup>
                  <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "8px 0 0" }}>{GENERAL_ACCESS_DESCRIPTIONS[generalAccess]}</p>
                </FormField>

                {generalAccess === "link" && (
                  <FormField label="Link role">
                    <Select value={linkRole} onValueChange={(v) => setLinkRole(v as GrantRole)}>
                      <SelectTrigger size="sm" style={{ width: 150 }} data-testid="publish-link-role" aria-label="Link role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Can view</SelectItem>
                        <SelectItem value="editor">Can edit</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                )}

                {generalAccess === "restricted" && (
                  <FormField label="People" hint="They sign in with their account email or username to open it.">
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="publish-grants">
                      {grants.map((g) => (
                        <div key={g.principal} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.principal}</span>
                          <Select value={g.role} onValueChange={(v) => setGrants((prev) => prev.map((x) => (x.principal === g.principal ? { ...x, role: v as GrantRole } : x)))}>
                            <SelectTrigger size="sm" style={{ width: 110 }} aria-label={`Role for ${g.principal}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">Can view</SelectItem>
                              <SelectItem value="editor">Can edit</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${g.principal}`} onClick={() => setGrants((prev) => prev.filter((x) => x.principal !== g.principal))}>
                            <X size={13} />
                          </Button>
                        </div>
                      ))}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Input
                          size="sm"
                          placeholder="email or username"
                          value={draftPrincipal}
                          onChange={(e) => setDraftPrincipal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddGrant();
                            }
                          }}
                          aria-label="Add person"
                          data-testid="publish-grant-principal"
                          style={{ flex: 1, minWidth: 160 }}
                        />
                        <Select value={draftRole} onValueChange={(v) => setDraftRole(v as GrantRole)}>
                          <SelectTrigger size="sm" style={{ width: 110 }} aria-label="Role for the new person">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Can view</SelectItem>
                            <SelectItem value="editor">Can edit</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="button" size="sm" variant="secondary" disabled={!draftPrincipal.trim()} onClick={handleAddGrant} data-testid="publish-grant-add" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </FormField>
                )}
              </div>
            )}

            {step === "protection" && (
              <FormField label="Protection" hint={authMode === "token" ? "A per-share token is minted for you after publishing; callers send it as an Authorization: Bearer header." : undefined}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Select value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)}>
                    <SelectTrigger size="sm" style={{ width: 170 }} data-testid="publish-auth-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAuthModes.map((am) => (
                        <SelectItem key={am} value={am}>
                          {AUTH_MODE_LABELS[am]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {authMode === "password" && (
                    <Input
                      size="sm"
                      type="password"
                      placeholder={isEditKind && existingShare?.has_password ? "Leave blank to keep current password" : "Share password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-label="Share password"
                      data-testid="publish-password"
                      style={{ flex: 1 }}
                    />
                  )}
                </div>
                {renderMode === "raw" && (
                  <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "8px 0 0" }}>Raw files can't require a password. Choose no credential or a share token.</p>
                )}
                {authMode === "password" && fileLinks.length > 0 && (
                  <Alert variant="warning" size="sm" style={{ marginTop: 8 }} data-testid="publish-password-links-warning">
                    A password prompts once per share. This file links to other notes, so a linked set is better served by no credential or restricted access.
                  </Alert>
                )}
              </FormField>
            )}

            {step === "link" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <FormField label="Expiry">
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32 }}>
                        <Switch
                          checked={expiryEnabled}
                          onCheckedChange={(on) => {
                            setExpiryEnabled(on);
                            if (!on) setExpiresLocal("");
                          }}
                          aria-label="Set an expiry date"
                          data-testid="publish-expiry-toggle"
                        />
                        {expiryEnabled ? (
                          <Input size="sm" type="date" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} aria-label="Expiry date" data-testid="publish-expires" style={{ flex: 1 }} />
                        ) : (
                          <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>Never expires</span>
                        )}
                      </div>
                    </FormField>
                  </div>
                  <div style={{ flex: 1 }}>
                    <FormField label="Custom alias" error={aliasCheck.valid ? undefined : aliasCheck.reason}>
                      <Input
                        size="sm"
                        placeholder="8-64 chars: letters, digits, - _"
                        value={alias}
                        onChange={(e) => setAlias(e.target.value)}
                        invalid={!aliasCheck.valid}
                        aria-invalid={!aliasCheck.valid}
                        aria-label="Custom alias"
                        data-testid="publish-alias"
                      />
                    </FormField>
                  </div>
                </div>

                <FormField label="Show title" hint="Publishes the document's heading as the page title.">
                  <Switch checked={showTitle} onCheckedChange={setShowTitle} aria-label="Show title" data-testid="publish-show-title" />
                </FormField>

                <FormField label="Back link" hint="One line at the top pointing to another of your shares, typically an index.">
                  <div data-testid="publish-back-link">
                    <Combobox
                      options={[{ value: "", label: "None" }, ...backLinkOptions]}
                      value={backLink}
                      onChange={setBackLink}
                      placeholder="None"
                      emptyText="No other active shares yet."
                    />
                  </div>
                </FormField>

                {renderMode === "rendered" && fileLinks.length > 0 && (
                  <FormField label="Links in this file">
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="publish-file-links">
                      {fileLinks.map((link) => (
                        <div key={link.target} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }} data-testid={`publish-file-link-${link.target}`}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{link.raw}</span>
                          {link.share ? (
                            <Badge variant="success" tone="soft">
                              Shared as /share/{link.share.alias ?? link.share.slug}
                            </Badge>
                          ) : (
                            <>
                              <Badge variant="neutral" tone="soft">
                                Not shared
                              </Badge>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => void handleShareSibling(link.target)}
                                disabled={sharingSibling === link.target}
                                data-testid={`publish-share-too-${link.target}`}
                              >
                                {sharingSibling === link.target ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                                Share too
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </FormField>
                )}
              </div>
            )}

            {step === "result" && result && link && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <FormField label="Share link">
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input size="sm" readOnly value={link} data-testid="publish-result-link" style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" size="sm" variant="secondary" onClick={() => void copyText("link", link)} data-testid="publish-copy-link">
                      {copiedField === "link" ? <Check size={13} /> : <Copy size={13} />}
                      {copiedField === "link" ? "Copied" : "Copy"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => window.open(link, "_blank", "noopener,noreferrer")} aria-label="Open link">
                      <ExternalLink size={13} />
                    </Button>
                  </div>
                </FormField>

                <div style={{ display: "flex", gap: 6 }}>
                  <Badge variant="neutral" tone="soft">
                    {result.render_mode === "rendered" ? "Viewer page" : "Raw file"}
                  </Badge>
                  <Badge variant={result.general_access === "link" ? "primary" : "neutral"} tone="soft">
                    {result.general_access === "link" ? "Anyone with the link" : "Restricted"}
                  </Badge>
                  {result.auth_mode === "password" && (
                    <Badge variant="warning" tone="soft">
                      Password
                    </Badge>
                  )}
                  {result.auth_mode === "token" && (
                    <Badge variant="warning" tone="soft">
                      Share token
                    </Badge>
                  )}
                </div>

                {result.auth_mode === "token" && mintedToken && (
                  <>
                    <Alert variant="warning" size="sm" title="You will not see this token again" data-testid="publish-token-warning">
                      Copy it now and store it somewhere safe. VSNote never re-serves the plaintext token.
                    </Alert>
                    <FormField label="Share token">
                      <div style={{ display: "flex", gap: 8 }}>
                        <Input
                          size="sm"
                          readOnly
                          value={mintedToken.token}
                          aria-label="Generated share token"
                          data-testid="publish-generated-token"
                          style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <Button type="button" size="sm" variant="secondary" onClick={() => void copyText("token", mintedToken.token)} data-testid="publish-copy-token">
                          {copiedField === "token" ? <Check size={13} /> : <Copy size={13} />}
                          {copiedField === "token" ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </FormField>
                    <FormField label="Try it">
                      <div style={{ display: "flex", gap: 8 }}>
                        <Input size="sm" readOnly value={curlLine ?? ""} data-testid="publish-curl-line" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11.5 }} onFocus={(e) => e.currentTarget.select()} />
                        <Button type="button" size="sm" variant="secondary" onClick={() => curlLine && void copyText("curl", curlLine)} data-testid="publish-copy-curl">
                          {copiedField === "curl" ? <Check size={13} /> : <Copy size={13} />}
                          {copiedField === "curl" ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </FormField>
                  </>
                )}
                {result.auth_mode === "token" && tokenError && (
                  <Alert variant="danger" size="sm">
                    {tokenError}
                  </Alert>
                )}
              </div>
            )}

            {error && (
              <Alert variant="danger" size="sm">
                {error}
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "result" ? (
            <Button type="button" onClick={() => resetAndClose(false)} data-testid="publish-done">
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => (stepIndex === 0 ? resetAndClose(false) : goBack())}>
                {stepIndex === 0 ? "Cancel" : "Back"}
              </Button>
              <Button
                type="button"
                disabled={stepIndex === STEP_IDS.indexOf("link") ? !canSubmit : false}
                onClick={goNext}
                data-testid={stepIndex === STEP_IDS.indexOf("link") ? "publish-submit" : "publish-continue"}
              >
                {submitting ? (
                  <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span>
                ) : stepIndex === STEP_IDS.indexOf("link") ? (
                  mode ? MODE_CHROME[mode.kind].verb : "Publish"
                ) : (
                  "Continue"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

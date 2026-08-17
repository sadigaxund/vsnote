/**
 * PublishDialog — the Google/Microsoft-style sharing dialog
 * (`docs/ROADMAP-SHARING-AUTH.md` §1), reachable from three places per the
 * roadmap: the Explorer row context menu (`ExplorerTree.tsx`'s "Publish…"
 * item), the command palette ("Publish/Share file…"), and the title bar's
 * share icon (`components/TitleBar.tsx`) — all three just set `open`/
 * `filePath` on one shared instance mounted once in `App.tsx`, same pattern
 * as the existing "Reset demo vault" `ConfirmDialog`.
 *
 * Pure composition of `my-you-eye` primitives (Dialog, FormField, Select,
 * Switch, Input, Button, Badge, Alert) plus the local `SegmentedControl`
 * (already used by the title bar's Rendered/Source/Diff toggle) for the
 * raw/rendered mode picker — no new local primitive needed, so this file
 * gets no `docs/COMPONENT-BACKLOG.md` row of its own (same "solved by
 * composition" precedent as `ExtensionsPanel.tsx`, see that doc's Notes
 * section).
 *
 * Two modes, one component:
 *  - **Publish** (`existingShare` omitted): reads the file's current buffer
 *    content, `POST /api/blobs` then `POST /api/shares`, shows the
 *    resulting link with copy-to-clipboard.
 *  - **Edit policy** (`existingShare` set, from the Shared panel's "Edit
 *    policy…" action): the same form pre-filled from the share record,
 *    `PATCH /api/shares/{id}` on save — never re-uploads content (snapshot
 *    stays pinned; that's the whole point of "snapshot by default", see
 *    `docs/ROADMAP-SHARING-AUTH.md` §1).
 *
 * "Live" toggle: deliberately NOT exposed here. The backend's `live` field
 * exists and defaults `false` (`ShareCreateIn.live`), but nothing server-side
 * currently re-serves the CURRENT working-tree content for a `live: true`
 * share (`server/app/routers/share_public.py`'s GET handlers always read
 * `share.blob_id`'s pinned blob — `live` is stored but not yet acted on for
 * reads). Exposing a toggle that silently does nothing would be dishonest
 * UI; see this phase's final report for the same note.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from "my-you-eye";
import { Check, Copy, FileCode, Folder, Globe2, Loader2, Lock, X } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";
import { CheckboxTree, type CheckboxTreeNode } from "./CheckboxTree";
import { useShareStore, type FolderPublishEntry } from "../../share/useShareStore";
import { validateAlias } from "../../share/alias";
import { buildFolderShareLink, buildShareLink } from "../../share/shareLinks";
import { defaultIncludedSet, flattenFolderTree, includedSetFromManifest, relpathsUnderFolder } from "../../share/folderManifest";
import { createApiToken, getShareManifest } from "../../share/api";
import type { AuthMode, GeneralAccess, GrantIn, GrantRole, RenderMode, ShareOut } from "../../share/api";
import type { FileKind } from "../../types";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vault display path being published, e.g. `vault/notes/x.md` —
   * omitted only while the dialog is closing/reused, never while `open`. */
  filePath?: string;
  fileKind?: FileKind;
  /** Current buffer content — read by the caller (`App.tsx`) from
   * `useBufferStore`, never by this component (keeps it vault-agnostic and
   * safe to reason about alongside `share/ShareApp.tsx`'s "never touches
   * vault storage" requirement — this dialog only ever sees a plain string
   * its caller already read). */
  content?: string;
  /** Edit-policy mode: re-open for an existing share instead of publishing
   * a new one. */
  existingShare?: ShareOut;
  /** Phase 10.5 (folder shares, roadmap §5.1) — set all three together to
   * enter folder-publish mode: `folderPath` is the subtree root's vault
   * path (becomes `source_path`), `folderTree` is the CheckboxTree source
   * (`App.tsx` already read this from `useFsStore`), `folderEntries` is
   * the flat file list with CONTENT already read (this dialog stays
   * vault-agnostic — same guarantee as the single-file `content` prop
   * above; it only ever sees plain strings its caller already read).
   * Present alongside `existingShare` (a folder share), this also enables
   * "Update share" — republishing the CURRENT subtree to the same slug. */
  folderPath?: string;
  folderTree?: CheckboxTreeNode[];
  folderEntries?: FolderPublishEntry[];
}

/** Round 7 item 57 — delivery is its own axis, decoupled from role and
 * available for EVERY file kind (the share viewer renders code files in the
 * code editor since round 6, so the old "rendered is md/html only" gate was
 * stale). Wire values stay the server's render_mode ("rendered"/"raw"). */
const DELIVERY_OPTIONS: { value: RenderMode; label: string; icon: React.ReactNode }[] = [
  { value: "rendered", label: "Viewer page", icon: <Globe2 size={12} /> },
  { value: "raw", label: "Raw file", icon: <FileCode size={12} /> },
];

/** `<input type="date">` value <-> epoch seconds (the backend's
 * `expires_at` unit — see `schemas.py`'s `ShareCreateIn.expires_at`,
 * consumed as `float` seconds throughout `policy.py`). Midday UTC avoids a
 * date rendered in a timezone west of UTC silently rolling back a day. */
function dateInputToEpochSeconds(value: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms / 1000;
}
function epochSecondsToDateInput(epoch: number | null | undefined): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export function PublishDialog({
  open,
  onOpenChange,
  filePath,
  content,
  existingShare,
  folderPath,
  folderTree,
  folderEntries,
}: PublishDialogProps) {
  const { toast } = useToast();
  const reachability = useShareStore((s) => s.reachability);
  const authenticated = useShareStore((s) => s.authenticated);
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const login = useShareStore((s) => s.login);
  const publish = useShareStore((s) => s.publish);
  const publishFolder = useShareStore((s) => s.publishFolder);
  const updateFolderManifest = useShareStore((s) => s.updateFolderManifest);
  const updateShare = useShareStore((s) => s.updateShare);

  const editMode = !!existingShare;
  const isFolder = !!folderPath && !!folderTree && !!folderEntries;

  // Phase 10.5 — the checkbox tree's flat validation list + included set.
  // `allEntries` is derived straight from the prop (stable per mount, same
  // "remounts fresh on every open" reasoning as every other piece of state
  // in this component — see the block comment above). `included` starts
  // as "everything checked" for a fresh publish; for "Manage share…" on an
  // EXISTING folder share it's refetched from the server's current
  // manifest (a genuine async load, hence the one real effect below —
  // unlike the render-time-adjustment pattern used elsewhere in this
  // codebase for synchronous prop-derived resets).
  const allEntries = useMemo(() => (folderTree ? flattenFolderTree(folderTree) : []), [folderTree]);
  const [included, setIncluded] = useState<Set<string>>(() => defaultIncludedSet(allEntries));
  const [manifestLoading, setManifestLoading] = useState(isFolder && editMode);

  useEffect(() => {
    if (!isFolder || !editMode || !existingShare) return;
    let cancelled = false;
    getShareManifest(existingShare.id)
      .then((manifest) => {
        if (cancelled) return;
        setIncluded(includedSetFromManifest(manifest.entries.map((e) => e.relpath)));
      })
      .catch(() => {
        // Backend hiccup — fall back to "everything checked" rather than
        // blocking the dialog; the owner can still exclude manually.
      })
      .finally(() => {
        if (!cancelled) setManifestLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount, same reasoning as every other "fresh instance per open" state in this file.
  }, []);

  function handleToggle(node: CheckboxTreeNode, next: boolean) {
    const affected = node.type === "file" ? [node.id] : relpathsUnderFolder(allEntries, node.id);
    setIncluded((prev) => {
      const nextSet = new Set(prev);
      for (const relpath of affected) {
        if (next) nextSet.add(relpath);
        else nextSet.delete(relpath);
      }
      return nextSet;
    });
  }

  // Prefilled directly from props at MOUNT time, not reset via an effect —
  // both call sites (`App.tsx`'s "publish a new share" instance,
  // `SettingsView.tsx`'s "Edit policy…" instance) conditionally mount this
  // component only while open (`{open && <PublishDialog/>}`), so it fully
  // unmounts on close and remounts fresh on every open; a lazy `useState`
  // initializer reading `existingShare`/`fileKind` here is therefore
  // already correct without any "resync when the target changes" effect
  // (which would also trip `react-hooks/set-state-in-effect` for no
  // benefit — this codebase's established alternative for "state that
  // resets when a prop changes" is the render-time adjustment pattern, see
  // `local/ExplorerTree.tsx`'s `renamingSnapshot`; remounting is simpler
  // still since nothing here needs to survive a target change in place).
  // Round 7 item 55 — new shares default to "anyone with the link".
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>(
    () => (existingShare?.general_access as GeneralAccess) ?? "link",
  );
  // Round 7 item 57 — the link-wide default role, orthogonal to delivery.
  const [linkRole, setLinkRole] = useState<GrantRole>(() => existingShare?.link_role ?? "viewer");
  const [authMode, setAuthMode] = useState<AuthMode>(() => (existingShare?.auth_mode as AuthMode) ?? "none");
  const [password, setPassword] = useState("");
  const [alias, setAlias] = useState(() => existingShare?.alias ?? "");
  // Round 6 item 5 — expiry is explicit: OFF means "Never expires" (the
  // default), and the date input only exists once the switch opts in.
  const [expiryEnabled, setExpiryEnabled] = useState(() => existingShare?.expires_at != null);
  const [expiresLocal, setExpiresLocal] = useState(() => epochSecondsToDateInput(existingShare?.expires_at));
  const [renderMode, setRenderMode] = useState<RenderMode>(
    () => (existingShare?.render_mode as RenderMode) ?? "rendered",
  );
  // Round 7 item 60 — the people list is real state (server round-trips
  // grants on ShareOut now), not a single write-only add.
  const [grants, setGrants] = useState<GrantIn[]>(() => existingShare?.grants ?? []);
  const [draftPrincipal, setDraftPrincipal] = useState("");
  const [draftRole, setDraftRole] = useState<GrantRole>("viewer");
  // Round 7 item 56 — inline API-token generation (shown once, copy only).
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareOut | null>(null);
  const [copied, setCopied] = useState(false);

  const aliasCheck = useMemo(() => validateAlias(alias), [alias]);
  const filename = filePath ? filePath.slice(filePath.lastIndexOf("/") + 1) : "";
  const folderName = folderPath ? folderPath.slice(folderPath.lastIndexOf("/") + 1) : "";
  const includedCount = included.size;

  const offline = reachability === "offline";
  const canSubmit =
    !offline &&
    authenticated &&
    aliasCheck.valid &&
    (authMode !== "password" || password.length > 0 || (editMode && existingShare?.has_password)) &&
    // Item 5 — an opted-in expiry must actually have a date; "on but blank"
    // would silently save as never-expires while the UI said otherwise.
    (!expiryEnabled || expiresLocal.length > 0) &&
    (!isFolder || (!manifestLoading && includedCount > 0)) &&
    !submitting;

  async function handleLogin() {
    await login(loginUser, loginPass);
  }

  function handleAddGrant() {
    const principal = draftPrincipal.trim();
    if (!principal) return;
    setGrants((prev) =>
      prev.some((g) => g.principal.toLowerCase() === principal.toLowerCase()) ? prev : [...prev, { principal, role: draftRole }],
    );
    setDraftPrincipal("");
  }

  // Round 7 item 56 — "Requires: API token" is self-serve: a read-scoped
  // token minted right here, revealed once (the server never re-serves it).
  async function handleGenerateToken() {
    setGeneratingToken(true);
    setTokenError(null);
    try {
      const created = await createApiToken(`share ${alias.trim() || filename || folderName || "link"}`, "read");
      setGeneratedToken(created.token);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not create a token.");
    } finally {
      setGeneratingToken(false);
    }
  }

  async function handleCopyToken() {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      // clipboard denied — the token is still selectable text in the field
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const policyPatch = {
        alias: alias.trim().length > 0 ? alias.trim() : "",
        // `expires_at: null` reads as "omitted" server-side, so switching
        // expiry OFF must travel as the explicit clear_expiry sentinel.
        ...(expiryEnabled ? { expires_at: dateInputToEpochSeconds(expiresLocal) ?? null } : { clear_expiry: true }),
        general_access: generalAccess,
        auth_mode: authMode,
        render_mode: renderMode,
        // Round 7 items 57/60 — the link-wide role and the people list are
        // the dialog's state, sent wholesale (grants replace server-side).
        ...(generalAccess === "link" ? { link_role: linkRole } : {}),
        grants,
        ...(authMode === "password" && password.length > 0 ? { password } : {}),
        ...(authMode !== "password" ? { clear_password: true } : {}),
      };

      if (isFolder) {
        const includedEntries = (folderEntries ?? []).filter((e) => included.has(e.relpath));
        if (editMode && existingShare) {
          // Policy fields (access/expiry/password/alias/mode) via the same
          // PATCH every share type uses, THEN "Update share" — republish
          // the CURRENT subtree to the same slug (roadmap §5.1).
          await updateShare(existingShare.id, policyPatch);
          const updated = await updateFolderManifest(existingShare.id, includedEntries);
          setResult(updated);
          toast({ title: "Share updated", description: `Republished ${includedEntries.length} file(s).`, variant: "success" });
        } else {
          if (!folderPath) throw new Error("No folder selected to publish.");
          const share = await publishFolder(
            {
              sourcePath: folderPath,
              filename: folderName,
              content: "",
              renderMode,
              generalAccess,
              authMode,
              password: authMode === "password" ? password : undefined,
              alias: alias.trim(),
              expiresAt: expiryEnabled ? dateInputToEpochSeconds(expiresLocal) : undefined,
              grants,
              linkRole,
            },
            includedEntries,
          );
          setResult(share);
          toast({ title: "Published", description: `${folderName} (${includedEntries.length} files) is now shared.`, variant: "success" });
        }
      } else if (editMode && existingShare) {
        const updated = await updateShare(existingShare.id, policyPatch);
        setResult(updated);
      } else {
        if (!filePath || content === undefined) throw new Error("No file selected to publish.");
        const share = await publish({
          sourcePath: filePath,
          filename,
          content,
          renderMode,
          generalAccess,
          authMode,
          password: authMode === "password" ? password : undefined,
          alias: alias.trim(),
          expiresAt: expiryEnabled ? dateInputToEpochSeconds(expiresLocal) : undefined,
          grants,
          linkRole,
        });
        setResult(share);
        toast({ title: "Published", description: `${filename} is now shared.`, variant: "success" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const link = result ? (result.kind === "folder" ? buildFolderShareLink(result) : buildShareLink(result)) : null;

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied — the link is still selectable text in the field
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isFolder && <Folder size={16} aria-hidden />}
            {editMode ? "Edit share" : isFolder ? "Publish folder" : "Publish"}
          </DialogTitle>
          <DialogDescription>
            {editMode
              ? existingShare?.source_path
              : isFolder
                ? `Share "${folderName}" (a folder) with a link.`
                : filePath
                  ? `Share "${filePath.split("/").pop()}" with a link.`
                  : ""}
          </DialogDescription>
        </DialogHeader>

        {offline && (
          <Alert variant="warning" title="Backend not running" size="sm">
            Share links need the VSNote backend. Start it with <code>npm run server</code> (listens on
            127.0.0.1:8787).
          </Alert>
        )}

        {!offline && !authenticated && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Alert variant="info" size="sm" title="Sign in to publish">
              Publishing requires an owner session on the backend.
            </Alert>
            {/* DESIGN-SPEC Amendments round 4 item 32 hint, reworded round 6
                item 2: the old copy overflowed the dialog under nowrap
                ("modal spill"); shorter copy that genuinely fits one row. */}
            <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0, whiteSpace: "nowrap" }}>
              No account? Set the VSNOTE_BOOTSTRAP env vars on the server.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                size="sm"
                placeholder="Username"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                aria-label="Backend username"
                data-testid="publish-login-username"
              />
              <Input
                size="sm"
                type="password"
                placeholder="Password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                aria-label="Backend password"
                data-testid="publish-login-password"
              />
              {/* DESIGN-SPEC Amendments round 4 item 31: this row's two
                  `Input`s are the library's `w-full` variant, so they
                  compete with the Button for the flex row's space — without
                  pinning the Button to its own content size it can shrink
                  enough for "Sign in" to wrap onto two rows (same mechanism
                  as item 27's Test Connection button). */}
              <Button
                type="button"
                size="sm"
                onClick={handleLogin}
                disabled={loggingIn}
                data-testid="publish-login-submit"
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {loggingIn ? <Loader2 size={13} className="animate-spin" /> : "Sign in"}
              </Button>
            </div>
            {loginError && (
              <Alert variant="danger" size="sm">
                {loginError}
              </Alert>
            )}
          </div>
        )}

        {!offline && authenticated && !result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Round 7 items 55/57 — access + link role share one row,
                Docs-style: who can open it, and what the LINK itself
                grants. Per-person upgrades live in the People list below. */}
            <FormField label="General access">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select value={generalAccess} onValueChange={(v) => setGeneralAccess(v as GeneralAccess)}>
                    <SelectTrigger size="sm" data-testid="publish-general-access">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Round 6 item 3 — icon + label on ONE row: a bare icon
                          next to text inside SelectItem could wrap/stack; an
                          inline-flex wrapper keeps them a single unit. */}
                      <SelectItem value="restricted">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                          <Lock size={13} aria-hidden /> Restricted to listed people
                        </span>
                      </SelectItem>
                      <SelectItem value="link">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                          <Globe2 size={13} aria-hidden /> Anyone with the link
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {generalAccess === "link" && (
                  <Select value={linkRole} onValueChange={(v) => setLinkRole(v as GrantRole)}>
                    <SelectTrigger size="sm" style={{ width: 120 }} data-testid="publish-link-role" aria-label="Link role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Can view</SelectItem>
                      <SelectItem value="editor">Can edit</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </FormField>

            <FormField
              label="Share as"
              hint={renderMode === "raw" ? "The link returns the file bytes only, no page around them." : undefined}
            >
              <SegmentedControl
                size="sm"
                fullWidth
                value={renderMode}
                onChange={setRenderMode}
                aria-label="Delivery"
                options={DELIVERY_OPTIONS}
              />
            </FormField>

            {isFolder && (
              <FormField
                label="Files"
                hint={
                  manifestLoading
                    ? "Loading the current manifest…"
                    : `${includedCount} of ${allEntries.length} file(s) included. Unchecked entries are left out of the share entirely.`
                }
              >
                <div
                  style={{
                    maxHeight: 220,
                    overflow: "auto",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-ui-sm)",
                    padding: 4,
                  }}
                >
                  {allEntries.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: "var(--color-muted)", padding: 8, margin: 0 }}>This folder is empty.</p>
                  ) : (
                    <CheckboxTree data={folderTree ?? []} checked={included} onToggle={handleToggle} />
                  )}
                </div>
              </FormField>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                {/* Round 6 item 5 — expiry is explicit: the default state
                    SAYS "Never expires"; a date only exists after opting
                    in via the switch. */}
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
                      <Input
                        size="sm"
                        type="date"
                        value={expiresLocal}
                        onChange={(e) => setExpiresLocal(e.target.value)}
                        aria-label="Expiry date"
                        data-testid="publish-expires"
                        style={{ flex: 1 }}
                      />
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
                    aria-label="Custom alias"
                    data-testid="publish-alias"
                  />
                </FormField>
              </div>
            </div>

            {/* Round 6 item 4 — per-share TOKEN auth was server-implemented
                (policy.py's AuthMode.token: Authorization: Bearer with an
                API token) but never exposed here; the old Password switch
                becomes a three-way credential select. */}
            <FormField
              label="Requires"
              hint={authMode === "token" ? "Callers send an API token as an Authorization: Bearer header." : undefined}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Select value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)}>
                  <SelectTrigger size="sm" style={{ width: 150 }} data-testid="publish-auth-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No credential</SelectItem>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="token">API token</SelectItem>
                  </SelectContent>
                </Select>
                {authMode === "password" && (
                  <Input
                    size="sm"
                    type="password"
                    placeholder={editMode && existingShare?.has_password ? "Leave blank to keep current password" : "Share password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-label="Share password"
                    data-testid="publish-password"
                    style={{ flex: 1 }}
                  />
                )}
                {authMode === "token" && !generatedToken && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleGenerateToken()}
                    disabled={generatingToken}
                    data-testid="publish-generate-token"
                    style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    {generatingToken ? <Loader2 size={13} className="animate-spin" /> : "Generate token"}
                  </Button>
                )}
              </div>
              {/* Round 7 item 56 — the minted secret, revealed exactly once. */}
              {authMode === "token" && generatedToken && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Input
                    size="sm"
                    readOnly
                    value={generatedToken}
                    aria-label="Generated API token"
                    data-testid="publish-generated-token"
                    style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyToken()} data-testid="publish-copy-token">
                    {tokenCopied ? <Check size={13} /> : <Copy size={13} />}
                    {tokenCopied ? "Copied" : "Copy"}
                  </Button>
                </div>
              )}
              {authMode === "token" && tokenError && (
                <Alert variant="danger" size="sm" style={{ marginTop: 8 }}>
                  {tokenError}
                </Alert>
              )}
            </FormField>

            {/* Round 7 item 60 — always visible: for restricted shares it
                IS the access list; for link shares it holds per-person role
                upgrades (a signed-in grantee outranks the link role). */}
            {(
              <FormField
                label="People"
                hint={
                  generalAccess === "restricted"
                    ? "People sign in with their account email or username to open it."
                    : "Optional per-person roles for signed-in people, above the link's own."
                }
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="publish-grants">
                  {grants.map((g) => (
                    <div key={g.principal} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12.5,
                          color: "var(--color-fg)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {g.principal}
                      </span>
                      <Select
                        value={g.role}
                        onValueChange={(v) =>
                          setGrants((prev) => prev.map((x) => (x.principal === g.principal ? { ...x, role: v as GrantRole } : x)))
                        }
                      >
                        <SelectTrigger size="sm" style={{ width: 110 }} aria-label={`Role for ${g.principal}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Can view</SelectItem>
                          <SelectItem value="editor">Can edit</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${g.principal}`}
                        onClick={() => setGrants((prev) => prev.filter((x) => x.principal !== g.principal))}
                        style={{ flexShrink: 0 }}
                      >
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!draftPrincipal.trim()}
                      onClick={handleAddGrant}
                      data-testid="publish-grant-add"
                      style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </FormField>
            )}

            {error && (
              <Alert variant="danger" size="sm">
                {error}
              </Alert>
            )}
          </div>
        )}

        {result && link && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FormField label="Share link">
              <div style={{ display: "flex", gap: 8 }}>
                <Input size="sm" readOnly value={link} data-testid="publish-result-link" style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" size="sm" variant="secondary" onClick={handleCopy} data-testid="publish-copy-link">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </FormField>
            <div style={{ display: "flex", gap: 6 }}>
              {result.kind === "folder" && (
                <Badge variant="neutral" tone="soft">
                  {result.manifest_count ?? 0} file{result.manifest_count === 1 ? "" : "s"}
                </Badge>
              )}
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
                  API token
                </Badge>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)} data-testid="publish-done">
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={!canSubmit} onClick={handleSubmit} data-testid="publish-submit">
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : editMode && isFolder ? (
                  "Update share"
                ) : editMode ? (
                  "Save"
                ) : (
                  "Publish"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

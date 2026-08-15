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
import { Check, Copy, FileCode, Folder, Globe2, Loader2, Lock } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";
import { CheckboxTree, type CheckboxTreeNode } from "./CheckboxTree";
import { useShareStore, type FolderPublishEntry } from "../../share/useShareStore";
import { validateAlias } from "../../share/alias";
import { buildFolderShareLink, buildShareLink } from "../../share/shareLinks";
import { defaultIncludedSet, flattenFolderTree, includedSetFromManifest, relpathsUnderFolder } from "../../share/folderManifest";
import { getShareManifest } from "../../share/api";
import type { AuthMode, GeneralAccess, RenderMode, ShareOut } from "../../share/api";
import type { FileKind } from "../../types";

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backendBaseUrl: string;
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

const RENDER_MODE_OPTIONS: { value: RenderMode; label: string; icon: React.ReactNode }[] = [
  { value: "raw", label: "Raw", icon: <FileCode size={12} /> },
  { value: "rendered", label: "Rendered", icon: <Globe2 size={12} /> },
];

function canRenderShare(kind: FileKind | undefined): boolean {
  return kind === "md" || kind === "html";
}

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
  backendBaseUrl,
  filePath,
  fileKind,
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
    getShareManifest(backendBaseUrl, existingShare.id)
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
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>(
    () => (existingShare?.general_access as GeneralAccess) ?? "restricted",
  );
  const [authMode, setAuthMode] = useState<AuthMode>(() => (existingShare?.auth_mode as AuthMode) ?? "none");
  const [password, setPassword] = useState("");
  const [alias, setAlias] = useState(() => existingShare?.alias ?? "");
  const [expiresLocal, setExpiresLocal] = useState(() => epochSecondsToDateInput(existingShare?.expires_at));
  const [renderMode, setRenderMode] = useState<RenderMode>(
    () => (existingShare?.render_mode as RenderMode) ?? (canRenderShare(fileKind) ? "rendered" : "raw"),
  );
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [addGrant, setAddGrant] = useState(false);
  const [principal, setPrincipal] = useState("");

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
    (!isFolder || (!manifestLoading && includedCount > 0)) &&
    !submitting;

  async function handleLogin() {
    await login(backendBaseUrl, loginUser, loginPass);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const grants = addGrant && principal.trim() ? [{ principal: principal.trim(), role }] : undefined;
      const policyPatch = {
        alias: alias.trim().length > 0 ? alias.trim() : "",
        expires_at: dateInputToEpochSeconds(expiresLocal) ?? null,
        general_access: generalAccess,
        auth_mode: authMode,
        render_mode: renderMode,
        ...(authMode === "password" && password.length > 0 ? { password } : {}),
        ...(authMode !== "password" ? { clear_password: true } : {}),
      };

      if (isFolder) {
        const includedEntries = (folderEntries ?? []).filter((e) => included.has(e.relpath));
        if (editMode && existingShare) {
          // Policy fields (access/expiry/password/alias/mode) via the same
          // PATCH every share type uses, THEN "Update share" — republish
          // the CURRENT subtree to the same slug (roadmap §5.1).
          await updateShare(backendBaseUrl, existingShare.id, policyPatch);
          const updated = await updateFolderManifest(backendBaseUrl, existingShare.id, includedEntries);
          setResult(updated);
          toast({ title: "Share updated", description: `Republished ${includedEntries.length} file(s).`, variant: "success" });
        } else {
          if (!folderPath) throw new Error("No folder selected to publish.");
          const share = await publishFolder(
            backendBaseUrl,
            {
              sourcePath: folderPath,
              filename: folderName,
              content: "",
              renderMode,
              generalAccess,
              authMode,
              password: authMode === "password" ? password : undefined,
              alias: alias.trim(),
              expiresAt: dateInputToEpochSeconds(expiresLocal),
              grants,
            },
            includedEntries,
          );
          setResult(share);
          toast({ title: "Published", description: `${folderName} (${includedEntries.length} files) is now shared.`, variant: "success" });
        }
      } else if (editMode && existingShare) {
        const updated = await updateShare(backendBaseUrl, existingShare.id, policyPatch);
        setResult(updated);
      } else {
        if (!filePath || content === undefined) throw new Error("No file selected to publish.");
        const share = await publish(backendBaseUrl, {
          sourcePath: filePath,
          filename,
          content,
          renderMode,
          generalAccess,
          authMode,
          password: authMode === "password" ? password : undefined,
          alias: alias.trim(),
          expiresAt: dateInputToEpochSeconds(expiresLocal),
          grants,
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

  const link = result ? (result.kind === "folder" ? buildFolderShareLink(result) : buildShareLink(result, backendBaseUrl)) : null;

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
            Share links need the Slate backend. Start it with <code>npm run server</code> (listens on
            127.0.0.1:8787), or set a different URL in Settings → Sharing.
          </Alert>
        )}

        {!offline && !authenticated && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Alert variant="info" size="sm" title="Sign in to publish">
              Publishing requires an owner session on the backend.
            </Alert>
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
              <Button type="button" size="sm" onClick={handleLogin} disabled={loggingIn} data-testid="publish-login-submit">
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
            <FormField label="General access">
              <Select value={generalAccess} onValueChange={(v) => setGeneralAccess(v as GeneralAccess)}>
                <SelectTrigger size="sm" data-testid="publish-general-access">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="restricted">
                    <Lock size={13} style={{ marginRight: 6 }} /> Restricted — only listed people
                  </SelectItem>
                  <SelectItem value="link">
                    <Globe2 size={13} style={{ marginRight: 6 }} /> Anyone with the link
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="Mode"
              hint={
                isFolder
                  ? "Applies per file — Markdown/HTML render, everything else falls back to raw."
                  : canRenderShare(fileKind)
                    ? undefined
                    : "Rendered mode is only available for Markdown and HTML files."
              }
            >
              <SegmentedControl
                size="sm"
                value={renderMode}
                onChange={setRenderMode}
                aria-label="Render mode"
                options={RENDER_MODE_OPTIONS.map((o) => ({
                  ...o,
                  disabled: o.value === "rendered" && !isFolder && !canRenderShare(fileKind),
                }))}
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
                <FormField label="Expires">
                  <Input
                    size="sm"
                    type="date"
                    value={expiresLocal}
                    onChange={(e) => setExpiresLocal(e.target.value)}
                    aria-label="Expiry date"
                    data-testid="publish-expires"
                  />
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

            <FormField label="Password">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Switch
                  checked={authMode === "password"}
                  onCheckedChange={(checked) => setAuthMode(checked ? "password" : "none")}
                  aria-label="Require a password"
                  data-testid="publish-password-toggle"
                />
                <Input
                  size="sm"
                  type="password"
                  disabled={authMode !== "password"}
                  placeholder={editMode && existingShare?.has_password ? "Leave blank to keep current password" : "Share password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="Share password"
                  data-testid="publish-password"
                  style={{ flex: 1 }}
                />
              </div>
            </FormField>

            <FormField label="Roles" hint="Commenter isn't available yet.">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Switch checked={addGrant} onCheckedChange={setAddGrant} aria-label="Add a per-principal role" />
                <Input
                  size="sm"
                  disabled={!addGrant}
                  placeholder="email or username"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  aria-label="Principal"
                  style={{ flex: 1, minWidth: 160 }}
                />
                <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "editor")}>
                  <SelectTrigger size="sm" disabled={!addGrant} style={{ width: 130 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="neutral" tone="soft">
                  Commenter — later
                </Badge>
              </div>
            </FormField>

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
                {result.render_mode}
              </Badge>
              <Badge variant={result.general_access === "link" ? "primary" : "neutral"} tone="soft">
                {result.general_access === "link" ? "Anyone with the link" : "Restricted"}
              </Badge>
              {result.auth_mode === "password" && (
                <Badge variant="warning" tone="soft">
                  Password
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

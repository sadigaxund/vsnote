/**
 * VaultSetupPanel — Settings → Git & Sync's server-vault surface (Phase 17
 * Milestone C2, `docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 17 section: "Git &
 * Sync renders as a SETUP WIZARD when no repo exists ... all in UI, no CLI
 * ever"). Lives INSIDE the existing "Git & Sync" category as one more row
 * (`SettingsView.tsx`'s `server-vault` row) — never a modal, never a new
 * route, same placement precedent `SharedPanel.tsx` set for the "Sharing"
 * category.
 *
 * Two shapes, driven by `git/vaultWizard.ts::deriveVaultWizardPhase` (pure,
 * unit-tested):
 *  - `initialized: false` — a stepped setup wizard: step 1 creates the vault
 *    repo (`POST /api/vault/init`), step 2 optionally connects one external
 *    mirror remote, both skippable/composable with the management surface
 *    below (step 2 reuses the exact same remote-add dialog the management
 *    surface uses — one implementation, not two).
 *  - `initialized: true` — no wizard at all (DESIGN-SPEC rule, verbatim):
 *    the real server-reported vault state (path, mounted vs legacy shape,
 *    branch, last commit, working-tree dirtiness) plus the mirror-remotes
 *    management table (add/edit/replace credential/clear credential/
 *    delete/test/mirror now).
 *
 * Pure composition — `Alert`/`Badge`/`Button`/`ConfirmDialog`/`DataList`/
 * `Dialog`/`FormField`/`Input`/`Select`/`Skeleton`/`Switch`/`Table`/
 * `Textarea`/`Tooltip`/`useToast` from `my-you-eye`, same "solved by
 * composition" precedent `docs/COMPONENT-BACKLOG.md`'s Notes section
 * already records for `SharedPanel`/`PublishDialog` — no new local
 * primitive needed, so this file gets no backlog table row of its own
 * (added to that Notes section instead).
 *
 * **Credentials never round-trip back into this component's own state.**
 * The add/edit dialog's `sshKeyDraft`/`httpsTokenDraft` are local `useState`
 * inside `RemoteDialog`, reset to `""` every time the dialog closes
 * (submit OR cancel) and NEVER initialized from `editingRemote` (which has
 * no such fields to read — see `share/vaultApi.ts`'s module doc). What
 * `useVaultStore`'s `remotes` array holds is only ever a `VaultRemoteOut` —
 * `credential_kind` + a fingerprint/last-4 display hint, never the secret
 * itself.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataList,
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
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  useToast,
} from "my-you-eye";
import { Loader2, Pencil, PlugZap, RefreshCw, Server, Trash2 } from "lucide-react";
import { DEFAULT_BRANCH } from "../../git/client";
import { deriveVaultWizardPhase, hasVaultBranchMismatch } from "../../git/vaultWizard";
import { useGitStore } from "../../stores/useGitStore";
import {
  describeMirrorRunResult,
  describeMirrorStatus,
  mirrorStatusTone,
  remoteTestTone,
  validateCredentialFields,
  validateMirrorRemoteName,
  validateMirrorRemoteUrl,
} from "../../git/vaultRemotes";
import { useShareStore } from "../../share/useShareStore";
import { useVaultStore } from "../../stores/useVaultStore";
import type { RemoteCredentialKind, VaultRemoteCreateIn, VaultRemoteOut } from "../../share/vaultApi";

export interface VaultSetupPanelProps {
  /** Settings → Git & Sync's own "Repository name" (`useSettingsStore`'s
   * `gitRepoName`) — compared against the server's authoritative
   * `vault.repo_name` so a mismatch is shown explicitly instead of silently
   * talking past each other (task requirement: "show it and make clear
   * which value wins"). */
  clientRepoName: string;
}

type CredentialAction = "keep" | "none" | "ssh_key" | "https_token" | "clear";

function formatEpoch(epoch: number | null | undefined): string {
  if (!epoch) return "Never";
  return new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function credentialSummary(remote: VaultRemoteOut): string {
  if (remote.credential_kind === "ssh_key") {
    return remote.credential_fingerprint ? `SSH key (${remote.credential_fingerprint})` : "SSH key";
  }
  if (remote.credential_kind === "https_token") {
    return remote.credential_last4 ? `Token ending ${remote.credential_last4}` : "Token";
  }
  return "No credential";
}

interface RemoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = creating a new remote; set = editing this one. */
  editingRemote: VaultRemoteOut | null;
  onSaved: () => void;
}

/** Mounted ONLY while open (`RemotesTable` below renders `{dialogOpen &&
 * <RemoteDialog ... />}`, the exact "unmounts on close, remounts fresh on
 * every open" pattern `PublishDialog.tsx` already uses for the same
 * reason) — so every `useState` here can be a plain lazy initializer
 * instead of an effect that would otherwise have to set state on every
 * open, which is exactly the "setState synchronously within an effect"
 * anti-pattern `react-hooks/set-state-in-effect` flags. The credential
 * fields ALWAYS start blank/"keep" regardless of what's being edited, per
 * this file's module doc — there is nothing to read them FROM anyway
 * (`VaultRemoteOut` has no such fields). */
function RemoteDialog({ open, onOpenChange, editingRemote, onSaved }: RemoteDialogProps) {
  const { toast } = useToast();
  const createRemote = useVaultStore((s) => s.createRemote);
  const patchRemote = useVaultStore((s) => s.patchRemote);

  const [name, setName] = useState(() => editingRemote?.name ?? "");
  const [url, setUrl] = useState(() => editingRemote?.url ?? "");
  const [enabled, setEnabled] = useState(() => editingRemote?.enabled ?? true);
  const [pushOnReceive, setPushOnReceive] = useState(() => editingRemote?.push_on_receive ?? true);
  const [credentialAction, setCredentialAction] = useState<CredentialAction>(editingRemote ? "keep" : "none");
  const [sshKeyDraft, setSshKeyDraft] = useState("");
  const [httpsTokenDraft, setHttpsTokenDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = validateMirrorRemoteName(name);
  const urlError = validateMirrorRemoteUrl(url);
  const credentialKindForValidation: RemoteCredentialKind =
    credentialAction === "keep" || credentialAction === "clear" ? "none" : credentialAction;
  const credentialError =
    credentialAction === "ssh_key" || credentialAction === "https_token"
      ? validateCredentialFields(credentialKindForValidation, sshKeyDraft, httpsTokenDraft)
      : null;

  async function handleSubmit() {
    if (nameError || urlError || credentialError) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingRemote) {
        const payload: Parameters<typeof patchRemote>[1] = { name, url, enabled, push_on_receive: pushOnReceive };
        if (credentialAction === "clear") {
          payload.clear_credential = true;
        } else if (credentialAction === "ssh_key" || credentialAction === "https_token") {
          payload.credential_kind = credentialAction;
          if (credentialAction === "ssh_key") payload.ssh_private_key = sshKeyDraft;
          if (credentialAction === "https_token") payload.https_token = httpsTokenDraft;
        }
        const result = await patchRemote(editingRemote.id, payload);
        if (!result) {
          setError(useVaultStore.getState().remotesError ?? "Could not save the remote.");
          return;
        }
      } else {
        const payload: VaultRemoteCreateIn = { name, url, enabled, push_on_receive: pushOnReceive, credential_kind: "none" };
        if (credentialAction === "ssh_key" || credentialAction === "https_token") {
          payload.credential_kind = credentialAction;
          if (credentialAction === "ssh_key") payload.ssh_private_key = sshKeyDraft;
          if (credentialAction === "https_token") payload.https_token = httpsTokenDraft;
        }
        const result = await createRemote(payload);
        if (!result) {
          setError(useVaultStore.getState().remotesError ?? "Could not add the remote.");
          return;
        }
      }
      // Clear the credential draft the instant the round trip settles,
      // success or failure — a submitted key/token never lingers in this
      // component's state one tick longer than the outgoing request needed
      // it.
      setSshKeyDraft("");
      setHttpsTokenDraft("");
      toast({ title: editingRemote ? "Remote updated" : "Remote added", variant: "success" });
      onSaved();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="vault-remote-dialog">
        <DialogHeader>
          <DialogTitle>{editingRemote ? "Edit mirror remote" : "Add a mirror remote"}</DialogTitle>
          <DialogDescription>
            Keys and tokens stay on the server. This app never stores or shows one back to you.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormField label="Name" error={name ? nameError ?? undefined : undefined}>
            <Input
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GitHub backup"
              aria-label="Remote name"
              aria-invalid={Boolean(name && nameError)}
              data-testid="vault-remote-name"
            />
          </FormField>
          <FormField label="URL" hint="https, ssh, or a scp-like git@host:path form." error={url ? urlError ?? undefined : undefined}>
            <Input
              size="sm"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="git@github.com:you/notes.git"
              aria-label="Remote URL"
              aria-invalid={Boolean(url && urlError)}
              data-testid="vault-remote-url"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </FormField>
          <FormField label="Enabled" hint="Off pauses this remote without deleting it.">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Remote enabled" data-testid="vault-remote-enabled" />
          </FormField>
          <FormField label="Mirror on every push" hint="Automatically mirrors right after a client push lands in the vault.">
            <Switch
              checked={pushOnReceive}
              onCheckedChange={setPushOnReceive}
              aria-label="Mirror on every push"
              data-testid="vault-remote-push-on-receive"
            />
          </FormField>
          <FormField label="Credential">
            <Select value={credentialAction} onValueChange={(v) => setCredentialAction(v as CredentialAction)}>
              <SelectTrigger size="sm" data-testid="vault-remote-credential-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editingRemote && <SelectItem value="keep">Keep current credential</SelectItem>}
                {!editingRemote && <SelectItem value="none">No credential</SelectItem>}
                <SelectItem value="ssh_key">SSH private key</SelectItem>
                <SelectItem value="https_token">HTTPS access token</SelectItem>
                {editingRemote && <SelectItem value="clear">Remove credential</SelectItem>}
              </SelectContent>
            </Select>
          </FormField>
          {credentialAction === "ssh_key" && (
            <FormField label="SSH private key" hint="Pasted once, sent straight to the server, never shown again." error={credentialError ?? undefined}>
              <Textarea
                rows={5}
                value={sshKeyDraft}
                onChange={(e) => setSshKeyDraft(e.target.value)}
                placeholder="OpenSSH private key, pasted once and never stored by this app"
                aria-label="SSH private key"
                aria-invalid={Boolean(sshKeyDraft && credentialError)}
                data-testid="vault-remote-ssh-key"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
            </FormField>
          )}
          {credentialAction === "https_token" && (
            <FormField label="Access token" hint="Sent straight to the server, never shown again." error={credentialError ?? undefined}>
              <Input
                size="sm"
                type="password"
                value={httpsTokenDraft}
                onChange={(e) => setHttpsTokenDraft(e.target.value)}
                placeholder="ghp_••••••••••••••••"
                aria-label="Access token"
                aria-invalid={Boolean(httpsTokenDraft && credentialError)}
                data-testid="vault-remote-https-token"
              />
            </FormField>
          )}
          {error && (
            <Alert variant="danger" size="sm">
              {error}
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || !!nameError || !!urlError || !!credentialError}
            data-testid="vault-remote-submit"
            onClick={() => void handleSubmit()}
          >
            {submitting ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : editingRemote ? "Save" : "Add remote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RemotesTableProps {
  compact?: boolean;
}

function RemotesTable({ compact }: RemotesTableProps) {
  const { toast } = useToast();
  const remotes = useVaultStore((s) => s.remotes);
  const remotesLoading = useVaultStore((s) => s.remotesLoading);
  const remotesError = useVaultStore((s) => s.remotesError);
  const pendingRemoteIds = useVaultStore((s) => s.pendingRemoteIds);
  const testResults = useVaultStore((s) => s.testResults);
  const fetchRemotes = useVaultStore((s) => s.fetchRemotes);
  const deleteRemote = useVaultStore((s) => s.deleteRemote);
  const patchRemote = useVaultStore((s) => s.patchRemote);
  const mirrorNow = useVaultStore((s) => s.mirrorNow);
  const testRemote = useVaultStore((s) => s.testRemote);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRemote, setEditingRemote] = useState<VaultRemoteOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultRemoteOut | null>(null);
  const [clearTarget, setClearTarget] = useState<VaultRemoteOut | null>(null);

  useEffect(() => {
    void fetchRemotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="vault-remotes-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)" }}>Mirror remotes</span>
        <div style={{ display: "flex", gap: 6 }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => void fetchRemotes()}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="vault-remote-add"
            onClick={() => {
              setEditingRemote(null);
              setDialogOpen(true);
            }}
          >
            Add remote
          </Button>
        </div>
      </div>

      {remotesError && (
        <Alert variant="danger" size="sm">
          {remotesError}
        </Alert>
      )}

      {remotesLoading && remotes.length === 0 ? (
        <Skeleton height={compact ? "60px" : "90px"} />
      ) : remotes.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
          No external remotes yet. The vault only lives on this server until you add one.
        </p>
      ) : (
        // Round 7 item 51 — a refresh (the button above, or a create/edit/
        // delete's own refetch) keeps this table mounted and dims it
        // rather than swapping to the skeleton above, which is reserved
        // for the genuinely-empty first load.
        <div
          style={{ overflowX: "auto", opacity: remotesLoading ? 0.55 : 1, transition: "opacity var(--motion-duration-base) ease" }}
          aria-busy={remotesLoading}
        >
          <Table data-testid="vault-remotes-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {remotes.map((remote) => {
                const pending = pendingRemoteIds.has(remote.id);
                const testResult = testResults[remote.id];
                return (
                  <TableRow key={remote.id} data-testid={`vault-remote-row-${remote.id}`}>
                    <TableCell>
                      {remote.name}
                      {!remote.enabled && (
                        <Badge variant="neutral" tone="soft" style={{ marginLeft: 6 }}>
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{remote.url}</TableCell>
                    <TableCell style={{ fontSize: 12 }}>{credentialSummary(remote)}</TableCell>
                    <TableCell>
                      <Badge variant={mirrorStatusTone(remote.last_status)} tone="soft">
                        {describeMirrorStatus(remote.last_status, remote.last_error)}
                      </Badge>
                      {testResult && (
                        <div style={{ marginTop: 4 }}>
                          <Badge variant={remoteTestTone(testResult.outcome)} tone="soft" data-testid={`vault-remote-test-result-${remote.id}`}>
                            {testResult.message}
                          </Badge>
                        </div>
                      )}
                    </TableCell>
                    <TableCell style={{ fontSize: 12 }}>{formatEpoch(remote.last_mirror_at)}</TableCell>
                    <TableCell align="right">
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Tooltip content="Test connection" side="top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Test connection"
                            disabled={pending}
                            data-testid={`vault-remote-test-${remote.id}`}
                            onClick={() => void testRemote(remote.id)}
                          >
                            {pending ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : <PlugZap size={13} />}
                          </Button>
                        </Tooltip>
                        <Tooltip content="Mirror now" side="top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Mirror now"
                            disabled={pending}
                            data-testid={`vault-remote-mirror-${remote.id}`}
                            onClick={() =>
                              void mirrorNow(remote.id).then((result) => {
                                if (result) toast({ title: describeMirrorRunResult(result.status, result.message), variant: result.status === "success" ? "success" : "danger" });
                              })
                            }
                          >
                            {pending ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : <Server size={13} />}
                          </Button>
                        </Tooltip>
                        <Tooltip content="Edit" side="top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit remote"
                            data-testid={`vault-remote-edit-${remote.id}`}
                            onClick={() => {
                              setEditingRemote(remote);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil size={13} />
                          </Button>
                        </Tooltip>
                        {remote.credential_kind !== "none" && (
                          <Tooltip content="Clear credential" side="top">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Clear credential"
                              data-testid={`vault-remote-clear-credential-${remote.id}`}
                              onClick={() => setClearTarget(remote)}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content="Delete" side="top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete remote"
                            data-testid={`vault-remote-delete-${remote.id}`}
                            onClick={() => setDeleteTarget(remote)}
                          >
                            <Trash2 size={13} color="var(--color-danger)" />
                          </Button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogOpen && (
        <RemoteDialog open={dialogOpen} onOpenChange={setDialogOpen} editingRemote={editingRemote} onSaved={() => void fetchRemotes()} />
      )}

      <ConfirmDialog
        title="Delete this mirror remote?"
        description={deleteTarget ? `"${deleteTarget.name}" will stop mirroring. This deletes its stored credential too and can't be undone.` : undefined}
        confirmLabel="Delete"
        destructive
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          setDeleteTarget(null);
          void deleteRemote(target.id).then((ok) => {
            if (ok) toast({ title: "Remote deleted", variant: "success" });
          });
        }}
      />

      <ConfirmDialog
        title="Clear this remote's credential?"
        description={clearTarget ? `"${clearTarget.name}" will need a new key or token before it can mirror again. This can't be undone.` : undefined}
        confirmLabel="Clear credential"
        destructive
        open={clearTarget !== null}
        onOpenChange={(open) => !open && setClearTarget(null)}
        onConfirm={() => {
          if (!clearTarget) return;
          const target = clearTarget;
          setClearTarget(null);
          void patchRemote(target.id, { clear_credential: true }).then((ok) => {
            if (ok) toast({ title: "Credential cleared", variant: "success" });
          });
        }}
      />
    </div>
  );
}

export function VaultSetupPanel({ clientRepoName }: VaultSetupPanelProps) {
  const { toast } = useToast();
  const reachability = useShareStore((s) => s.reachability);
  const authenticated = useShareStore((s) => s.authenticated);

  // Targeted selector (the discipline every store read in this app follows):
  // only the branch name, so a commit/status refresh that leaves the branch
  // alone never re-renders this panel.
  const clientBranch = useGitStore((s) => s.branch);

  const vault = useVaultStore((s) => s.vault);
  const vaultLoading = useVaultStore((s) => s.vaultLoading);
  const vaultError = useVaultStore((s) => s.vaultError);
  const initializing = useVaultStore((s) => s.initializing);
  const fetchVault = useVaultStore((s) => s.fetchVault);
  const initVault = useVaultStore((s) => s.initVault);

  const [branchDraft, setBranchDraft] = useState(DEFAULT_BRANCH);
  const [awaitingRemoteStep, setAwaitingRemoteStep] = useState(false);

  const ready = reachability === "online" && authenticated;

  useEffect(() => {
    if (ready) void fetchVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (reachability === "offline") {
    return (
      <Alert variant="warning" size="sm" data-testid="vault-panel-offline">
        Backend not running. Start it with <code>npm run server</code> to set up the server vault.
      </Alert>
    );
  }
  if (reachability !== "online") {
    return <Skeleton height="40px" data-testid="vault-panel-checking" />;
  }
  if (!authenticated) {
    return (
      <Alert variant="note" size="sm" data-testid="vault-panel-signed-out">
        Sign in under Sharing to set up and manage the server vault.
      </Alert>
    );
  }
  if (vaultLoading && !vault) {
    return <Skeleton height="90px" data-testid="vault-panel-loading" />;
  }
  if (vaultError && !vault) {
    return (
      <Alert variant="danger" size="sm" data-testid="vault-panel-error">
        {vaultError}
        <Button type="button" variant="ghost" size="sm" style={{ marginLeft: 8 }} onClick={() => void fetchVault()}>
          Retry
        </Button>
      </Alert>
    );
  }
  if (!vault) return null;

  const phase = deriveVaultWizardPhase({ vaultInitialized: vault.initialized, awaitingRemoteStep });
  const repoNameMismatch = clientRepoName.trim() !== "" && clientRepoName.trim() !== vault.repo_name;
  // Only meaningful for the mounted shape: a bare vault has no working tree
  // to fall out of step in the first place (see hasVaultBranchMismatch).
  const branchMismatch = vault.mounted && hasVaultBranchMismatch(clientBranch, vault.head_branch);

  if (phase === "create") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="vault-wizard-create">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)", margin: 0 }}>Step 1 of 2: Create the vault repository</p>
        <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: 0 }}>
          Sync and sharing need a server-side git repo to talk to. This creates it at <code>{vault.path}</code>. An existing repository there is never overwritten.
        </p>
        <FormField label="Branch name" hint="The vault's default branch. Matches this app's own default unless you change it.">
          <Input
            size="sm"
            value={branchDraft}
            onChange={(e) => setBranchDraft(e.target.value)}
            aria-label="Vault branch name"
            data-testid="vault-init-branch"
            style={{ width: 260, fontFamily: "var(--font-mono)" }}
          />
        </FormField>
        <Button
          type="button"
          size="sm"
          style={{ alignSelf: "flex-start" }}
          disabled={initializing || !branchDraft.trim()}
          data-testid="vault-init-submit"
          onClick={() =>
            void initVault(branchDraft.trim()).then((result) => {
              if (result) {
                toast({ title: "Vault created", variant: "success" });
                setAwaitingRemoteStep(true);
              }
            })
          }
        >
          {initializing ? <span style={{ display: "inline-flex" }}><Loader2 size={13} className="animate-spin" /></span> : "Create vault"}
        </Button>
        {vaultError && (
          <Alert variant="danger" size="sm">
            {vaultError}
          </Alert>
        )}
      </div>
    );
  }

  if (phase === "connect-remote") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="vault-wizard-remote">
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)", margin: 0 }}>Step 2 of 2: Connect an external remote</p>
        <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: 0 }}>
          Optional. Mirrors the vault to GitHub, GitLab, or anywhere else over SSH or HTTPS. Skip this and add one later any time.
        </p>
        <RemotesTable compact />
        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" variant="ghost" size="sm" data-testid="vault-wizard-skip-remote" onClick={() => setAwaitingRemoteStep(false)}>
            Skip for now
          </Button>
          <Button type="button" variant="secondary" size="sm" data-testid="vault-wizard-finish-remote" onClick={() => setAwaitingRemoteStep(false)}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="vault-management">
      <div data-testid="vault-status">
        <DataList
          items={[
            { label: "Server path", value: vault.path },
            { label: "Shape", value: vault.mounted ? "Mounted (real working tree)" : "Legacy (bare repo)" },
            { label: "Branch", value: vault.head_branch ?? "None yet" },
            // Short label on purpose: the library's DataList truncates a
            // longer one mid-word (seen in verification), and this row's
            // meaning is already carried by the panel's heading.
            { label: "Server repo name", value: vault.repo_name },
            { label: "Last commit", value: vault.last_commit_message ?? "No commits yet" },
            { label: "Last commit time", value: formatEpoch(vault.last_commit_time) },
            ...(vault.mounted ? [{ label: "Working tree", value: vault.worktree_dirty ? "Has uncommitted changes on disk" : "Clean" }] : []),
          ]}
          density="compact"
        />
      </div>
      {repoNameMismatch && (
        <Alert variant="warning" size="sm" data-testid="vault-repo-name-mismatch">
          Settings' "Repository name" is "{clientRepoName.trim()}", but this server vault is "{vault.repo_name}". Sync uses the
          Repository name field above, not this value, so a mismatch means Sync is not talking to this vault.
        </Alert>
      )}
      {branchMismatch && (
        <Alert variant="warning" size="sm" data-testid="vault-branch-mismatch">
          The server's files show "{vault.head_branch}" while you sync "{clientBranch}", so your pushes stay invisible on disk.
        </Alert>
      )}
      <RemotesTable />
    </div>
  );
}

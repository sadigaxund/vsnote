/**
 * SharedPanel — the owner's "Shared" management panel (roadmap §1: "Owner
 * sees a 'Shared' panel listing all active shares — audit: created, last
 * accessed, hit count"). Lives inside `SettingsView.tsx`'s new "Sharing"
 * category rather than a new activity-bar icon: this app's Settings is
 * already a real full-width tab (Phase 6.5c), the share list is
 * account-level configuration exactly like "Git & Sync", and adding a
 * fifth activity-bar icon would need its own `SidebarContainer` region +
 * width/collapse plumbing for a view that's fundamentally a list + actions,
 * not a persistent always-visible panel — see this phase's final report for
 * the full placement rationale.
 *
 * Pure composition — `Table`/`TableHeader`/`TableBody`/`TableRow`/
 * `TableHead`/`TableCell` ("reach for `Table` directly when you need
 * bespoke markup a data-driven API can't express" — `DataTable` has no row
 * click/actions slot, checked in `skills/components.json`), `Badge`,
 * `Button`, `Tooltip`, `ConfirmDialog`, `EmptyState`, `Skeleton`. No new
 * local primitive — not logged in `docs/COMPONENT-BACKLOG.md` for the same
 * "solved by composition" reason as `ExtensionsPanel.tsx`.
 *
 * Round 7 item 51 — a refresh (the "Refresh" button, or the mount-time
 * fetch re-running) keeps the table mounted and dims it (`aria-busy` +
 * reduced opacity) rather than swapping to a skeleton or `EmptyState`;
 * data swaps in place once the fetch resolves. The full-replace `Skeleton`
 * is reserved for the FIRST load only (`sharesLoading` true with nothing
 * fetched yet) — same split `VaultSetupPanel.tsx`'s `RemotesTable` already
 * uses for its mirror-remotes table.
 */
import { useEffect, useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, useToast } from "my-you-eye";
import { Copy, FileText, Folder, Pencil, RefreshCcw, RotateCw, Share2, Trash2 } from "lucide-react";
import { useShareStore } from "../../share/useShareStore";
import { buildFolderShareLink, buildShareLink } from "../../share/shareLinks";
import type { ShareOut } from "../../share/api";

export interface SharedPanelProps {
  authenticated: boolean;
  onEditShare: (share: ShareOut) => void;
}

function formatEpoch(epoch: number | null | undefined): string {
  if (!epoch) return "Never";
  return new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SharedPanel({ authenticated, onEditShare }: SharedPanelProps) {
  const { toast } = useToast();
  const shares = useShareStore((s) => s.shares);
  const loading = useShareStore((s) => s.sharesLoading);
  const error = useShareStore((s) => s.sharesError);
  const refreshShares = useShareStore((s) => s.refreshShares);
  const revoke = useShareStore((s) => s.revoke);
  const regenerate = useShareStore((s) => s.regenerate);
  const [revokeTarget, setRevokeTarget] = useState<ShareOut | null>(null);

  useEffect(() => {
    if (authenticated) void refreshShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  if (!authenticated) {
    return (
      <EmptyState
        icon={<Share2 size={20} />}
        title="Sign in to see your shares"
        description="Shares are tied to your backend owner account."
      />
    );
  }

  const active = shares.filter((s) => !s.revoked_at);

  async function handleCopy(share: ShareOut) {
    try {
      const link = share.kind === "folder" ? buildFolderShareLink(share) : buildShareLink(share);
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", variant: "success" });
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: "Clipboard access was denied. Select the link in the table and copy it manually.",
        variant: "danger",
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="shared-panel">
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => refreshShares()} data-testid="shared-refresh">
          <RefreshCcw size={13} /> Refresh
        </Button>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, color: "var(--color-danger)" }}>{error}</p>
      )}

      {loading && active.length === 0 ? (
        <Skeleton height="160px" data-testid="shared-panel-loading" />
      ) : !loading && active.length === 0 ? (
        <EmptyState icon={<Share2 size={20} />} title="No shares yet" description="Publish a file to see it listed here." />
      ) : (
        <div
          style={{ overflowX: "auto", opacity: loading ? 0.55 : 1, transition: "opacity var(--motion-duration-base) ease" }}
          aria-busy={loading}
        >
          <Table data-testid="shared-table">
            <TableHeader>
              <TableRow>
                {/* Phase 10.5 — kind (file/folder) is its own leading
                    column rather than folded into "Source": a folder
                    share's source_path alone doesn't visually distinguish
                    it from a deeply-nested file path. */}
                <TableHead>Kind</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead align="right">
                  {/* Round 7 item 59 — "if some access paths are
                      deliberately uncounted, the panel copy says what
                      counts as a hit" (DESIGN-SPEC). Browsing further
                      inside an already-open share (another file, a
                      subfolder) doesn't add a second hit for that same
                      visit — see server/app/routers/share_public.py's
                      `_is_share_followup_request` for the mechanism. */}
                  <Tooltip content="Counts each time the share page is opened, not each file viewed inside it." side="top">
                    <span>Hits</span>
                  </Tooltip>
                </TableHead>
                <TableHead>Last accessed</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((share) => (
                <TableRow key={share.id} data-testid={`shared-row-${share.id}`}>
                  <TableCell data-testid={`shared-kind-${share.id}`}>
                    <Tooltip content={share.kind === "folder" ? `Folder (${share.manifest_count ?? 0} files)` : "File"} side="top">
                      <span style={{ display: "inline-flex", alignItems: "center", color: "var(--color-muted)" }}>
                        {share.kind === "folder" ? <Folder size={14} /> : <FileText size={14} />}
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{share.source_path}</TableCell>
                  <TableCell style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{share.alias ?? share.slug}</TableCell>
                  <TableCell>
                    <Badge variant="neutral" tone="soft">
                      {share.render_mode}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={share.general_access === "link" ? "primary" : "neutral"} tone="soft">
                      {share.general_access === "link" ? "Anyone with the link" : "Restricted"}
                    </Badge>
                    {share.auth_mode === "password" && (
                      <Badge variant="warning" tone="soft" style={{ marginLeft: 6 }}>
                        Password
                      </Badge>
                    )}
                    {share.auth_mode === "token" && (
                      <Badge variant="warning" tone="soft" style={{ marginLeft: 6 }}>
                        API token
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatEpoch(share.expires_at)}</TableCell>
                  <TableCell align="right" data-testid={`shared-hits-${share.id}`}>
                    {share.hit_count}
                  </TableCell>
                  <TableCell>{formatEpoch(share.last_access_at)}</TableCell>
                  <TableCell align="right">
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <Tooltip content="Copy link" side="top">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Copy link" onClick={() => handleCopy(share)}>
                          <Copy size={13} />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Edit policy" side="top">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit policy" onClick={() => onEditShare(share)}>
                          <Pencil size={13} />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Regenerate link" side="top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Regenerate link"
                          onClick={async () => {
                            await regenerate(share.id);
                            toast({ title: "Link regenerated", variant: "success" });
                          }}
                        >
                          <RotateCw size={13} />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Revoke" side="top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Revoke"
                          data-testid={`shared-revoke-${share.id}`}
                          onClick={() => setRevokeTarget(share)}
                        >
                          <Trash2 size={13} color="var(--color-danger)" />
                        </Button>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        title="Revoke this share?"
        description={revokeTarget ? `"${revokeTarget.source_path}" will stop resolving immediately. This can't be undone.` : undefined}
        confirmLabel="Revoke"
        destructive
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={() => {
          if (!revokeTarget) return;
          const target = revokeTarget;
          setRevokeTarget(null);
          void revoke(target.id).then(() => toast({ title: "Share revoked", variant: "success" }));
        }}
      />
    </div>
  );
}

/**
 * Shared view — the owner's share-management surface (docs/PLAN-2026-09-05-
 * refresh.md §2 + roadmap §5.1's owner-affordances bullet), replacing
 * `SettingsView.tsx`'s old "Shared" row inside its Sharing category
 * (`local/SharedPanel.tsx`, deleted this pass) — Settings now keeps only
 * sharing DEFAULTS (backend sign-in, admin blob limit).
 *
 * **A full-width TAB, not a sidebar panel — course-corrected during this
 * pass's own screenshot review.** The first version rendered inside the
 * shared `local/SidebarContainer` region (same shell as Explorer/Search/
 * Source Control/Extensions). At `DEFAULT_SIDEBAR_WIDTH` (288px, sized for
 * a file tree) a table with source/link/access/links/hits/last-accessed
 * columns was genuinely unusable: headers overlapped and every cell
 * collapsed to a bare truncation chevron with no readable value — confirmed
 * with real screenshots, not assumed. Widening the region (even past 600px)
 * still left every cell truncated, because the region caps at half the
 * window width and a REAL owner audit table needs more room than a side
 * rail can offer at any width a user would tolerate keeping permanently
 * open. `ARCHITECTURE.md`'s original reasoning for putting sharing inside
 * Settings ("Settings is already a real full-width tab... the share list
 * is a list plus actions, not a persistent always-visible panel") still
 * holds — what changed is only that it deserves its OWN entry point
 * (`ActivityBar.tsx`'s "Shared" icon) rather than living inside Settings.
 * So: the activity-bar icon stays, but it opens a tab
 * (`lib/sharedTab.ts::SHARED_TAB_PATH`, `App.tsx`'s `handleOpenShared`,
 * `EditorContent.tsx`'s `kind === "shared"` branch — the exact same
 * "virtual tab, not a real fs path" plumbing `SETTINGS_TAB_PATH` already
 * uses) instead of toggling the sidebar region.
 *
 * `DataTable` (`renderActions`/`onRowClick`, my-you-eye 2026.8.3, upstream
 * #25 — `docs/COMPONENT-BACKLOG.md` §2.1) replaces the hand-rolled
 * `Table`/`TableRow` markup `SharedPanel` used before those props existed.
 * Fixed column widths, a truncated link with its own copy button, relative
 * dates (`lib/relativeTime.ts`), and a trailing overflow-menu actions
 * column (`DropdownMenu`) — no bespoke table markup left to hand-roll.
 *
 * DESIGN-SPEC item 51 (no flash on refresh): the table stays mounted and
 * dims (`aria-busy` + reduced opacity) while a refresh is in flight; only
 * the FIRST load (nothing fetched yet) shows the full `Skeleton` swap.
 *
 * Links-to/linked-from counts (§5): computed client-side from the vault's
 * OWN file contents (`fs/operations.ts::readTextFile`) via
 * `share/shareLinkGraph.ts` — the server's `links` map is public-reader-
 * only (`ShareContentOut.links`, resolved per visitor request); the owner
 * view has direct vault access and doesn't need a second server endpoint
 * for the same computation.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ScrollArea,
  Skeleton,
  Tooltip,
  type DataTableColumn,
} from "my-you-eye";
import { useToast } from "./local/useToast";
import { Copy, KeyRound, MoreHorizontal, Pencil, RefreshCcw, RotateCw, Share2, Trash2, UploadCloud, X } from "lucide-react";
import { useShareStore } from "../share/useShareStore";
import { buildShareLink } from "../share/shareLinks";
import { formatRelativeEpochSeconds } from "../lib/relativeTime";
import { computeShareLinkCounts, type ShareLinkCounts } from "../share/shareLinkGraph";
import { computeShareFreshness, type ShareFreshness } from "../share/contentHash";
import { readTextFile } from "../fs/operations";
import { displayToFsPath } from "../fs/paths";
import { listShareTokens, revokeShareToken } from "../share/api";
import type { ShareOut, ShareTokenOut } from "../share/api";
import { lazyWithReload } from "../lib/lazyWithReload";

// Lazy, matching every other overlay import in this app (`App.tsx`'s own
// `PublishDialog` instance) — most sessions open Shared without ever
// clicking "Edit policy…". `lazyWithReload` (fix(pwa)): self-heals a stale
// tab whose service worker activated a new build out from under it.
const PublishDialog = lazyWithReload(() => import("./local/PublishDialog").then((m) => ({ default: m.PublishDialog })));

export function SharedView() {
  const { toast } = useToast();
  const authenticated = useShareStore((s) => s.authenticated);
  const shares = useShareStore((s) => s.shares);
  const loading = useShareStore((s) => s.sharesLoading);
  const error = useShareStore((s) => s.sharesError);
  const refreshShares = useShareStore((s) => s.refreshShares);
  const revoke = useShareStore((s) => s.revoke);
  const regenerate = useShareStore((s) => s.regenerate);
  const updateShareContent = useShareStore((s) => s.updateShareContent);

  const [revokeTarget, setRevokeTarget] = useState<ShareOut | null>(null);
  const [editingShare, setEditingShare] = useState<ShareOut | null>(null);
  const [tokenShare, setTokenShare] = useState<ShareOut | null>(null);
  const [tokens, setTokens] = useState<ShareTokenOut[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [linkCounts, setLinkCounts] = useState<Map<number, ShareLinkCounts>>(new Map());
  // R5-6 — per-share freshness (fresh/stale/missing), recomputed whenever
  // the active set OR any share's pinned `blob_id` changes (an "Update
  // share" swaps `blob_id` without touching `active`'s id list, so the
  // effect below keys on both — see the dependency array's comment).
  const [freshness, setFreshness] = useState<Map<number, ShareFreshness>>(new Map());
  const [updatingShareId, setUpdatingShareId] = useState<number | null>(null);
  // R5-6 — the `id:blob_id` dependency key below only changes when a
  // share's PINNED snapshot changes (an "Update share"). Editing the vault
  // FILE itself changes nothing about the share record, so a plain
  // content edit needs its own trigger to re-hash and pick up the drift —
  // "Refresh" is the natural place for it (it already means "re-derive
  // everything shown"), bumped alongside its existing `refreshShares()`
  // call below.
  const [freshnessRefreshNonce, setFreshnessRefreshNonce] = useState(0);

  useEffect(() => {
    if (authenticated) void refreshShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const active = useMemo(() => shares.filter((s) => !s.revoked_at), [shares]);

  // Recomputed whenever the active share set changes — best-effort, never
  // blocks the table (a share whose file fails to load just contributes
  // zero links, see `shareLinkGraph.ts`'s doc). The actual `setLinkCounts`
  // calls live inside `.then()` callbacks (always allowed by
  // `react-hooks/set-state-in-effect` — see `SearchPanel.tsx`'s doc for the
  // same discipline), never synchronously in the effect body itself.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => (active.length === 0 ? new Map<number, ShareLinkCounts>() : computeShareLinkCounts(active, async (sourcePath) => readTextFile(displayToFsPath(sourcePath)))))
      .then((counts) => {
        if (!cancelled) setLinkCounts(counts);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((s) => s.id).join(",")]);

  // R5-6 — same best-effort, never-blocks-the-table discipline as the link
  // counts effect above: a share whose file can't be read resolves to
  // "missing" (see `contentHash.ts::computeShareFreshness`) rather than
  // failing the whole batch. Keyed on `id:blob_id` pairs (not just ids) so
  // "Update share" — which changes a row's `blob_id` without adding or
  // removing any share — still triggers a recompute.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() =>
        active.length === 0
          ? new Map<number, ShareFreshness>()
          : computeShareFreshness(active, async (sourcePath) => readTextFile(displayToFsPath(sourcePath))),
      )
      .then((result) => {
        if (!cancelled) setFreshness(result);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((s) => `${s.id}:${s.blob_id ?? ""}`).join(","), freshnessRefreshNonce]);

  async function handleUpdateShare(share: ShareOut) {
    setUpdatingShareId(share.id);
    try {
      const content = await readTextFile(displayToFsPath(share.source_path));
      const filename = share.source_path.slice(share.source_path.lastIndexOf("/") + 1);
      await updateShareContent(share.id, filename, content);
      toast({ title: "Share updated", variant: "success" });
    } catch (err) {
      toast({
        title: "Couldn't update the share",
        description: err instanceof Error ? err.message : "The file may no longer exist in the vault. Check the path and try again.",
        variant: "danger",
      });
    } finally {
      setUpdatingShareId(null);
    }
  }

  // Same idiom as `ShareApp.tsx`'s boot-time `load()`: a plain async
  // function whose OWN first line is the synchronous "start loading"
  // setState, called from the effect with a documented disable comment.
  async function loadTokens(shareId: number): Promise<void> {
    setTokensLoading(true);
    try {
      setTokens(await listShareTokens(shareId));
    } finally {
      setTokensLoading(false);
    }
  }

  useEffect(() => {
    if (!tokenShare) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadTokens()'s own synchronous setTokensLoading(true) is the intentional "start loading" transition (same idiom as ShareApp.tsx's load()).
    void loadTokens(tokenShare.id);
  }, [tokenShare]);

  async function handleCopy(share: ShareOut) {
    try {
      await navigator.clipboard.writeText(buildShareLink(share));
      toast({ title: "Link copied", variant: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", description: "Clipboard access was denied. Select the link and copy it manually.", variant: "danger" });
    }
  }

  // Full-width page now (see header doc) — every column the roadmap asks
  // for gets its own space: Source, Link, Mode, Access, Links to, Linked
  // from, Hits, Last accessed, plus the trailing actions cell.
  //
  // "Links to / from" used to be ONE `width: "sm"` cell rendering
  // "N to / M from" — at that width it truncated to a bare chevron ("1 to
  // /", clipped) for any non-trivial count, so the number that mattered
  // most was exactly the one hidden. Split into two independently-narrow
  // numeric columns instead (`width: "xs"`, right-aligned, `type: "number"`
  // for tabular-nums per docs/DESIGN-SPEC.md (Amendments round 16) rule 7) — each column only
  // ever holds a short integer, so `xs` never truncates. This shifts every
  // column after it right by one; `tests/e2e/share-panel.spec.ts`'s
  // `td.nth(...)` index for Hits is updated to match.
  // R5-6 — "Freshness" is a badge column, same `type: "badge"` mechanism
  // "Mode"/"Access" already use. `CellType`'s badge cell always renders
  // this column's ONE fixed `badgeVariant` (`DataTableColumn` has no
  // per-row variant hook — only `statusVariant` accepts a function, and
  // that's a status dot, not a chip), so a row that's up to date carries a
  // `null` cell value instead: `CellType` renders `null`/`undefined` as a
  // plain muted em dash regardless of `type`, which reads as "nothing to
  // report" rather than a false "Stale"/"Missing" chip forced into some
  // third color. Both attention states share "warning" (soft) — the
  // distinction an owner needs is the WORDING, not a second color, since
  // both mean "the link doesn't currently point at what's in the vault
  // right now, go look".
  const columns: DataTableColumn[] = [
    { key: "source", header: "Source", width: "xl" },
    { key: "link", header: "Link", width: "lg" },
    { key: "mode", header: "Mode", type: "badge", width: "sm" },
    { key: "access", header: "Access", type: "badge", width: "md" },
    { key: "freshness", header: "Freshness", type: "badge", badgeVariant: "warning", badgeStyle: "soft", width: "sm" },
    { key: "linksTo", header: "Links to", type: "number", width: "xs", align: "right" },
    { key: "linkedFrom", header: "Linked from", type: "number", width: "xs", align: "right" },
    { key: "hits", header: "Hits", type: "number", width: "xs", align: "right" },
    { key: "lastAccessed", header: "Last accessed", width: "sm" },
  ];

  const rows = active.map((share) => {
    const counts = linkCounts.get(share.id);
    const shareFreshness = freshness.get(share.id);
    return {
      id: share.id,
      source: share.source_path,
      link: `/share/${share.alias ?? share.slug}`,
      mode: share.render_mode === "rendered" ? "Viewer page" : "Raw file",
      access: share.general_access === "link" ? "Anyone with the link" : "Restricted",
      // R5-6 — "Stale" (file exists, content differs from the pinned
      // blob) vs "File missing" (the source file is no longer in the
      // vault at all — a chip an owner reads very differently from
      // "Stale": there's no bytes to re-pin until the file exists again,
      // where "Stale" is one click away from fixed via "Update share").
      // `null` for "fresh"/"unknown" renders as a plain em dash (see the
      // column comment above), never a false-positive chip.
      freshness: shareFreshness === "stale" ? "Stale" : shareFreshness === "missing" ? "File missing" : null,
      linksTo: counts?.linksTo ?? 0,
      linkedFrom: counts?.linkedFrom ?? 0,
      hits: share.hit_count,
      lastAccessed: formatRelativeEpochSeconds(share.last_access_at),
    };
  });

  if (!authenticated) {
    return (
      <div style={{ padding: "40px 40px 120px" }} data-testid="shared-view">
        <EmptyState icon={<Share2 size={20} />} title="Sign in to see your shares" description="Shares are tied to your backend owner account. Sign in from Settings -> Sharing." />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }} data-testid="shared-view">
      <div style={{ padding: "40px 40px 120px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-fg)", margin: 0 }}>Shared</h1>
          <Tooltip content="Refresh" side="left">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh shares"
              onClick={() => {
                setFreshnessRefreshNonce((n) => n + 1);
                void refreshShares();
              }}
            >
              <RefreshCcw size={14} />
            </Button>
          </Tooltip>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 20px" }}>
          Every active share, audited: link, access, freshness, links to/from other shares, hits, and last accessed.
        </p>

        {error && <p style={{ fontSize: 12.5, color: "var(--color-danger)", margin: "0 0 12px" }}>{error}</p>}

        {loading && active.length === 0 ? (
          <Skeleton height="240px" data-testid="shared-view-loading" />
        ) : active.length === 0 ? (
          <EmptyState icon={<Share2 size={20} />} title="No shares yet" description="Publish a file (Explorer row context menu -> Publish…) to see it listed here." />
        ) : (
          <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity var(--motion-duration-base) ease" }} aria-busy={loading} data-testid="shared-view-table">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id as number}
              actionsHeader="Actions"
              actionsWidth="6rem"
              renderActions={(row) => {
                const share = active.find((s) => s.id === row.id);
                if (!share) return null;
                return (
                  <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy link for ${share.source_path}`} onClick={() => void handleCopy(share)}>
                      <Copy size={13} />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${share.source_path}`} data-testid={`shared-row-actions-${share.id}`}>
                          <MoreHorizontal size={13} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-inline" onClick={() => void handleCopy(share)}>
                          <Copy size={13} /> Copy link
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-inline" onClick={() => setEditingShare(share)} data-testid={`shared-edit-${share.id}`}>
                          <Pencil size={13} /> Edit policy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-inline"
                          onClick={async () => {
                            await regenerate(share.id);
                            toast({ title: "Link regenerated", variant: "success" });
                          }}
                        >
                          <RotateCw size={13} /> Regenerate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-inline"
                          disabled={updatingShareId === share.id}
                          onClick={() => void handleUpdateShare(share)}
                          data-testid={`shared-update-${share.id}`}
                        >
                          <UploadCloud size={13} /> Update share
                        </DropdownMenuItem>
                        {share.auth_mode === "token" && (
                          <DropdownMenuItem className="gap-inline" onClick={() => setTokenShare(share)} data-testid={`shared-tokens-${share.id}`}>
                            <KeyRound size={13} /> Manage tokens
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="gap-inline" onClick={() => setRevokeTarget(share)} data-testid={`shared-revoke-${share.id}`}>
                          <Trash2 size={13} color="var(--color-danger)" /> Revoke
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              }}
            />
          </div>
        )}
      </div>

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

      {editingShare && (
        <Suspense fallback={null}>
          <PublishDialog open={editingShare !== null} onOpenChange={(open) => !open && setEditingShare(null)} existingShare={editingShare} />
        </Suspense>
      )}

      <Dialog open={tokenShare !== null} onOpenChange={(open) => !open && setTokenShare(null)}>
        <DialogContent size="sm" data-testid="shared-token-dialog">
          <DialogHeader>
            <DialogTitle>Share tokens</DialogTitle>
            <DialogDescription>{tokenShare?.source_path}</DialogDescription>
          </DialogHeader>
          {tokensLoading ? (
            <Skeleton height="80px" />
          ) : tokens.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--color-muted)" }}>No tokens minted yet. Edit policy and choose "Share token" to mint one.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tokens.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ flex: 1, fontFamily: "var(--font-mono)" }}>{t.prefix}… {t.label ? `(${t.label})` : ""}</span>
                  <Badge variant={t.revoked_at ? "neutral" : "success"} tone="soft">
                    {t.revoked_at ? "Revoked" : "Active"}
                  </Badge>
                  {!t.revoked_at && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revoke token ${t.prefix}`}
                      onClick={async () => {
                        if (!tokenShare) return;
                        await revokeShareToken(tokenShare.id, t.id);
                        setTokens((prev) => prev.map((x) => (x.id === t.id ? { ...x, revoked_at: Date.now() / 1000 } : x)));
                      }}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setTokenShare(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}

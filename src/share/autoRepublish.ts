/**
 * Round 7 item 58 — folder shares FOLLOW the folder. Creating, editing, or
 * deleting a file inside a shared folder auto-republishes that share's
 * manifest, debounced and best-effort (offline/signed-out/failed PATCHes
 * are silently dropped; the next successful run self-corrects), so the
 * tree's chain indicator on a child never lies about what the share serves.
 *
 * Exclusion safety — the server stores only INCLUDED entries, so "the
 * owner unchecked this file" and "this file didn't exist yet" are
 * indistinguishable from the manifest alone. Two tiers keep automation
 * from ever widening a share beyond what the owner chose:
 *  - The publish dialog records each share's unchecked relpaths here at
 *    publish/update time (`rememberShareExclusions`, localStorage). With
 *    that knowledge, a republish includes every current file except those.
 *  - Without it (another browser, cleared storage), the republish only
 *    refreshes/deletes relpaths ALREADY in the server manifest — new files
 *    are never auto-added, because we can't prove they weren't exclusions.
 *
 * Lives outside `useShareStore` on purpose: that store is vault-agnostic
 * (its module doc), and this is exactly the one job that must read the
 * vault (fs tree + buffers). `App.tsx`'s mutation handlers call
 * `scheduleShareAutoRepublish` the same way they already call
 * `notifyPathMoved` (round 6 item 8).
 */
import { useBufferStore } from "../stores/useBufferStore";
import { useFsStore } from "../stores/useFsStore";
import { getShareManifest } from "./api";
import { useShareStore, type FolderPublishEntry } from "./useShareStore";
import type { FileNode } from "../types";

const DEBOUNCE_MS = 3000;
const EXCLUSIONS_KEY = "vsnote-share-exclusions";
/** Persisted-blob schema version (react-doctor client-localstorage-no-version,
 * COMPONENT-BACKLOG §3.7 discipline): the envelope is `{ v: 1, map }`. A
 * pre-versioning blob was the bare `Record<string, string[]>` itself, so
 * `loadExclusions` treats "object without v" as that legacy shape and keeps
 * working — no discard-on-upgrade for existing sessions. */
const EXCLUSIONS_VERSION = 1;

function loadExclusions(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EXCLUSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed === "object" && parsed !== null && "v" in (parsed as Record<string, unknown>)) {
      const env = parsed as { v: number; map: Record<string, string[]> };
      return env.v === EXCLUSIONS_VERSION && typeof env.map === "object" && env.map !== null ? env.map : {};
    }
    // Legacy bare-map blob — adopt it as-is.
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** Called by the publish dialog after every successful folder publish or
 * "Update share": records which relpaths the owner UNCHECKED so later
 * auto-republishes can add genuinely-new files without ever resurrecting a
 * deliberate exclusion. An empty list clears the record. */
export function rememberShareExclusions(shareId: number, excludedRelpaths: string[]): void {
  try {
    const map = loadExclusions();
    if (excludedRelpaths.length === 0) delete map[String(shareId)];
    else map[String(shareId)] = excludedRelpaths;
    localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify({ v: EXCLUSIONS_VERSION, map }));
  } catch {
    // Storage denied — the manifest-only fallback below still applies.
  }
}

function findNode(nodes: FileNode[], path: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.type === "folder" && path.startsWith(`${n.path}/`)) return findNode(n.children ?? [], path);
  }
  return undefined;
}

async function collectEntries(root: FileNode): Promise<FolderPublishEntry[]> {
  const prefixLen = root.path.length + 1;
  const filePaths: { relpath: string; vaultPath: string }[] = [];
  const walk = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      if (n.type === "file") filePaths.push({ relpath: n.path.slice(prefixLen), vaultPath: n.path });
      else walk(n.children ?? []);
    }
  };
  walk(root.children ?? []);
  const entries: FolderPublishEntry[] = [];
  for (const fp of filePaths) {
    await useBufferStore.getState().ensureLoaded(fp.vaultPath);
    const buf = useBufferStore.getState().buffers[fp.vaultPath];
    entries.push({ relpath: fp.relpath, content: buf?.content ?? "" });
  }
  return entries;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

async function republish(shareId: number): Promise<void> {
  const { shares, authenticated, updateFolderManifest } = useShareStore.getState();
  if (!authenticated) return;
  const share = shares.find((s) => s.id === shareId);
  if (!share || share.revoked_at != null) return;
  const root = findNode(useFsStore.getState().tree, share.source_path);
  if (!root || root.type !== "folder") return;

  const entries = await collectEntries(root);
  const excluded = loadExclusions()[String(shareId)];
  let include: FolderPublishEntry[];
  if (excluded) {
    const excludedSet = new Set(excluded);
    include = entries.filter((e) => !excludedSet.has(e.relpath));
  } else {
    // No exclusion knowledge — refresh/remove only what the share already
    // serves, never widen it (see module doc).
    const manifest = await getShareManifest(shareId);
    const known = new Set(manifest.entries.map((e) => e.relpath));
    include = entries.filter((e) => known.has(e.relpath));
  }
  // Automation never empties a share — an owner does that deliberately.
  if (include.length === 0) return;
  await updateFolderManifest(shareId, include);
}

/** Debounced, per-share, never-throws. Call with the vault display path
 * that changed (the file itself, or a folder whose subtree changed). */
export function scheduleShareAutoRepublish(...changedPaths: string[]): void {
  const { authenticated, shares } = useShareStore.getState();
  if (!authenticated) return;
  for (const share of shares) {
    if (share.kind !== "folder" || share.revoked_at != null) continue;
    const affected = changedPaths.some(
      (p) => p === share.source_path || p.startsWith(`${share.source_path}/`) || share.source_path.startsWith(`${p}/`),
    );
    if (!affected) continue;
    clearTimeout(timers.get(share.id));
    timers.set(
      share.id,
      setTimeout(() => {
        timers.delete(share.id);
        republish(share.id).catch(() => {
          // Best-effort by contract — offline or a failed PATCH just leaves
          // the previous snapshot; a later change tries again.
        });
      }, DEBOUNCE_MS),
    );
  }
}

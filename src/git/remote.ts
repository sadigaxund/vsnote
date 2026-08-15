/**
 * Real remote sync (Phase 11 — replaces the old simulated remote).
 * `isomorphic-git`'s `fetch`/`push`/`fastForward` over
 * `isomorphic-git/http/web`, against a real smart-HTTP git server
 * (`server/app/routers/git_http.py`, `server/README.md`'s "Real git sync"
 * section). Real ahead/behind is computed from actual refs
 * (`computeSyncStatus`) — HEAD vs. `refs/remotes/origin/<branch>` — never a
 * persisted fake counter. `useGitStore` owns the ahead/behind/lastSyncedAt
 * STATE and calls the functions here to update it; this module never
 * touches zustand.
 *
 * **Fast-forward only (v2.0)**: `realPush`/`realPull` both refuse outright
 * (throwing `SyncError("diverged", ...)`, never attempting the network
 * call that matters) whenever `classifyDivergence` says "diverged" — see
 * `syncStatus.ts`'s `pushAction`/`pullAction` for the exact decision table.
 * Never auto-merges, never force-pushes (`git.push`'s `force` is always
 * `false`).
 *
 * **CLAUDE.md rule 3** ("server-optional"): every exported function here
 * either resolves or rejects with a `SyncError` — never an unhandled
 * rejection, never a hang. `useGitStore`'s actions catch every `SyncError`
 * and store it as `syncError` state rather than letting it propagate,
 * which is what actually keeps the offline case honest-but-non-crashing in
 * the UI; this module's job is just to make sure the error it throws is
 * always a real, specific `SyncError` a catch block can read a message
 * off of.
 */
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { fs, GIT_DIR } from "./client";
import { computeStatus } from "./status";
import { buildGitAuth, classifyDivergence, pullAction, pushAction, DIVERGED_MESSAGE, type AheadBehind } from "./syncStatus";

export interface RemoteConfig {
  url: string;
  token: string;
}

/** Phase 10.5a (single-origin refactor, roadmap §5.4) — the sync remote is
 * implicitly `<origin>/git/vault.git`: no Settings field, nothing
 * persisted, nothing configurable. `vault` is a fixed repo name — the
 * server creates it on demand on first push
 * (`server/app/gitrepo.py::ensure_bare_repo`), so it just needs to be *a*
 * valid, stable name, not a pre-existing one. `window.location.origin`
 * (rather than a relative path) because `isomorphic-git`'s `fetch`/`push`/
 * `getRemoteInfo` all need a real, absolute URL — it's still never a
 * hardcoded host/port: whatever origin actually served this page (the
 * built SPA served by `server/app/main.py` in production, `vite dev`/
 * `preview` in local dev — both proxy `/git/*` to the real backend, see
 * `vite.config.ts`) is exactly the right same-origin target either way. */
export function computeGitRemoteUrl(): string {
  return `${window.location.origin}/git/vault.git`;
}

export interface SyncStatus extends AheadBehind {
  /** Whether `refs/remotes/origin/<branch>` exists at all yet — false
   * before the very first fetch/pull/push against this remote (or if the
   * branch has never been fetched under this exact name). */
  hasRemoteRef: boolean;
}

const EMPTY_STATUS: SyncStatus = { ahead: 0, behind: 0, hasRemoteRef: false };

export type SyncErrorCode = "not-configured" | "offline" | "auth" | "diverged" | "dirty" | "http" | "unknown";

export class SyncError extends Error {
  code: SyncErrorCode;
  status?: number;
  constructor(code: SyncErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.status = status;
  }
}

/** `git.fetch()` refuses to run at all without a `remote.origin.fetch`
 * config entry (isomorphic-git reads it from the repo's own git config to
 * know where to write remote-tracking refs — confirmed by hitting
 * `NoRefspecError` in practice: passing `url` explicitly to `fetch()` is
 * enough for the actual network request, but NOT enough to satisfy the
 * later `GitRefManager.updateRemoteRefs` step, which always reads
 * `remote.${remote}.fetch` from config with no override in the public
 * API). `git.push()` doesn't need this (it never writes local
 * remote-tracking refs; `realPush` above updates them itself after a
 * successful push). Idempotent + `force: true` so a changed Settings URL
 * always wins on the next sync rather than sticking to whatever was
 * configured the first time this repo ever synced. */
async function ensureOrigin(url: string): Promise<void> {
  await git.addRemote({ fs, dir: GIT_DIR, remote: "origin", url, force: true });
}

async function remoteTrackingOid(branch: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir: GIT_DIR, ref: `refs/remotes/origin/${branch}` });
  } catch {
    return null;
  }
}

/** Counts commits reachable from `fromOid` that are NOT reachable from
 * `stopOid` — used with `stopOid` set to the merge base, so this is exactly
 * "how many commits ahead/behind" for a two-ref comparison. `git.log` walks
 * first-parent-inclusive history from `fromOid`; since `stopOid` (the
 * merge base) is by construction an ancestor of `fromOid` whenever this is
 * called, the walk always terminates there rather than reading the whole
 * repo history. */
async function countUnique(fromOid: string, stopOid: string | null): Promise<number> {
  const commits = await git.log({ fs, dir: GIT_DIR, ref: fromOid });
  let count = 0;
  for (const commit of commits) {
    if (stopOid && commit.oid === stopOid) break;
    count++;
  }
  return count;
}

/** Real ahead/behind from actual refs — no network I/O, safe to call on
 * every `useGitStore.refresh()` (i.e. after every commit, save, or tree
 * change), not just after an explicit sync. Compares local HEAD against
 * whatever `refs/remotes/origin/<branch>` currently holds, which is only
 * ever updated by an explicit `realFetch`/`realPull`/`realPush` call — so
 * this reflects "as of the last time we talked to the remote", same as any
 * git client's normal ahead/behind display. */
export async function computeSyncStatus(branch: string): Promise<SyncStatus> {
  const headOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: "HEAD" }).catch(() => null);
  const remoteOid = await remoteTrackingOid(branch);
  if (!headOid || !remoteOid) {
    return { ...EMPTY_STATUS, hasRemoteRef: remoteOid !== null };
  }
  if (headOid === remoteOid) return { ahead: 0, behind: 0, hasRemoteRef: true };

  const bases = await git.findMergeBase({ fs, dir: GIT_DIR, oids: [headOid, remoteOid] });
  const base: string | null = bases[0] ?? null;
  const [ahead, behind] = await Promise.all([countUnique(headOid, base), countUnique(remoteOid, base)]);
  return { ahead, behind, hasRemoteRef: true };
}

function mapError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  const code = (err as { code?: string } | null)?.code;
  const statusCode = (err as { data?: { statusCode?: number } } | null)?.data?.statusCode;
  if (code === "HttpError") {
    if (statusCode === 401 || statusCode === 403) {
      return new SyncError(
        "auth",
        "The remote rejected the credentials — check the Personal access token in Settings → Git & Sync.",
        statusCode,
      );
    }
    return new SyncError("http", `The remote returned an error (HTTP ${statusCode ?? "?"}).`, statusCode);
  }
  if (code === "FastForwardError") {
    return new SyncError("diverged", DIVERGED_MESSAGE);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|econnrefused|fetch failed/i.test(message)) {
    return new SyncError("offline", "Could not reach the git remote — check the server is running and the Remote URL is correct.");
  }
  return new SyncError("unknown", message || "Sync failed for an unknown reason.");
}

function requireConfig(config: RemoteConfig): void {
  if (!config.url.trim()) {
    throw new SyncError("not-configured", "No remote URL configured — set one in Settings → Git & Sync.");
  }
}

/** Fetches the remote's current state for `branch` (updates
 * `refs/remotes/origin/<branch>` only — never touches the working tree or
 * local HEAD) and returns the freshly-recomputed status. */
export async function realFetch(config: RemoteConfig, branch: string): Promise<SyncStatus> {
  requireConfig(config);
  try {
    await ensureOrigin(config.url);
    await git.fetch({
      fs,
      http,
      dir: GIT_DIR,
      url: config.url,
      ref: branch,
      remoteRef: branch,
      singleBranch: true,
      tags: false,
      onAuth: () => buildGitAuth(config.token),
    });
  } catch (err) {
    throw mapError(err);
  }
  return computeSyncStatus(branch);
}

/** Fast-forward-only pull. Refuses (no working-tree change at all) if the
 * tree has uncommitted changes that a fast-forward checkout could clobber,
 * or if local/remote have diverged. A no-op (still refreshes the
 * remote-tracking ref via the fetch, but touches nothing else) when there's
 * genuinely nothing to fast-forward. */
export async function realPull(config: RemoteConfig, branch: string): Promise<SyncStatus> {
  const status = await realFetch(config, branch);
  const action = pullAction(classifyDivergence(status));
  if (action === "refuse") {
    throw new SyncError("diverged", DIVERGED_MESSAGE);
  }
  if (action === "fast-forward") {
    const { changedCount } = await computeStatus();
    if (changedCount > 0) {
      throw new SyncError(
        "dirty",
        "You have uncommitted changes — commit or discard them before pulling (fast-forward would touch the working tree).",
      );
    }
    try {
      // Deliberately NOT `git.fastForward()` here: that helper does its
      // OWN internal `fetch` (see its source — `_pull({..., fastForwardOnly:
      // true})` always re-fetches rather than accepting an already-known
      // oid), which is both a redundant second network round-trip on top
      // of the `realFetch` call two lines up AND, confirmed the hard way
      // in manual verification, an outright bug trigger: the redundant
      // fetch's own object-negotiation left `computeSyncStatus`'s very
      // next `git.log` unable to find the commit object that same fetch
      // was supposed to have just written (`NotFoundError`) — a real
      // isomorphic-git double-fetch interaction, not something this app
      // did wrong. We already know exactly which oid to fast-forward to
      // (the remote-tracking ref `realFetch` above just updated), so this
      // moves the branch ref and checks out the working tree directly —
      // no second fetch, no redundant network call, and it sidesteps the
      // bug entirely.
      const targetOid = await remoteTrackingOid(branch);
      if (!targetOid) {
        throw new SyncError("unknown", "The remote-tracking ref vanished mid-pull — try again.");
      }
      await git.writeRef({ fs, dir: GIT_DIR, ref: `refs/heads/${branch}`, value: targetOid, force: true });
      await git.checkout({ fs, dir: GIT_DIR, ref: branch, force: true });
    } catch (err) {
      throw mapError(err);
    }
  }
  return computeSyncStatus(branch);
}

/** Fast-forward-only push. Refuses outright (never calls `git.push` at
 * all) when the remote has commits this branch doesn't — that's the one
 * state a real push attempt could only either be rejected for or, worse,
 * silently rewrite history for (dulwich's plain receive-pack has no
 * built-in non-fast-forward guard — see `server/README.md`'s "Real git
 * sync" section) — so the safety lives here, client-side, not on trust
 * that the server will say no. `force` is always `false`.
 *
 * Bootstrap case: the pre-flight `realFetch` above talks upload-pack
 * (read), but a repo Phase 11's server has never seen a WRITE for yet
 * doesn't exist on disk at all (`server/README.md`: "created on demand" —
 * only on push) — so fetching it 404s even though push is about to
 * succeed and create it. A 404 here is therefore treated as "nothing to
 * compare against yet, proceed" rather than a hard failure; any OTHER
 * fetch failure (auth, offline, ...) still aborts the push before ever
 * attempting `git.push`. */
export async function realPush(config: RemoteConfig, branch: string): Promise<SyncStatus> {
  requireConfig(config);
  let status: SyncStatus | null = null;
  try {
    status = await realFetch(config, branch);
  } catch (err) {
    const mapped = err instanceof SyncError ? err : mapError(err);
    if (mapped.status !== 404) throw mapped;
    // status stays null — see doc above: the remote repo simply doesn't
    // exist yet, which unconditionally means "push" (there is nothing it
    // could possibly be diverged from).
  }
  const action = status === null ? "push" : pushAction(classifyDivergence(status));
  if (action === "refuse") {
    throw new SyncError("diverged", DIVERGED_MESSAGE);
  }
  if (action === "push") {
    try {
      const result = await git.push({
        fs,
        http,
        dir: GIT_DIR,
        url: config.url,
        ref: branch,
        remoteRef: branch,
        remote: "origin",
        force: false,
        onAuth: () => buildGitAuth(config.token),
      });
      if (!result.ok) {
        throw new SyncError("http", result.error ?? "The remote rejected the push.");
      }
      // `git.push` does NOT update the local remote-tracking ref (that's
      // fetch's job) — without this, `computeSyncStatus` below would read
      // the STALE (or, in the bootstrap case, still-nonexistent)
      // `refs/remotes/origin/<branch>` and report a misleading nonzero
      // `ahead` right after a push that just succeeded. We already know
      // exactly what the remote now points at (local HEAD, since the push
      // just fast-forwarded it there) — no need for a second network
      // round-trip via another fetch.
      const pushedOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: branch });
      await git.writeRef({ fs, dir: GIT_DIR, ref: `refs/remotes/origin/${branch}`, value: pushedOid, force: true });
    } catch (err) {
      throw mapError(err);
    }
  }
  return computeSyncStatus(branch);
}

export type ConnectionTestResult =
  | { ok: true; repoExists: boolean }
  | { ok: false; code: SyncErrorCode; message: string };

/** "Test connection" (Settings → Git & Sync): a real round-trip
 * (`git.getRemoteInfo`, the smart-HTTP `info/refs` advertisement) that
 * touches neither the local repo nor the working tree — safe to call at
 * any time, including with an empty/garbage token, and never leaves
 * anything behind. A `404` from an otherwise-successful auth round-trip
 * means "reachable and authenticated, the repo just hasn't been pushed to
 * yet" (Phase 11 repos are created on demand on first push) — reported as
 * `ok: true, repoExists: false`, not an error. */
export async function testGitConnection(config: RemoteConfig): Promise<ConnectionTestResult> {
  if (!config.url.trim()) {
    return { ok: false, code: "not-configured", message: "Set a Remote URL first." };
  }
  try {
    const info = await git.getRemoteInfo({ http, url: config.url, onAuth: () => buildGitAuth(config.token) });
    return { ok: true, repoExists: Object.keys(info.heads ?? {}).length > 0 };
  } catch (err) {
    const mapped = mapError(err);
    if (mapped.code === "http" && mapped.status === 404) {
      return { ok: true, repoExists: false };
    }
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}

/**
 * Real remote sync (Phase 11 — replaces the old simulated remote).
 * `isomorphic-git`'s `fetch`/`push` over `isomorphic-git/http/web`, against
 * a real smart-HTTP git server (`server/app/routers/git_http.py`,
 * `server/README.md`'s "Real git sync" section). Real ahead/behind is
 * computed from actual refs (`computeSyncStatus`) — HEAD vs.
 * `refs/remotes/origin/<branch>` — never a persisted fake counter.
 * `useGitStore` owns the ahead/behind/lastSyncedAt STATE and calls the
 * functions here to update it; this module never touches zustand.
 *
 * **`realPush`/`realPull` stay fast-forward-only** (they refuse outright —
 * throwing `SyncError("diverged", ...)`, never attempting the network call
 * that matters — whenever `classifyDivergence` says "diverged"; see
 * `syncStatus.ts`'s `pushAction`/`pullAction`). That's still the right,
 * predictable behavior for the two individual Pull/Push buttons
 * (`SourceControlPanel.tsx`) — real `git push`/`git pull --ff-only` behave
 * the same way. **Divergence itself is no longer a dead end** (roadmap
 * §5.2, amending v2.0's original "refuse + explain" policy): `sync.ts`'s
 * `runSync` — driven by the ONE-BUTTON "Sync" action (`useGitStore.ts`'s
 * `syncNow`, the status bar's sync segment / command palette's "Sync now")
 * — auto-merges a genuine divergence (backup ref, three-way diff3, merge
 * commit, push) or opens the in-app conflict resolver when it can't. This
 * module's `mapError`/`fastForwardBranch`/`pushBranch` are exported
 * specifically so `sync.ts` reuses the exact same error classification and
 * mutation logic rather than a second copy — `realPull`/`realPush` are
 * thin wrappers around those two helpers plus the fast-forward-only
 * refuse-on-diverge gate.
 *
 * **Never force-pushes** anywhere in this module OR `sync.ts` (`git.push`'s
 * `force` is always `false`) — the server's non-fast-forward rejection is
 * the backstop, but the client never even tries; a real merge commit
 * (whose second parent is the remote's current tip) is always a legitimate
 * fast-forward from the remote's point of view, so this restriction never
 * blocks a genuine auto-merge or resolved-conflict push.
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
import { clearReadCache } from "../fs/operations";
import { computeStatus } from "./status";
import { buildGitAuth, classifyDivergence, pullAction, pushAction, DIVERGED_MESSAGE, type AheadBehind } from "./syncStatus";

export interface RemoteConfig {
  url: string;
  token: string;
}

/** DESIGN-SPEC Amendments round 5 item 41's exact default repo name — the
 * implicit remote stays `<origin>/git/vault.git` for anyone who never
 * touches Settings → Git & Sync's new "Repository name" field. */
export const DEFAULT_GIT_REPO_NAME = "vault";

/** Server's exact contract (`server/app/gitrepo.py::REPO_NAME_RE`) — a repo
 * name becomes a URL path segment AND, server-side, a bare-repo directory
 * name, so the client validates against the identical shape BEFORE letting
 * a user save one the server would reject with `InvalidRepoName`. Kept as
 * one shared regex literal (not re-derived) so the two can't silently drift
 * apart. */
export const REPO_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** `null` = valid. One-row, em-dash-free message (DESIGN-SPEC round 5 copy
 * rule) suitable straight in a `FormField`'s `error` prop. */
export function validateRepoName(name: string): string | null {
  if (REPO_NAME_PATTERN.test(name)) return null;
  return "Use 1 to 64 letters, digits, hyphens, or underscores.";
}

export interface GitRemoteSettings {
  /** Settings → Git & Sync's "Repository name" (default `vault`) — only
   * used to build the IMPLICIT remote; ignored while `overrideEnabled`. */
  repoName: string;
  /** Item 41's "Advanced: custom remote override" toggle — off by default. */
  overrideEnabled: boolean;
  /** A full external remote URL (GitHub/Gitea/another VSNote). Only takes
   * effect when `overrideEnabled` AND non-blank; a blank override URL with
   * the toggle on falls back to the implicit remote rather than resolving
   * to `""`, so a half-filled-in Advanced section never silently breaks
   * sync. */
  overrideUrl: string;
}

/** Pure resolver — no `window` dependency, so it's directly unit-testable
 * under this repo's `environment: "node"` vitest config (`vitest.config.ts`)
 * the same way `git/syncStatus.ts`'s pure helpers are, unlike the rest of
 * this module. `computeGitRemoteUrl` below is the thin, real-`window`
 * wrapper every actual code path (sync AND the Settings display) calls, so
 * both stay provably in sync. */
export function resolveGitRemoteUrl(origin: string, settings: GitRemoteSettings): string {
  if (settings.overrideEnabled) {
    const trimmed = settings.overrideUrl.trim();
    if (trimmed) return trimmed;
  }
  const repoName = settings.repoName.trim() || DEFAULT_GIT_REPO_NAME;
  return `${origin}/git/${repoName}.git`;
}

/** DESIGN-SPEC Amendments round 5 item 41 AMENDS the Phase 10.5a/roadmap
 * §5.4 rule below — read this comment as the current truth, not the old
 * one it replaces:
 *
 * Roadmap §5.4's "no settable server URL" still stands for the APP/API
 * origin (every `/api`/`/share` call stays relative to
 * `window.location.origin`, no exceptions) — but item 41 explicitly carves
 * the GIT remote out of that rule ("it was always the roadmap's
 * 'optionally GitHub/Gitea + PAT later'"). So: with no override, the remote
 * is still same-origin, `<origin>/git/<repoName>.git` — `repoName` now
 * comes from Settings → Git & Sync's "Repository name" field
 * (`useSettingsStore`'s `gitRepoName`, default `DEFAULT_GIT_REPO_NAME`)
 * instead of being hardcoded `"vault"`. With the "Advanced: custom remote
 * override" toggle on and a URL filled in, THAT URL wins outright — a
 * full external remote (GitHub/Gitea/another VSNote instance), which is why
 * `git.fetch`/`git.push`/`getRemoteInfo` still need a real absolute URL
 * (not a relative path) either way. Same sync semantics on every remote,
 * implicit or overridden: fast-forward-only individual push/pull, "Sync"'s
 * auto-merge-with-backup-refs for a genuine divergence, and this module
 * NEVER force-pushes — none of that changes based on which URL this
 * function returns. `useGitStore.ts`'s `remoteConfig()` is the one real
 * caller that matters (feeds `push`/`pull`/`fetch`/`syncNow`); Settings'
 * "Remote URL" display (`SettingsView.tsx`) calls this exact function with
 * the exact same settings so it never re-derives a guess that could drift
 * from what sync actually uses. */
export function computeGitRemoteUrl(settings: GitRemoteSettings): string {
  return resolveGitRemoteUrl(window.location.origin, settings);
}

export interface GitCredentialSettings {
  /** The implicit-remote token (`gitAuthToken` — a Phase 9 API token). */
  token: string;
  overrideEnabled: boolean;
  overrideUrl: string;
  /** The Advanced override's OWN credential — deliberately a separate
   * field from `token`: an external GitHub/Gitea PAT is a different secret
   * for a different host, not interchangeable with this app's own
   * write-scoped API token. */
  overrideToken: string;
}

/** Pure, same reasoning as `resolveGitRemoteUrl` — mirrors its "override
 * wins only when enabled AND the URL is actually filled in" logic exactly,
 * so a half-configured Advanced section (toggle on, URL blank) uses the
 * implicit remote's own token too, not a blank/wrong one. */
export function resolveGitCredential(settings: GitCredentialSettings): string {
  if (settings.overrideEnabled && settings.overrideUrl.trim()) {
    return settings.overrideToken;
  }
  return settings.token;
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

/** Round 6 item 19 — asks the backend to delete + re-create the bare repo
 * (`server/app/routers/git_admin.py`). Session-cookie auth (same-origin);
 * a scoped API token is deliberately refused server-side. NOT a git
 * operation: sync's never-force-push rule is untouched, the next plain
 * push just lands in a fresh, empty repo. */
export async function resetRemoteRepo(repoName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/git-repos/${encodeURIComponent(repoName)}/reset`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    throw new SyncError("offline", "The backend is unreachable.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError("auth", "Sign in under Settings → Sharing first; resetting the remote needs an interactive session.", res.status);
  }
  if (!res.ok) {
    throw new SyncError("http", `The server could not reset the repository (HTTP ${res.status}).`, res.status);
  }
}

/** Deletes the local remote-tracking ref — used exactly once, by
 * `replaceRemoteWithLocal` (useGitStore.ts), right after a server-side repo
 * reset: the ref points into erased history, and leaving it would make the
 * follow-up plain push look diverged. Missing ref is a no-op. */
export async function clearRemoteTrackingRef(branch: string): Promise<void> {
  await git.deleteRef({ fs, dir: GIT_DIR, ref: `refs/remotes/origin/${branch}` }).catch(() => {});
}

/** Exported so `sync.ts` can resolve "what does the remote currently think
 * this branch is at" without a second, parallel implementation. */
export async function remoteTrackingOid(branch: string): Promise<string | null> {
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

/** Exported so `sync.ts` classifies unexpected git/network errors the exact
 * same way `realFetch`/`realPull`/`realPush` do — one error taxonomy, not
 * two independently-drifting copies. */
export function mapError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  const code = (err as { code?: string } | null)?.code;
  const statusCode = (err as { data?: { statusCode?: number } } | null)?.data?.statusCode;
  if (code === "HttpError") {
    if (statusCode === 401 || statusCode === 403) {
      return new SyncError(
        "auth",
        "The remote rejected the credentials. Check the token in Settings → Git & Sync.",
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
    return new SyncError("offline", "Could not reach the git remote. Check the server is running.");
  }
  return new SyncError("unknown", message || "Sync failed for an unknown reason.");
}

function requireConfig(config: RemoteConfig): void {
  if (!config.url.trim()) {
    throw new SyncError("not-configured", "No remote URL configured. Set one in Settings → Git & Sync.");
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

/** Moves `refs/heads/<branch>` to wherever `refs/remotes/origin/<branch>`
 * currently points and checks that out — the one real mutation a
 * fast-forward performs. Exported so `sync.ts`'s behind-only case (the
 * `runSync` pipeline's own fast-forward step, backed up first via
 * `backupRefs.ts`) reuses this exact logic instead of a second copy.
 *
 * Deliberately NOT `git.fastForward()`: that helper does its OWN internal
 * `fetch` (see its source — `_pull({..., fastForwardOnly: true})` always
 * re-fetches rather than accepting an already-known oid), which is both a
 * redundant second network round-trip on top of whatever fetch already ran
 * AND, confirmed the hard way in manual verification, an outright bug
 * trigger: the redundant fetch's own object-negotiation left
 * `computeSyncStatus`'s very next `git.log` unable to find the commit
 * object that same fetch was supposed to have just written
 * (`NotFoundError`) — a real isomorphic-git double-fetch interaction, not
 * something this app did wrong. Callers already know exactly which oid to
 * fast-forward to (the remote-tracking ref their own fetch just updated),
 * so this moves the branch ref and checks out the working tree directly —
 * no second fetch, no redundant network call, and it sidesteps the bug
 * entirely. */
export async function fastForwardBranch(branch: string): Promise<void> {
  try {
    const targetOid = await remoteTrackingOid(branch);
    if (!targetOid) {
      throw new SyncError("unknown", "The remote-tracking ref vanished mid-sync. Try again.");
    }
    await git.writeRef({ fs, dir: GIT_DIR, ref: `refs/heads/${branch}`, value: targetOid, force: true });
    await git.checkout({ fs, dir: GIT_DIR, ref: branch, force: true });
    // The checkout rewrote worktree bytes OUTSIDE fs/operations.ts — drop its
    // read cache so post-pull reads can't serve pre-pull content (TODO §6.1.1).
    clearReadCache();
  } catch (err) {
    throw mapError(err);
  }
}

/** Fast-forward-only pull. Refuses (no working-tree change at all) if the
 * tree has uncommitted changes that a fast-forward checkout could clobber,
 * or if local/remote have diverged — for a genuine divergence, use "Sync"
 * instead (`useGitStore.ts`'s `syncNow` → `sync.ts`'s `runSync`, roadmap
 * §5.2's auto-merge pipeline), not this fast-forward-only action. A no-op
 * (still refreshes the remote-tracking ref via the fetch, but touches
 * nothing else) when there's genuinely nothing to fast-forward. */
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
        "You have uncommitted changes. Commit or discard them before pulling.",
      );
    }
    await fastForwardBranch(branch);
  }
  return computeSyncStatus(branch);
}

/** Pushes local `branch`'s current tip — always `force: false` (see module
 * doc: never force-pushes, anywhere). Exported so `sync.ts` reuses this
 * exact push + remote-tracking-ref-update logic for both the clean-
 * auto-merge push and the resolved-conflict push, rather than a second
 * copy. Callers are responsible for having already decided a push is safe
 * (ahead-only, or a freshly-created merge commit whose second parent IS
 * the remote's current tip — either way a legitimate fast-forward from the
 * remote's point of view). */
export async function pushBranch(config: RemoteConfig, branch: string): Promise<void> {
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
    // fetch's job) — without this, `computeSyncStatus` would read the
    // STALE (or, in the bootstrap case, still-nonexistent)
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

/** Fast-forward-only push. Refuses outright (never calls `git.push` at
 * all) when the remote has commits this branch doesn't — that's the one
 * state a real push attempt could only either be rejected for or, worse,
 * silently rewrite history for (dulwich's plain receive-pack has no
 * built-in non-fast-forward guard — see `server/README.md`'s "Real git
 * sync" section) — so the safety lives here, client-side, not on trust
 * that the server will say no. `force` is always `false`. For a genuine
 * divergence, use "Sync" instead (`sync.ts`'s `runSync`, roadmap §5.2) —
 * this action stays fast-forward-only on purpose, same reasoning as
 * `realPull`.
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
    await pushBranch(config, branch);
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

/** Item 41(e)'s "reachability, auth, and repo existence" split as a plain
 * discriminated `outcome`, so `SettingsView.tsx` renders one specific,
 * one-row line per case instead of dumping whatever `SyncError.message`
 * happened to say. Pure (no I/O — just classifies an already-resolved
 * `ConnectionTestResult`), so it's directly unit-testable. The three the
 * item calls out by name are `"unreachable"` / `"auth-rejected"` /
 * `"repo-missing"` — distinct user problems, distinct fixes ("is the
 * server up", "is the token right", "has anyone pushed yet"); `"ok"` and
 * `"error"` round out the type for the cases that aren't one of those
 * three (a clean success, or some other/unknown `SyncError`). */
export type ConnectionTestOutcome = "ok" | "unreachable" | "auth-rejected" | "repo-missing" | "misconfigured" | "error";

export interface ConnectionTestDescription {
  outcome: ConnectionTestOutcome;
  /** One row, zero em dashes (DESIGN-SPEC round 5 copy rule) — ready to
   * render as-is. */
  message: string;
}

export function describeConnectionTest(result: ConnectionTestResult, isCustomRemote = false): ConnectionTestDescription {
  if (result.ok) {
    if (!result.repoExists) {
      // "Repo missing" means two different things depending on the remote,
      // and saying only "does not exist" alarms people for what is, on the
      // built-in remote, the normal first-run state: this backend creates
      // `{VSNOTE_GIT_ROOT}/{repo}.git` on the first authenticated push (see
      // server/app/gitrepo.py). An external GitHub/Gitea remote does NOT
      // auto-create, so there the user really does have work to do.
      return isCustomRemote
        ? { outcome: "repo-missing", message: "Authenticated, but that repository does not exist on the remote." }
        : { outcome: "repo-missing", message: "Authenticated. The repository is created on first push." };
    }
    return { outcome: "ok", message: "Reachable, authenticated, and the repository exists." };
  }
  if (result.code === "offline") {
    return { outcome: "unreachable", message: "Could not reach the remote host." };
  }
  if (result.code === "auth") {
    return { outcome: "auth-rejected", message: "Reached the host, but the credential was rejected." };
  }
  if (result.code === "not-configured") {
    return { outcome: "misconfigured", message: result.message };
  }
  return { outcome: "error", message: result.message };
}

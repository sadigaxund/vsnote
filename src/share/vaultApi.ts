/**
 * Typed client for the server-mounted vault + mirror-remotes surface
 * (Phase 17 Milestone C2, `docs/IMPLEMENTATION-PLAN-V2.md`'s Phase 17
 * section: "Git & Sync renders as a SETUP WIZARD when no repo exists"). A
 * sibling of `share/api.ts`, not an addition to it (that file was already
 * over 500 lines) — same conventions verbatim: every call is a plain
 * RELATIVE `fetch` (`/api/vault...`) with `credentials: "include"`, no
 * `baseUrl` parameter anywhere (roadmap §5.4, single-origin), and
 * `parseJsonOrThrow` (imported from `api.ts` rather than duplicated) is the
 * one place a non-ok response becomes a typed `ShareApiError`.
 *
 * Mirrors `server/app/schemas.py`'s `VaultOut`/`VaultInitIn`/
 * `VaultRemote*`/`MirrorRunOut`/`RemoteTestOut` field for field — see that
 * file's docstrings for what each field means server-side.
 *
 * **Credentials are WRITE-ONLY, end to end.** `VaultRemoteCreateIn`/
 * `VaultRemotePatchIn` accept `ssh_private_key`/`https_token`; `VaultRemoteOut`
 * has NO field for either (only `credential_kind` +
 * `credential_fingerprint`/`credential_last4`, exactly like the server's own
 * `schemas.VaultRemoteOut` — see that class's docstring, and
 * `server/tests/test_vault_mirror.py::test_secrets_never_appear_in_any_
 * remotes_response_json`, which greps every route's raw JSON for the
 * plaintext value). This module never stores a submitted key/token anywhere
 * beyond the one outgoing request body — there is no local cache, no store
 * field, nothing to echo back. Callers (`useVaultStore.ts`,
 * `VaultSetupPanel.tsx`) must keep the same discipline: a credential draft
 * lives only in a form's own transient `useState`, cleared immediately after
 * a successful submit, never pre-filled from a `VaultRemoteOut` (which has
 * nothing to prefill it WITH).
 *
 * `/api/vault[/init]` and `/api/vault/remotes*` are session-authenticated
 * only (`routers/vault.py`/`routers/vault_remotes.py`: `ctx.scope is not
 * None` -> 403) — a scoped API token, even a write-scoped git one, is
 * refused. Every function here can therefore fail with a 401/403 for a
 * signed-out caller; `useVaultStore.ts` is what turns that into the
 * Settings surface's "sign in first" one-row explanation, same pattern
 * `useShareStore.ts` already established for `sharesError`/
 * `adminSettingsError`.
 */
import { parseJsonOrThrow, ShareApiError } from "./api";

export interface VaultOut {
  path: string;
  mounted: boolean;
  initialized: boolean;
  bare: boolean;
  repo_name: string;
  head_branch: string | null;
  has_commits: boolean;
  worktree_dirty: boolean;
  last_commit_message: string | null;
  last_commit_time: number | null;
}

export interface VaultInitIn {
  /** Omit for the server's own default (`gitrepo.DEFAULT_CLIENT_BRANCH`,
   * the exact same branch name this app's own local clone defaults to —
   * `src/git/client.ts`'s `DEFAULT_BRANCH`). */
  branch?: string;
}

export type RemoteCredentialKind = "none" | "ssh_key" | "https_token";

export interface VaultRemoteOut {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  push_on_receive: boolean;
  credential_kind: RemoteCredentialKind;
  credential_fingerprint?: string | null;
  credential_last4?: string | null;
  last_mirror_at?: number | null;
  last_status?: string | null;
  last_error?: string | null;
  created_at: number;
  updated_at: number;
}

export interface VaultRemoteCreateIn {
  name: string;
  url: string;
  enabled?: boolean;
  push_on_receive?: boolean;
  credential_kind?: RemoteCredentialKind;
  /** Required (and only meaningful) when `credential_kind === "ssh_key"`.
   * Sent once, in this one request body, and never read back — see module
   * doc. */
  ssh_private_key?: string;
  /** Required (and only meaningful) when `credential_kind === "https_token"`.
   * Same write-only contract as `ssh_private_key`. */
  https_token?: string;
}

export interface VaultRemotePatchIn {
  name?: string;
  url?: string;
  enabled?: boolean;
  push_on_receive?: boolean;
  /** Omitted entirely means "leave the current credential untouched" (the
   * same "omit means unchanged" convention `SharePatchIn` already uses) —
   * only set this when the caller is actually replacing the credential. */
  credential_kind?: RemoteCredentialKind;
  ssh_private_key?: string;
  https_token?: string;
  /** The explicit sentinel that reverts to `credential_kind: "none"` and
   * deletes the on-disk secret file(s) server-side. Mutually meaningful
   * with `credential_kind` omitted (this is how "clear" differs from
   * "leave unchanged"). */
  clear_credential?: boolean;
}

export type MirrorRunStatus = "success" | "error" | "busy" | "skipped";

export interface MirrorRunOut {
  status: MirrorRunStatus;
  message: string;
  ts: number;
}

export type RemoteTestOutcome = "reachable" | "auth-rejected" | "repo-missing" | "unreachable" | "error";

export interface RemoteTestOut {
  outcome: RemoteTestOutcome;
  message: string;
}

/** `GET /api/vault` — `describe_vault()`, read-only, side-effect-free.
 * Throws `ShareApiError` on a non-ok response (401/403 signed-out, or a
 * genuine server error); callers that need the "never surfaces as an
 * unhandled rejection" discipline (`useVaultStore.ts`) wrap this in their
 * own try/catch, same pattern `useShareStore.ts`'s `refreshShares`/
 * `fetchAdminSettings` already use for their own non-probe, session-gated
 * reads. */
export async function getVault(): Promise<VaultOut> {
  const res = await fetch(`/api/vault`, { credentials: "include" });
  return parseJsonOrThrow<VaultOut>(res);
}

/** `POST /api/vault/init` — the ONLY client call that ever creates the
 * vault repo. 409s (`ShareApiError` with `status === 409`) if one already
 * exists at the vault path — respecting an existing `.git` is binding
 * server-side (see `server/app/vault.py`'s module doc); this client never
 * retries with any kind of force. */
export async function initVault(payload: VaultInitIn = {}): Promise<VaultOut> {
  const res = await fetch(`/api/vault/init`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<VaultOut>(res);
}

export async function listVaultRemotes(): Promise<VaultRemoteOut[]> {
  const res = await fetch(`/api/vault/remotes`, { credentials: "include" });
  return parseJsonOrThrow<VaultRemoteOut[]>(res);
}

export async function createVaultRemote(payload: VaultRemoteCreateIn): Promise<VaultRemoteOut> {
  const res = await fetch(`/api/vault/remotes`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<VaultRemoteOut>(res);
}

export async function patchVaultRemote(id: number, payload: VaultRemotePatchIn): Promise<VaultRemoteOut> {
  const res = await fetch(`/api/vault/remotes/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<VaultRemoteOut>(res);
}

export async function deleteVaultRemote(id: number): Promise<void> {
  const res = await fetch(`/api/vault/remotes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

/** `POST /api/vault/remotes/{id}/mirror` — runs synchronously server-side
 * and returns the outcome (never a background job the client has to poll
 * for). */
export async function mirrorVaultRemoteNow(id: number): Promise<MirrorRunOut> {
  const res = await fetch(`/api/vault/remotes/${id}/mirror`, {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow<MirrorRunOut>(res);
}

/** `POST /api/vault/remotes/{id}/test` — a read-only `git ls-remote`
 * against the configured URL/credential, classified into one of five
 * outcomes server-side (`app/mirror.py::test_remote`). */
export async function testVaultRemote(id: number): Promise<RemoteTestOut> {
  const res = await fetch(`/api/vault/remotes/${id}/test`, {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow<RemoteTestOut>(res);
}

export { ShareApiError };

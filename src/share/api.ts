/**
 * Typed client for the VSNote backend (`server/`) — see `server/README.md`'s
 * "Public share contract" section, which this file implements verbatim on
 * the client side. This module never touches the vault (no `fs/`/`git/`
 * import) and is safe to import from both the normal app shell AND the
 * standalone `share/ShareApp.tsx` route (which must never pull in
 * vault-touching code — see that file's header doc).
 *
 * **Single-origin refactor (Phase 10.5a, roadmap §5.4)**: every call here is
 * a plain RELATIVE `fetch` (`/api/...`, `/share/...`) with
 * `credentials: "include"` — there is no `baseUrl` parameter anywhere in
 * this file anymore. `server/app/main.py` is the SPA's own web server in
 * production (one origin, one process), so a relative URL always reaches
 * the right place with no CORS involved at all (`/api`/`/share`/`/git` all
 * dropped CORSMiddleware this phase — same-origin needs none). In
 * dev/preview, where `vite`/`vite preview` and the backend
 * (`npm run server`) are genuinely different processes/ports,
 * `vite.config.ts`'s proxy config makes these same relative paths reach the
 * real backend transparently — see that file's doc for the full mechanics,
 * including the one case (`/share/{id}` bare, no relpath) that needs
 * content-negotiation-aware `bypass` logic rather than a blanket proxy,
 * because that exact path is ALSO this app's own client-side route for a
 * rendered-mode/folder share page.
 */

/** Short timeout for the reachability probe (`whoami`) — a backend that
 * isn't running should never make the SPA hang; see CLAUDE.md rule 3. */
const PROBE_TIMEOUT_MS = 2500;

export type RenderMode = "raw" | "rendered";
export type GeneralAccess = "restricted" | "link";
export type AuthMode = "none" | "password" | "token";
export type GrantRole = "viewer" | "editor";
/** Phase 10.5 (roadmap §5.1) — `file` is the original Phase 9/10 shape,
 * `folder` shares pin a whole subtree snapshot (a manifest of relpath ->
 * blob, see `ManifestEntryIn`) instead of one `blob_id`. */
export type ShareKind = "file" | "folder";

export interface WhoAmI {
  authenticated: boolean;
  username?: string | null;
  email?: string | null;
  is_admin?: boolean | null;
  source?: string | null;
}

export interface BlobOut {
  id: string;
  size: number;
  media_type_hint?: string | null;
}

export interface GrantIn {
  principal: string;
  role: GrantRole;
}

/** One INCLUDED file in a folder share's snapshot manifest — mirrors the
 * server's `schemas.ManifestEntryIn` (`server/app/schemas.py`).
 * `blob_id` must already exist (`POST /api/blobs` first, exactly like a
 * file share). Entries the owner unchecked in the Publish dialog's
 * checkbox tree are simply absent from this array — see
 * `share/folderManifest.ts`. */
export interface ManifestEntryIn {
  relpath: string;
  blob_id: string;
}

export interface ShareCreateIn {
  source_path: string;
  kind?: ShareKind;
  /** Required when kind is "file" (or omitted); ignored for "folder". */
  blob_id?: string;
  /** Required (non-empty) when kind is "folder"; ignored for "file". */
  manifest?: ManifestEntryIn[];
  live?: boolean;
  render_mode: RenderMode;
  general_access: GeneralAccess;
  auth_mode: AuthMode;
  password?: string;
  alias?: string;
  expires_at?: number;
  grants?: GrantIn[];
}

export interface SharePatchIn {
  alias?: string | null;
  expires_at?: number | null;
  /** Round 6 item 5 — `expires_at: null` parses server-side as "omitted",
   * so never-expires needs its own explicit sentinel (same shape as
   * `clear_password`). */
  clear_expiry?: boolean;
  /** Round 6 item 8 — moved/renamed vault paths update the share record. */
  source_path?: string;
  password?: string;
  clear_password?: boolean;
  general_access?: GeneralAccess;
  auth_mode?: AuthMode;
  render_mode?: RenderMode;
  live?: boolean;
}

export interface ShareOut {
  id: number;
  slug: string;
  alias?: string | null;
  source_path: string;
  kind: ShareKind;
  blob_id?: string | null;
  /** Folder shares only — number of INCLUDED files in the current
   * manifest. `null`/undefined for file shares. */
  manifest_count?: number | null;
  live: boolean;
  render_mode: string;
  general_access: string;
  auth_mode: string;
  has_password: boolean;
  expires_at?: number | null;
  revoked_at?: number | null;
  created_at: number;
  last_access_at?: number | null;
  hit_count: number;
}

export interface ShareContentOut {
  slug: string;
  /** Round 6 items 11/12 — the caller's resolved role ("viewer"|"editor")
   * for THIS request; the reader page gates its editing UI on it. Every
   * write is still re-gated server-side. */
  role?: string | null;
  alias?: string | null;
  source_path: string;
  render_mode: string;
  media_type_hint?: string | null;
  blob_id: string;
  size: number;
  live: boolean;
  content: string;
  content_encoding: "utf-8" | "base64";
  created_at: number;
  last_access_at?: number | null;
  hit_count: number;
}

export interface TokenCreateOut {
  id: number;
  name: string;
  prefix: string;
  scope: string;
  /** The plaintext secret — returned ONLY here, at creation time (the
   * server never stores or re-serves it — `server/app/security.py::
   * hash_token`). Callers must show/copy it immediately. */
  token: string;
  created_at: number;
  expires_at?: number | null;
}

/** One row of a folder share's directory listing — mirrors the server's
 * `schemas.ShareListingEntryOut`. */
export interface ShareListingEntryOut {
  name: string;
  kind: "file" | "dir";
  relpath: string;
  size?: number | null;
  media_type_hint?: string | null;
}

/** `GET /share/{id}` (folder root) or `GET /share/{id}/{relpath}` when
 * `relpath` names a directory — mirrors `schemas.ShareListingOut`. Used by
 * `share/ShareApp.tsx`'s folder-browsing mode to distinguish "this is a
 * listing" from a file's `ShareContentOut` (folder listings always carry
 * `entries`; file content never does). */
export interface ShareListingOut {
  slug: string;
  /** Same as ShareContentOut.role. */
  role?: string | null;
  alias?: string | null;
  kind: "folder";
  prefix: string;
  entries: ShareListingEntryOut[];
  created_at: number;
  last_access_at?: number | null;
  hit_count: number;
}

export interface ManifestEntryOut {
  relpath: string;
  blob_id: string;
  size: number;
  media_type_hint?: string | null;
}

export interface ShareManifestOut {
  entries: ManifestEntryOut[];
}

export class ShareApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ShareApiError";
    this.status = status;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ShareApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** Reachability + auth-status probe — `GET /api/auth/whoami`, short-timeout,
 * NEVER throws: a down/unreachable backend resolves to `null` rather than
 * rejecting, so callers (the boot-time probe, the Settings "Sharing"
 * category) never need a try/catch of their own and this can never surface
 * as an unhandled rejection anywhere in the app (CLAUDE.md rule 3). */
export async function whoami(): Promise<WhoAmI | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/auth/whoami`, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as WhoAmI;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await parseJsonOrThrow(res);
}

export async function logout(): Promise<void> {
  await fetch(`/api/auth/logout`, { method: "POST", credentials: "include" });
}

export async function createBlob(filename: string, content: string, mediaTypeHint?: string): Promise<BlobOut> {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), filename);
  if (mediaTypeHint) form.append("media_type_hint", mediaTypeHint);
  const res = await fetch(`/api/blobs`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJsonOrThrow<BlobOut>(res);
}

export async function createShare(payload: ShareCreateIn): Promise<ShareOut> {
  const res = await fetch(`/api/shares`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<ShareOut>(res);
}

export async function listShares(): Promise<ShareOut[]> {
  const res = await fetch(`/api/shares`, { credentials: "include" });
  return parseJsonOrThrow<ShareOut[]>(res);
}

export async function patchShare(id: number, payload: SharePatchIn): Promise<ShareOut> {
  const res = await fetch(`/api/shares/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<ShareOut>(res);
}

/** `GET /api/shares/{id}/manifest` — owner-only, the current manifest for a
 * folder share. Used by the Publish dialog's "Edit policy…" flow to
 * prefill the checkbox tree's excluded state (an entry NOT in this list is
 * excluded). */
export async function getShareManifest(id: number): Promise<ShareManifestOut> {
  const res = await fetch(`/api/shares/${id}/manifest`, { credentials: "include" });
  return parseJsonOrThrow<ShareManifestOut>(res);
}

/** `PUT /api/shares/{id}/manifest` — "Update share" for a folder share
 * (roadmap §5.1): wholesale-replaces the manifest at the SAME slug. */
export async function updateShareManifest(id: number, manifest: ManifestEntryIn[]): Promise<ShareOut> {
  const res = await fetch(`/api/shares/${id}/manifest`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
  return parseJsonOrThrow<ShareOut>(res);
}

export async function regenerateShare(id: number): Promise<ShareOut> {
  const res = await fetch(`/api/shares/${id}/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow<ShareOut>(res);
}

/** `POST /api/auth/tokens` — mints a new scoped API token for the
 * currently-authenticated owner (session cookie, `credentials: "include"`
 * — same pattern as every other owner-side call here). Used by Settings →
 * "Git & Sync"'s "Generate token" action (Phase 11) as a real, in-app way
 * to get a `write`-scoped token for `gitAuthToken` without leaving the
 * app — the same token model `/git/*` (Phase 11) and `/api/shares` (Phase
 * 9) both already authenticate with, never a second token system. */
export type ApiTokenScope = "read" | "write" | "share-admin";

export async function createApiToken(name: string, scope: ApiTokenScope): Promise<TokenCreateOut> {
  const res = await fetch(`/api/auth/tokens`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, scope }),
  });
  return parseJsonOrThrow<TokenCreateOut>(res);
}

/** Admin-only runtime settings (DESIGN-SPEC Amendments round 5, item 40) —
 * mirrors the server's `schemas.RuntimeSettingsOut`/`RuntimeSettingsIn`.
 * `GET`/`PUT /api/admin/settings` are behind the same app-level identity as
 * every other `/api/*` call in this file (`credentials: "include"`); a
 * non-admin caller gets a 403 (`ShareApiError`), surfaced by
 * `useShareStore.updateAdminSettings`/`fetchAdminSettings`. */
export interface AdminSettingsOut {
  max_blob_bytes: number;
}

export async function getAdminSettings(): Promise<AdminSettingsOut> {
  const res = await fetch(`/api/admin/settings`, { credentials: "include" });
  return parseJsonOrThrow<AdminSettingsOut>(res);
}

export async function putAdminSettings(maxBlobBytes: number): Promise<AdminSettingsOut> {
  const res = await fetch(`/api/admin/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_blob_bytes: maxBlobBytes }),
  });
  return parseJsonOrThrow<AdminSettingsOut>(res);
}

export async function deleteShare(id: number): Promise<void> {
  const res = await fetch(`/api/shares/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

/** `GET /share/{id}` with `Accept: application/json` — the root app's own
 * JSON content-negotiation branch (`server/app/routers/share_public.py`'s
 * `_wants_json`), returning the `ShareContentOut` contract. Used by
 * `share/ShareApp.tsx` for BOTH the initial fetch and the
 * post-password-auth re-fetch — this matters specifically because
 * `POST /share/{id}/auth`'s success cookie is scoped `Path=/share/{id}`,
 * so a request to any OTHER path prefix would never carry it, and a
 * correctly-entered password would 404 forever on the re-fetch. See
 * `vite.config.ts`'s `shareAuthProxy` doc for the dev/preview-only proxy
 * this needs, and how it avoids hijacking this app's own `/share/<slug>`
 * page-navigation route. */
export async function getShareContentSameOrigin(identifier: string): Promise<ShareContentOut> {
  const res = await fetch(`/share/${encodeURIComponent(identifier)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return parseJsonOrThrow<ShareContentOut>(res);
}

/** Phase 10.5 — the folder-share twin of `getShareContentSameOrigin`, same
 * relative-URL/cookie-path reasoning (see that function's doc). `relpath`
 * (`""` for the subtree root) is appended verbatim, `encodeURIComponent`d
 * per segment so a relpath containing `/` still round-trips correctly —
 * the server resolves it with an exact manifest match either way (see
 * `server/app/routers/share_public.py`'s module doc), so there is no
 * traversal concern in doing this client-side encoding. Resolves to
 * EITHER a `ShareListingOut` (root or a directory relpath) or a
 * `ShareContentOut` (a file relpath) — callers discriminate via `"entries"
 * in result`. */
export async function getShareFolderPathSameOrigin(
  identifier: string,
  relpath: string,
): Promise<ShareListingOut | ShareContentOut> {
  const suffix = relpath
    ? `/${relpath
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/")}`
    : "";
  const res = await fetch(`/share/${encodeURIComponent(identifier)}${suffix}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return parseJsonOrThrow<ShareListingOut | ShareContentOut>(res);
}

/** `POST /share/{id}/auth` — a relative URL, same as every other call in
 * this file (see the module header doc). Returns
 * `true` on a 200 (session cookie now set for this slug), `false` on a 404
 * (wrong password, dead share, or nonexistent slug — indistinguishable by
 * design, see `server/README.md`). Any other failure (network error,
 * non-404 non-200) rethrows so the caller can show a real error distinct
 * from "wrong password".
 */
/** Round 6 item 12 — editor write-back. `relpath === ""` targets a
 * single-file share (`PUT /share/{id}`); non-empty targets a file inside a
 * folder share (`PUT /share/{id}/{relpath}`). Both are policy-gated
 * server-side (editor role required; every deny is the uniform 404). */
export async function putShareContent(identifier: string, relpath: string, content: string): Promise<void> {
  const suffix = relpath
    ? `/${relpath
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/")}`
    : "";
  const res = await fetch(`/share/${encodeURIComponent(identifier)}${suffix}`, {
    method: "PUT",
    credentials: "include",
    // Accept declared because the response IS JSON ({ok, blob_id, ...}) —
    // and the dev proxy's navigation heuristic keys on it (vite.config.ts).
    headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "application/json" },
    body: content,
  });
  if (!res.ok) {
    throw new ShareApiError(res.status, `Save failed (HTTP ${res.status}).`);
  }
}

export async function postShareAuth(identifier: string, password: string): Promise<boolean> {
  const res = await fetch(`/share/${encodeURIComponent(identifier)}/auth`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new ShareApiError(res.status, res.statusText);
  return true;
}

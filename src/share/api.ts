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

export interface WhoAmI {
  authenticated: boolean;
  username?: string | null;
  email?: string | null;
  is_admin?: boolean | null;
  source?: string | null;
}

/** `GET /api/app-config` — Phase 17's public, unauthenticated login-gate
 * contract (`server/app/routers/app_config.py`). Mirrors
 * `schemas.AppConfigOut` verbatim: three booleans and nothing else (no
 * vault path, no repo name, no counts — see that router's doc for why). */
export interface AppConfigOut {
  login_required: boolean;
  password_login: boolean;
  cf_access: boolean;
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

export interface ShareCreateIn {
  source_path: string;
  blob_id?: string;
  live?: boolean;
  render_mode: RenderMode;
  general_access: GeneralAccess;
  auth_mode: AuthMode;
  password?: string;
  alias?: string;
  expires_at?: number;
  grants?: GrantIn[];
  /** Round 7 item 57 — default role for "anyone with the link". */
  link_role?: GrantRole;
  /** §5 / DESIGN-SPEC round 10 items 66-67 — both off/unset by default.
   * `show_title` publishes the document's H1 into the page `<title>`/OG
   * meta (server-gated on `auth_mode === "none"` too); `back_link` is a
   * slug-or-alias string pointing at another of the owner's shares. */
  show_title?: boolean;
  back_link?: string;
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
  /** Round 7 items 57/60 — link-wide default role, and wholesale grant
   * replacement (omit = untouched, [] = remove everyone). */
  link_role?: GrantRole;
  grants?: GrantIn[];
  /** §5 / DESIGN-SPEC round 10 items 66-67. Pass "" for `back_link` to
   * clear it (no ambiguous unset-vs-empty distinction, same as `link_role`). */
  show_title?: boolean;
  back_link?: string;
}

export interface ShareOut {
  id: number;
  slug: string;
  alias?: string | null;
  source_path: string;
  blob_id?: string | null;
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
  /** Round 7 items 57/60. */
  link_role: GrantRole;
  grants: GrantIn[];
  /** §5 / DESIGN-SPEC round 10 items 66-67. */
  show_title: boolean;
  back_link?: string | null;
}

/** One line of navigation resolved server-side from `Share.back_link` (a
 * slug-or-alias string, not a foreign key — see
 * `server/app/linkmap.py::resolve_back_link`'s docstring). `null`/absent
 * when unset, or when the target is gone/revoked/expired — the client
 * never needs to know which. */
export interface ShareBackLinkOut {
  href: string;
  label: string;
}

export interface ShareContentOut {
  slug: string;
  /** Round 6 items 11/12 — the caller's resolved role ("viewer"|"editor")
   * for THIS request. The public reader is read-only regardless of role
   * (write-back is an owner-API/future-sync concern, not this route's —
   * see `src/share/ShareApp.tsx`'s header doc); kept here only because the
   * server still returns it. */
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
  /** §5 — vault-relative link target (exactly as written in the markdown)
   * -> the target share's URL path, computed fresh on every fetch by
   * `server/app/linkmap.py::compute_link_map`. Forwarded verbatim to
   * `renderMarkdown`'s `links` option. */
  links: Record<string, string>;
  /** §5 — resolved `back_link`, or `null` when unset/gone. */
  back_link?: ShareBackLinkOut | null;
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

/** Per-share visitor credential (§4.2) — NOT `TokenCreateOut`/`TokenOut`
 * above, which are the owner's account-wide `ApiToken`s. Mirrors
 * `server/app/schemas.py`'s `ShareTokenCreateOut`/`ShareTokenOut`: the
 * plaintext secret is returned exactly once, at mint time. */
export interface ShareTokenCreateOut {
  id: number;
  prefix: string;
  label?: string | null;
  token: string;
  created_at: number;
}

export interface ShareTokenOut {
  id: number;
  prefix: string;
  label?: string | null;
  created_at: number;
  last_used_at?: number | null;
  revoked_at?: number | null;
}

export class ShareApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ShareApiError";
    this.status = status;
  }
}

/** Exported so sibling modules (`share/vaultApi.ts`, Phase 17 Milestone C2)
 * reuse the exact same "throw a typed `ShareApiError` on a non-ok response,
 * reading `detail` when the body is JSON" contract rather than a second,
 * independently-drifting copy. */
export async function parseJsonOrThrow<T>(res: Response): Promise<T> {
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

/** Phase 17's login-gate probe — `GET /api/app-config`, same short-timeout,
 * NEVER-throws discipline as `whoami()` above (see that function's doc):
 * an unreachable/slow backend resolves to `null` rather than rejecting, so
 * `main.tsx`'s gate check (which runs unconditionally on EVERY boot, unlike
 * every other call in this file) can never surface as an unhandled
 * rejection or a thrown exception, and a `null` result is exactly what lets
 * the gate's own logic read as "never gate on an unreachable backend" with
 * no separate offline branch (CLAUDE.md rule 3).
 *
 * Because this fires on every single boot — including a genuinely offline
 * PWA cold start, which `tests/e2e/probes.spec.ts`'s hard-gate spec
 * exercises — a plain client-side `fetch()` failure here is not enough on
 * its own: Chromium logs "Failed to load resource: net::ERR_..." to the
 * page console for ANY request that fails at the network layer, regardless
 * of whether application code catches the rejection (confirmed empirically;
 * see `App.tsx`'s boot-effect doc for the identical finding that kept this
 * app's OTHER probes lazy/opt-in instead of unconditional at boot). Unlike
 * those, this one genuinely needs to run on every boot to decide gating —
 * so the offline-safe fallback lives one layer down instead, in
 * `vite.config.ts`'s `runtimeCaching` entry for this exact path: the
 * service worker intercepts the request and, only when its OWN internal
 * fetch to the network fails, resolves it with a synthetic
 * `{login_required:false,...}` response rather than letting the browser's
 * resource loader ever see (and log) a failed load. This function's own
 * try/catch below is still real defense in depth for a request the SW
 * genuinely can't intercept (e.g. no SW support at all, or a fresh
 * never-cached load with no active worker yet) — those are inherently
 * outside what a client-side fix can silence at the console level, but
 * they're also not the tested/expected path. */
export async function getAppConfig(): Promise<AppConfigOut | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/app-config`, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as AppConfigOut;
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

/** `POST /api/shares/{id}/tokens` — mints a new per-share bearer token
 * (§4.2). Owner-only (`share-admin` scope, same as every other
 * `/api/shares/{id}/...` call in this file), 404-uniform for a share the
 * caller doesn't own. The plaintext secret is in the response ONLY here —
 * see `ShareTokenCreateOut`'s doc. */
export async function createShareToken(shareId: number, label?: string): Promise<ShareTokenCreateOut> {
  const res = await fetch(`/api/shares/${shareId}/tokens`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label ?? null }),
  });
  return parseJsonOrThrow<ShareTokenCreateOut>(res);
}

/** `GET /api/shares/{id}/tokens` — list response, never the secret or even
 * its hash (`ShareTokenOut`). */
export async function listShareTokens(shareId: number): Promise<ShareTokenOut[]> {
  const res = await fetch(`/api/shares/${shareId}/tokens`, { credentials: "include" });
  return parseJsonOrThrow<ShareTokenOut[]>(res);
}

/** `DELETE /api/shares/{id}/tokens/{tokenId}` — revokes one per-share
 * token. Rotation is mint-new-then-revoke-old (two calls), not a dedicated
 * endpoint — see `server/app/routers/shares.py`'s doc for why. */
export async function revokeShareToken(shareId: number, tokenId: number): Promise<void> {
  const res = await fetch(`/api/shares/${shareId}/tokens/${tokenId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
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
    // §5: `links`/`back_link` are recomputed fresh on every request, so a
    // stale HTTP-cached copy of this exact response silently un-does
    // "revoking a share breaks its links everywhere, immediately" — worse,
    // the server negotiates this SAME URL's Content-Type on `Accept`, and a
    // browser's HTTP cache keys purely on URL unless the response carries
    // `Vary: Accept`; without `no-store` a plain document navigation
    // (`Accept: text/html`, e.g. the browser's own back button) can be
    // served this fetch's own cached JSON body instead of the SPA shell.
    // `no-store` sidesteps both failure modes rather than depending on
    // response caching headers this client doesn't control.
    cache: "no-store",
  });
  return parseJsonOrThrow<ShareContentOut>(res);
}

/** `POST /share/{id}/auth` — a relative URL, same as every other call in
 * this file (see the module header doc). Returns
 * `true` on a 200 (session cookie now set for this slug), `false` on a 404
 * (wrong password, dead share, or nonexistent slug — indistinguishable by
 * design, see `server/README.md`). Any other failure (network error,
 * non-404 non-200) rethrows so the caller can show a real error distinct
 * from "wrong password".
 */
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

/**
 * Typed client for the Phase 9 backend (`server/`, frozen — see
 * `server/README.md`'s "Public share contract" section, which this file
 * implements verbatim on the client side). Phase 10 scope only: this module
 * never touches the vault (no `fs/`/`git/` import) and is safe to import
 * from both the normal app shell AND the standalone `share/ShareApp.tsx`
 * route (which must never pull in vault-touching code — see that file's
 * header doc).
 *
 * Every `/api/*` call is a plain absolute-URL `fetch` against the
 * caller-supplied `baseUrl` (Settings' "Sharing" category, persisted in
 * `useSettingsStore`, default `http://127.0.0.1:8787`) with
 * `credentials: "include"` — the backend's `/api` sub-app has CORS locked to
 * `SLATE_CORS_ORIGINS` (`allow_credentials: true`, never a wildcard), so a
 * cross-origin fetch from the SPA's own origin works as long as that origin
 * is in the backend's configured allow-list (the shipped default already
 * includes `http://127.0.0.1:5290`/`http://localhost:5290`, this app's own
 * `vite preview` origin).
 *
 * ONE deliberate exception: `postShareAuth()` below calls a **relative**
 * URL (`/share/{id}/auth`), never `baseUrl`. That endpoint is mounted on the
 * backend's ROOT app (`server/app/main.py`), which carries **no**
 * `CORSMiddleware` at all, by design (a raw share response must carry zero
 * CORS headers — `server/tests/test_raw_mode.py::test_no_cors_on_raw`). A
 * cross-origin `fetch` to a route with no CORS headers doesn't merely lose
 * response *headers*, the whole response becomes unreadable — `fetch()`
 * rejects with `TypeError: Failed to fetch` even for a "simple" POST that
 * needed no preflight, because the browser refuses to hand a cross-origin
 * script a response the server never opted into sharing. That's
 * unfixable from this side without server changes (out of Phase 10 scope —
 * `server/` is frozen). The real production topology
 * (`server/README.md`'s Cloudflare Access diagram) serves the SPA's static
 * assets AND `/share/*` from the exact same origin/process, so a relative
 * URL there needs no proxy at all and just works. For local dev/test, where
 * the SPA (`vite dev`/`vite preview`, port 5290) and the backend (uvicorn,
 * port 8787/8788) are genuinely different origins, `vite.config.ts` adds a
 * narrow proxy (`^/share/[^/]+/auth$` only — never the bare `/share/{slug}`
 * path, which the SPA's own router owns for rendered-mode shares) that
 * forwards this one relative path to the real backend, standing in for the
 * "same origin in production" reality. See `vite.config.ts`'s
 * `SHARE_AUTH_PROXY_TARGET` for how the target is chosen, and
 * `docs/ARCHITECTURE.md`'s "Sharing (Phase 10)" section for the full
 * writeup of this asymmetry.
 */

export const DEFAULT_SHARE_BACKEND_URL = "http://127.0.0.1:8787";

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
  blob_id: string;
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
  blob_id: string;
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

export class ShareApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ShareApiError";
    this.status = status;
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
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
export async function whoami(baseUrl: string): Promise<WhoAmI | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${trimBase(baseUrl)}/api/auth/whoami`, {
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

export async function login(baseUrl: string, username: string, password: string): Promise<void> {
  const res = await fetch(`${trimBase(baseUrl)}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await parseJsonOrThrow(res);
}

export async function logout(baseUrl: string): Promise<void> {
  await fetch(`${trimBase(baseUrl)}/api/auth/logout`, { method: "POST", credentials: "include" });
}

export async function createBlob(baseUrl: string, filename: string, content: string, mediaTypeHint?: string): Promise<BlobOut> {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), filename);
  if (mediaTypeHint) form.append("media_type_hint", mediaTypeHint);
  const res = await fetch(`${trimBase(baseUrl)}/api/blobs`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJsonOrThrow<BlobOut>(res);
}

export async function createShare(baseUrl: string, payload: ShareCreateIn): Promise<ShareOut> {
  const res = await fetch(`${trimBase(baseUrl)}/api/shares`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<ShareOut>(res);
}

export async function listShares(baseUrl: string): Promise<ShareOut[]> {
  const res = await fetch(`${trimBase(baseUrl)}/api/shares`, { credentials: "include" });
  return parseJsonOrThrow<ShareOut[]>(res);
}

export async function patchShare(baseUrl: string, id: number, payload: SharePatchIn): Promise<ShareOut> {
  const res = await fetch(`${trimBase(baseUrl)}/api/shares/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<ShareOut>(res);
}

export async function regenerateShare(baseUrl: string, id: number): Promise<ShareOut> {
  const res = await fetch(`${trimBase(baseUrl)}/api/shares/${id}/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow<ShareOut>(res);
}

export async function deleteShare(baseUrl: string, id: number): Promise<void> {
  const res = await fetch(`${trimBase(baseUrl)}/api/shares/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

/** `GET /api/share/{id}/content` — the CORS-enabled twin of the root app's
 * `GET /share/{id}` (see `server/README.md`'s "Public share contract").
 * The spec-following default for a deployment where the SPA is genuinely
 * cross-origin from the backend. `share/ShareApp.tsx` does NOT use this —
 * see `getShareContentSameOrigin`'s doc for the concrete cookie-path bug
 * that makes the same-origin variant the correct choice for THIS app's own
 * rendered-share page specifically. Kept here (exported, tested via the
 * curl/HTTP-level verification in this phase's final report) as the
 * documented option for a genuinely cross-origin deployment. */
export async function getShareContent(baseUrl: string, identifier: string): Promise<ShareContentOut> {
  const res = await fetch(`${trimBase(baseUrl)}/api/share/${encodeURIComponent(identifier)}/content`, {
    credentials: "include",
  });
  return parseJsonOrThrow<ShareContentOut>(res);
}

/** `GET /share/{id}` with `Accept: application/json` — the root app's own
 * JSON content-negotiation branch (`server/app/routers/share_public.py`'s
 * `_wants_json`), returning the exact same `ShareContentOut` contract as
 * `getShareContent` above. Used by `share/ShareApp.tsx` for BOTH the
 * initial fetch and the post-password-auth re-fetch: a RELATIVE url (same
 * asymmetry as `postShareAuth` — see this module's header doc), which
 * matters specifically because `POST /share/{id}/auth`'s success cookie is
 * scoped `Path=/share/{id}` — a request to `/api/share/{id}/content`
 * (different path prefix) would never carry that cookie, so a correctly-
 * entered password would 404 forever on the re-fetch if this app used the
 * `/api/...` route instead. See `vite.config.ts`'s `shareAuthProxy` doc
 * (Rule 2) for the dev/preview-only proxy this needs, and how it avoids
 * hijacking this app's own `/share/<slug>` page-navigation route. */
export async function getShareContentSameOrigin(identifier: string): Promise<ShareContentOut> {
  const res = await fetch(`/share/${encodeURIComponent(identifier)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return parseJsonOrThrow<ShareContentOut>(res);
}

/** `POST /share/{id}/auth` — see this module's header doc for why this is
 * the one call that uses a RELATIVE url instead of `baseUrl`. Returns
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

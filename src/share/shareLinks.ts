/**
 * Share-link URL construction — pure logic, unit-tested
 * (`tests/unit/shareLinks.test.ts`).
 *
 * A share's `render_mode` picks which ORIGIN the copied link points at, not
 * a query param on a shared path shape:
 *  - `"raw"` → the backend's own origin, `GET /share/{slug}` (root app,
 *    `text/plain`, never touched by the SPA — see `server/README.md`'s
 *    "Public share contract").
 *  - `"rendered"` → THIS APP's own origin, `/share/{slug}` — routed by
 *    `main.tsx` to `share/ShareApp.tsx` (no shell chrome, no vault access),
 *    which fetches the real content from the backend itself via the
 *    CORS-enabled `GET /api/share/{id}/content`.
 * This is also why raw mode needs no proxy/CORS consideration at all: the
 * recipient's browser talks to the backend directly, never through this
 * app's origin.
 */
import type { RenderMode } from "./api";

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The identifier to put in the link — the custom alias if one is set
 * (nicer for humans to read/share), else the random slug. Both resolve
 * identically server-side (`policy.lookup_share` matches slug OR alias). */
export function shareIdentifier(share: { slug: string; alias?: string | null }): string {
  return share.alias && share.alias.length > 0 ? share.alias : share.slug;
}

export function buildShareLink(
  share: { slug: string; alias?: string | null; render_mode: string | RenderMode },
  backendBaseUrl: string,
  appOrigin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  const id = shareIdentifier(share);
  return share.render_mode === "rendered" ? `${appOrigin}/share/${id}` : `${trimBase(backendBaseUrl)}/share/${id}`;
}

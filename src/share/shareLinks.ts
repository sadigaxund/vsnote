/**
 * Share-link URL construction — pure logic, unit-tested
 * (`tests/unit/shareLinks.test.ts`).
 *
 * Single-origin refactor (Phase 10.5a, roadmap §5.4): front + back are ONE
 * origin now, so every share link — raw or rendered, file or folder —
 * points at THIS app's own origin, `/share/{slug}`. There's no more
 * "backend origin" distinct from "app origin" to pick between: a real
 * browser navigation to that URL is content-negotiated server-side
 * (`server/app/routers/share_public.py`'s `_wants_html`) into either raw
 * `text/plain` (raw-mode file shares — never touches the SPA at all) or the
 * SPA shell (rendered-mode file shares and every folder share, which then
 * fetches the real content itself via `Accept: application/json`) — see
 * that module's doc for the exact rule. This function no longer needs to
 * know `render_mode` at all to build the correct link.
 */
import type { RenderMode } from "./api";

/** The identifier to put in the link — the custom alias if one is set
 * (nicer for humans to read/share), else the random slug. Both resolve
 * identically server-side (`policy.lookup_share` matches slug OR alias). */
export function shareIdentifier(share: { slug: string; alias?: string | null }): string {
  return share.alias && share.alias.length > 0 ? share.alias : share.slug;
}

export function buildShareLink(
  share: { slug: string; alias?: string | null; render_mode?: string | RenderMode },
  appOrigin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  const id = shareIdentifier(share);
  return `${appOrigin}/share/${id}`;
}

/**
 * Phase 10.5 — a folder share's link (and any deep link to a file/
 * directory inside its subtree), same single-origin URL shape as
 * `buildShareLink` above, extended with an optional `relpath` so a deep
 * link into the subtree round-trips as a real path (each segment
 * `encodeURIComponent`d individually, so a relpath containing `/` isn't
 * collapsed into one escaped segment). A folder share's own `render_mode`
 * only decides how an individual FILE's content is displayed once you're
 * already inside the reader page (raw = plain-text pane, rendered = the
 * real markdown/HTML pipeline), never which URL the link itself uses.
 */
export function buildFolderShareLink(
  share: { slug: string; alias?: string | null },
  appOrigin: string = typeof window !== "undefined" ? window.location.origin : "",
  relpath = "",
): string {
  const id = shareIdentifier(share);
  const suffix = relpath
    ? `/${relpath
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/")}`
    : "";
  return `${appOrigin}/share/${id}${suffix}`;
}

/**
 * "Links in this file" — pure logic, unit-tested (`tests/unit/linksInFile.
 * test.ts`). Publish dialog's Rendered-mode step (docs/PLAN-2026-09-05-
 * refresh.md §5's owner side): for the file being published, list every
 * OUTGOING relative markdown link, resolved to a vault-display path
 * (`"vault/notes/x.md"`, the same string `ShareOut.source_path` uses), and
 * say whether that target is one of the owner's own active shares.
 *
 * Reuses `markdown/render.tsx`'s `parseAndRewriteLinks` (mdast `Root`) as
 * the ONE markdown parser in this app (CLAUDE.md rule 7's "one stack"
 * spirit extends to parsing too) — this module only WALKS the tree it
 * returns, never re-parses markdown itself.
 */
import type { Link, Root, RootContent } from "mdast";
import { parseAndRewriteLinks } from "../markdown/render";

/** True for a scheme/absolute reference this feature has no business
 * touching — external links, mail links, in-page anchors, and vault-
 * absolute paths (a bare leading `/` is a site-root reference, not a
 * sibling-relative one). Everything else (`./x.md`, `../x.md`, `x.md`,
 * `sub/x.md`) is a same-vault relative link. */
function isExternalOrAbsolute(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)/i.test(url) || url.startsWith("#") || url.startsWith("/");
}

/** Vault-display-path-space `dirname` — `"vault/notes/x.md"` ->
 * `"vault/notes"`; `"vault/x.md"` -> `"vault"`. No filesystem/Node `path`
 * dependency (this module runs in the browser bundle same as every other
 * `share/*` module). */
function dirnameDisplay(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Resolves a relative link `target` (as written in markdown, e.g.
 * `"./part-2.md"`, `"../x.md"`, `"sibling.md"`) against the display path of
 * the file it was written in, collapsing `.`/`..` segments. Returns `null`
 * for a link that resolves above the vault root (malformed) or that isn't
 * relative at all (see `isExternalOrAbsolute`). */
export function resolveRelativeVaultLink(fromDisplayPath: string, target: string): string | null {
  const bare = target.split(/[?#]/)[0]; // strip a query/hash suffix, if any
  if (!bare || isExternalOrAbsolute(bare)) return null;
  const base = dirnameDisplay(fromDisplayPath).split("/").filter(Boolean);
  const parts = bare.split("/");
  const stack = [...base];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

export interface FileLink {
  /** Exactly as written in the source markdown, e.g. `"./part-2.md"`. */
  raw: string;
  /** Resolved vault-display path, e.g. `"vault/notes/part-2.md"`. */
  target: string;
}

function walk(nodes: RootContent[], out: Link[]): void {
  for (const node of nodes) {
    if (node.type === "link") out.push(node as Link);
    const children = (node as { children?: RootContent[] }).children;
    if (children) walk(children, out);
  }
}

/** Every relative markdown-file link found in `content` (written as if it
 * lives at `filePath`), deduplicated by resolved target and in first-seen
 * order. Non-`.md`/`.mk.md` relative targets (an image, a PDF) are excluded
 * — "Links in this file" is about note-to-note navigation, the thing a
 * "blog" needs (docs/PLAN-2026-09-05-refresh.md §5), not every asset
 * reference. */
export function extractRelativeFileLinks(filePath: string, content: string): FileLink[] {
  // `degradeUnresolvedRelativeLinks` defaults to `true` in `render.tsx`
  // (rewrites an unresolved relative `.md` link's `url` to the
  // `mk-unresolved:` sentinel scheme, for RENDERING) — this module reads
  // links, it doesn't render them, and that sentinel would make every
  // still-unshared link look "external" to `isExternalOrAbsolute` above
  // and vanish. Pass `links: {}` (nothing pre-resolved) with degrading
  // OFF so every relative link's `url` survives exactly as written.
  const root: Root = parseAndRewriteLinks(content, { links: {}, degradeUnresolvedRelativeLinks: false });
  const links: Link[] = [];
  walk(root.children as RootContent[], links);
  const seen = new Set<string>();
  const result: FileLink[] = [];
  for (const link of links) {
    const target = resolveRelativeVaultLink(filePath, link.url);
    if (!target || !/\.mk\.md$|\.md$/i.test(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    result.push({ raw: link.url, target });
  }
  return result;
}

/** Pairs each resolved link with the owner's matching active share (if
 * any) — the "Shared as /share/x" vs "Not shared" split the dialog shows. */
export interface FileLinkStatus extends FileLink {
  share: { id: number; slug: string; alias?: string | null } | null;
}

export function statusForLinks<T extends { id: number; slug: string; alias?: string | null; source_path: string; revoked_at?: number | null }>(
  links: FileLink[],
  shares: readonly T[],
): FileLinkStatus[] {
  return links.map((link) => {
    const share = shares.find((s) => !s.revoked_at && s.source_path === link.target) ?? null;
    return { ...link, share: share ? { id: share.id, slug: share.slug, alias: share.alias } : null };
  });
}

/**
 * Path vocabulary shared by `fs/` and `git/`.
 *
 * Three flavors of the same location, used at different boundaries:
 * - "display path" — what the UI (tree/tabs/breadcrumbs) shows, e.g.
 *   `vault/notes/architecture.md`. Matches `FileNode.id`/`FileNode.path` from
 *   Phase 1's `demoVault.ts` exactly, so swapping data sources needed no
 *   changes to any component prop shape.
 * - "fs path" — absolute path lightning-fs understands, e.g.
 *   `/vault/notes/architecture.md`.
 * - "repo path" — path relative to the git working directory (`VAULT_DIR`),
 *   e.g. `notes/architecture.md`. This is what isomorphic-git's `filepath`
 *   arguments expect.
 */

/** The git working directory (and lightning-fs root folder) for the vault. */
export const VAULT_DIR = "/vault";

/** The "vault" display-name segment used as the id/path prefix in the tree. */
export const VAULT_LABEL = "vault";

export function displayToFsPath(displayPath: string): string {
  if (displayPath === VAULT_LABEL) return VAULT_DIR;
  return `/${displayPath}`;
}

export function fsToDisplayPath(fsPath: string): string {
  return fsPath.replace(/^\//, "");
}

export function displayToRepoPath(displayPath: string): string {
  if (displayPath === VAULT_LABEL) return "";
  return displayPath.slice(VAULT_LABEL.length + 1);
}

export function repoToDisplayPath(repoPath: string): string {
  return repoPath ? `${VAULT_LABEL}/${repoPath}` : VAULT_LABEL;
}

export function repoToFsPath(repoPath: string): string {
  return repoPath ? `${VAULT_DIR}/${repoPath}` : VAULT_DIR;
}

export function fsToRepoPath(fsPath: string): string {
  return fsPath.slice(VAULT_DIR.length + 1);
}

/** Parent of a display path, e.g. `vault/src/indexer.ts` -> `vault/src`;
 * anything directly under the vault root (or the root itself) -> `vault`. */
export function parentOfDisplayPath(displayPath: string): string {
  const idx = displayPath.lastIndexOf("/");
  return idx <= 0 ? VAULT_LABEL : displayPath.slice(0, idx);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx <= 0 ? "" : base.slice(idx + 1).toLowerCase();
}

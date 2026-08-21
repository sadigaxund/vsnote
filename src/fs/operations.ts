/**
 * Low-level virtual-FS operations over the lightning-fs singleton
 * (`client.ts`). Everything here works in absolute "fs paths"
 * (`/vault/notes/architecture.md`) — callers translate to/from "display
 * paths" via `paths.ts`. No git awareness lives here; `stores/useFsStore`
 * combines this with `git/status.ts` to decorate the tree.
 */
import { pfs } from "./client";
import { dirname } from "./paths";
import { LruTtlCache } from "../lib/lruCache";

export type FsNodeType = "file" | "dir";

export interface RawTreeNode {
  name: string;
  path: string; // fs path
  type: FsNodeType;
  mtimeMs: number;
  children?: RawTreeNode[];
}

/** Recursively creates every missing segment of a directory path. */
export async function ensureDir(fsPath: string): Promise<void> {
  if (!fsPath || fsPath === "/") return;
  const segments = fsPath.split("/").filter(Boolean);
  let cur = "";
  for (const seg of segments) {
    cur += `/${seg}`;
    try {
      await pfs.mkdir(cur);
    } catch (err) {
      if (!isExistsError(err)) throw err;
    }
  }
}

function isExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "EEXIST"
  );
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

export async function pathExists(fsPath: string): Promise<boolean> {
  try {
    await pfs.stat(fsPath);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

export async function statType(fsPath: string): Promise<FsNodeType | null> {
  try {
    const s = await pfs.stat(fsPath);
    return s.isDirectory() ? "dir" : "file";
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function readTextFile(fsPath: string): Promise<string> {
  // TODO §6.1.1 (vercel-labs server-cache-lru, translated): repeated reads
  // of unchanged files (tree paints, search sweeps) skip the IndexedDB
  // round-trip. Correctness: EVERY mutation in this module clears the
  // cache outright (mutations are rare relative to reads), and git flows
  // that rewrite the worktree outside this module (fastForwardBranch's
  // checkout) clear it explicitly. The TTL is a backstop for any bypass
  // path a future contributor adds without invalidating.
  const hit = readCache.get(fsPath);
  if (hit !== undefined) return hit;
  const value = (await pfs.readFile(fsPath, { encoding: "utf8" })) as string;
  readCache.set(fsPath, value);
  return value;
}

const readCache = new LruTtlCache<string>(500, 5_000);

/** Drops all cached reads — call after ANY code path that changes vault
 * bytes without going through this module's mutators. */
export function clearReadCache(): void {
  readCache.clear();
}

export async function readBinaryFile(fsPath: string): Promise<Uint8Array> {
  const data = await pfs.readFile(fsPath);
  return data as Uint8Array;
}

export async function writeFile(
  fsPath: string,
  content: string | Uint8Array,
): Promise<void> {
  await ensureDir(dirname(fsPath));
  await pfs.writeFile(fsPath, content, typeof content === "string" ? "utf8" : undefined);
  await flush();
  readCache.clear();
}

export async function removeFile(fsPath: string): Promise<void> {
  await pfs.unlink(fsPath);
  await flush();
  readCache.clear();
}

/** Recursively deletes a file or directory. */
export async function removePath(fsPath: string): Promise<void> {
  const type = await statType(fsPath);
  if (type === null) return;
  if (type === "file") {
    await pfs.unlink(fsPath);
    await flush();
    readCache.clear();
    return;
  }
  const names = await pfs.readdir(fsPath);
  for (const name of names) {
    await removePath(`${fsPath}/${name}`);
  }
  await pfs.rmdir(fsPath);
  await flush();
  readCache.clear();
}

export async function renamePath(oldFsPath: string, newFsPath: string): Promise<void> {
  await ensureDir(dirname(newFsPath));
  await pfs.rename(oldFsPath, newFsPath);
  await flush();
  readCache.clear();
}

/**
 * lightning-fs persists its in-memory directory/inode structure (the
 * "superblock") to IndexedDB on its own internal ~500ms idle debounce
 * (see its README: "The in-memory portion of the filesystem is persisted
 * to IndexedDB with a debounce of 500ms") — separate from, and IN ADDITION
 * TO, this app's own 300ms draft-checkpoint debounce (`fs/drafts.ts`).
 * Without forcing a flush, a write immediately followed by a real page
 * reload (not just an in-session read, which hits the same instance's
 * in-memory cache and looks durable even when it isn't yet) can lose the
 * write entirely — reproduced while testing DESIGN-SPEC Amendments item 6
 * ("closing/reloading the browser NEVER loses unsaved work"): a draft
 * wrote successfully, read back fine in the same tab, then vanished after
 * an immediate reload because the superblock update hadn't reached
 * IndexedDB yet. `pfs.flush()` forces it synchronously after every
 * mutating fs call in this module, trading a little latency for the
 * "never loses work" guarantee actually holding.
 */
async function flush(): Promise<void> {
  await pfs.flush();
}

/**
 * Recursively lists a directory into a tree, sorted folders-first then by
 * creation order (`mtimeMs`) — matches the deliberate, non-alphabetical
 * ordering in DESIGN-SPEC §3 (`notes`, `src`, `assets`, then the loose
 * files), which reflects the order the seeder created them in, not name
 * sort. New files created during the session sort after existing siblings
 * for the same reason (most-recently-created last), matching VSCode's
 * "new item appears at the bottom of its group" behavior.
 */
export async function readTree(rootFsPath: string): Promise<RawTreeNode[]> {
  const exists = await pathExists(rootFsPath);
  if (!exists) return [];

  async function walk(fsPath: string): Promise<RawTreeNode[]> {
    const names = (await pfs.readdir(fsPath)).filter((name) => !name.startsWith("."));
    const nodes = await Promise.all(
      names.map(async (name): Promise<RawTreeNode> => {
        const childPath = `${fsPath}/${name}`;
        const s = await pfs.stat(childPath);
        const isDir = s.isDirectory();
        return {
          name,
          path: childPath,
          type: isDir ? "dir" : "file",
          mtimeMs: s.mtimeMs,
          children: isDir ? await walk(childPath) : undefined,
        };
      }),
    );
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.mtimeMs - b.mtimeMs;
    });
    return nodes;
  }

  return walk(rootFsPath);
}

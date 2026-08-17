/**
 * DESIGN-SPEC Amendments round 5 item 39 — importing OS content into the
 * vault: (a) dragging files/folders from the OS onto the file tree, (b)
 * Ctrl+V pasting clipboard files/images into the selected folder.
 *
 * Split deliberately into PURE helpers (name/path math, byte-free) and a
 * thin async orchestration layer at the bottom that actually touches
 * `fs/operations.ts` (`pathExists`/`writeFile`) — the pure half is what
 * `tests/unit/importEntries.test.ts` exercises directly, no lightning-fs/
 * IndexedDB involved, per Phase 15's "testable pure-ish helpers" ask.
 *
 * Browser-entry types below (`FileSystemEntryLike`, `DataTransferItemLike`,
 * `ImportableFile`) are deliberately NOT the real DOM lib types
 * (`FileSystemEntry`/`DataTransferItem`/`File`) — they're minimal
 * structural subsets of them. A real browser `File`/`FileSystemEntry`
 * satisfies these interfaces for free (TypeScript structural typing), so
 * `ExplorerTree.tsx` (real DOM events) and this file's own unit tests
 * (plain fakes, no DOM available under `environment: "node"` — see
 * `vitest.config.ts`) both compile and run against the exact same code
 * path, rather than one being a reimplementation of the other.
 */
import { pathExists, writeFile } from "./operations";
import { displayToFsPath, fsToDisplayPath } from "./paths";

/** A file/blob-like object this module needs: a name, a MIME type, and a
 * way to read its bytes. Real DOM `File` objects satisfy this already. */
export interface ImportableFile {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** One flattened import candidate: `relativePath` is `/`-joined and
 * relative to the drop/paste target folder (nested OS folders preserved,
 * e.g. `subdir/photo.png`; a flat paste is just `photo.png`). */
export interface FlattenedEntry {
  relativePath: string;
  file: ImportableFile;
}

// ---------------------------------------------------------------------------
// Directory-entry traversal (drag-drop from the OS, when the browser hands
// us `DataTransferItem.webkitGetAsEntry()` results).
// ---------------------------------------------------------------------------

export interface FileSystemEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
}

export interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  file(success: (file: ImportableFile) => void, error?: (err: unknown) => void): void;
}

export interface FileSystemDirectoryReaderLike {
  /** Per spec, a single call is not guaranteed to return every child —
   * callers must keep calling until an empty batch comes back. */
  readEntries(success: (entries: FileSystemEntryLike[]) => void, error?: (err: unknown) => void): void;
}

export interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isDirectory: true;
  createReader(): FileSystemDirectoryReaderLike;
}

function isFileEntry(entry: FileSystemEntryLike): entry is FileSystemFileEntryLike {
  return entry.isFile;
}

function isDirEntry(entry: FileSystemEntryLike): entry is FileSystemDirectoryEntryLike {
  return entry.isDirectory;
}

function readEntryFile(entry: FileSystemFileEntryLike): Promise<ImportableFile> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readAllDirectoryEntries(entry: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  const all: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

/** Recursively flattens one `FileSystemEntry`-like node (file or directory)
 * into a flat list of `{relativePath, file}`, preserving nested-folder
 * structure in the relative path. */
export async function flattenEntry(entry: FileSystemEntryLike, basePath = ""): Promise<FlattenedEntry[]> {
  const path = basePath ? `${basePath}/${entry.name}` : entry.name;
  if (isFileEntry(entry)) {
    const file = await readEntryFile(entry);
    return [{ relativePath: path, file }];
  }
  if (isDirEntry(entry)) {
    const children = await readAllDirectoryEntries(entry);
    const nested = await Promise.all(children.map((child) => flattenEntry(child, path)));
    return nested.flat();
  }
  return [];
}

// ---------------------------------------------------------------------------
// OS drag-drop capture. `DataTransferItem.getAsFile()`/`.webkitGetAsEntry()`
// are only valid to CALL synchronously within the originating drop event's
// task (browsers invalidate the drag data store once that task finishes) —
// `captureDataTransferItems` is the synchronous half a caller (`ExplorerTree`'s
// `onDrop`) must run with no `await` in between; the `FileSystemEntry`/`File`
// objects it returns stay valid afterward, so the actual (necessarily async,
// directory-recursive) flattening is a separate step below.
// ---------------------------------------------------------------------------

export interface DataTransferItemLike {
  readonly kind: string;
  getAsFile(): ImportableFile | null;
  /** Chromium + Firefox both expose this (despite the `webkit` name); a
   * browser that doesn't degrades to flat file-only import below. */
  webkitGetAsEntry?(): FileSystemEntryLike | null;
}

type CapturedItem = FileSystemEntryLike | FlattenedEntry;

function isFlattenedEntry(item: CapturedItem): item is FlattenedEntry {
  return "relativePath" in item;
}

/** Synchronous capture step — call this INSIDE the native `drop` handler,
 * before any `await`. Degrades gracefully: an item with no
 * `webkitGetAsEntry` (or one that returns null, e.g. Safari, or a plain
 * file with no OS folder behind it) falls back to `getAsFile()` as a flat,
 * non-nested entry rather than being dropped. */
export function captureDataTransferItems(items: ArrayLike<DataTransferItemLike>): CapturedItem[] {
  const captured: CapturedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.kind !== "file") continue;
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      captured.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) captured.push({ relativePath: file.name, file });
  }
  return captured;
}

/** Async flattening step for whatever `captureDataTransferItems` captured —
 * safe to `await` freely, unlike the capture step itself. */
export async function flattenCapturedItems(captured: CapturedItem[]): Promise<FlattenedEntry[]> {
  const nested = await Promise.all(
    captured.map((item) => (isFlattenedEntry(item) ? Promise.resolve([item]) : flattenEntry(item))),
  );
  return nested.flat();
}

/** Convenience wrapper (capture + flatten in one call) for callers that
 * don't need the sync/async split — i.e. everywhere except a live `drop`
 * event handler, including this file's own unit tests. */
export async function flattenDataTransferItems(items: ArrayLike<DataTransferItemLike>): Promise<FlattenedEntry[]> {
  return flattenCapturedItems(captureDataTransferItems(items));
}

// ---------------------------------------------------------------------------
// Ctrl+V paste. Uses the native `paste` DOM event's `clipboardData`, not the
// async Clipboard API (`navigator.clipboard.read()`) — the native event
// needs no permission grant and fires directly from the user's own Ctrl+V
// keystroke, so there is no "permission denied" failure mode to begin with;
// `extractClipboardFiles` still never throws (wrapped defensively) for a
// null/empty clipboardData or a `getAsFile()` that misbehaves.
// ---------------------------------------------------------------------------

export interface DataTransferLike {
  readonly items?: ArrayLike<DataTransferItemLike>;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/** A bare pasted image (no filename, e.g. a screenshot copied straight from
 * the OS) gets a timestamped name so it never collides and always sorts by
 * paste time. `now`/offset are injectable for deterministic tests. */
export function timestampedImageName(mimeType: string, now: Date = new Date()): string {
  const ext = IMAGE_EXTENSIONS[mimeType] ?? "png";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

/**
 * Whether a clipboard entry is a "bare" image in item 39's sense: pixels off
 * the clipboard rather than a file the user named.
 *
 * An empty `name` is NOT a sufficient test. Chromium (and Safari) hand a
 * pasted screenshot to the page as a File literally called `image.png`, so
 * gating the timestamp on emptiness alone meant the timestamp path never ran
 * for the exact case it exists for: every screenshot pasted into the same
 * folder collided on `image.png` and raised the conflict dialog. Verified in
 * a real Chromium via a synthetic paste before this was fixed.
 *
 * Only the browsers' generic placeholder names are treated as bare, and only
 * for image MIME types, so a genuine `image.png` copied from a file manager
 * (which arrives through the DROP path, not here) keeps its name.
 */
const BARE_IMAGE_NAME_RE = /^image\.(png|jpe?g|gif|webp|bmp|avif)$/i;

function isBarePastedImage(file: ImportableFile): boolean {
  if (!file.name || file.name.length === 0) return true;
  return (file.type || "").startsWith("image/") && BARE_IMAGE_NAME_RE.test(file.name);
}

/** Extracts files/images from a `paste` event's `clipboardData`. Chromium
 * delivers both real files and images; Firefox delivers images only (a
 * browser quirk of the native paste event's `DataTransfer`, not something
 * this function can work around) — either way this just reads whatever
 * `items` exposes, so it degrades to "images only" for free on Firefox.
 * Never throws: a missing/empty `dataTransfer`, a `null` `items`, or an
 * item whose `getAsFile()` misbehaves all resolve to fewer results, never
 * an exception. */
export function extractClipboardFiles(
  dataTransfer: DataTransferLike | null | undefined,
  now: Date = new Date(),
): FlattenedEntry[] {
  try {
    if (!dataTransfer || !dataTransfer.items) return [];
    const results: FlattenedEntry[] = [];
    let imageOffset = 0;
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (!item || item.kind !== "file") continue;
      let file: ImportableFile | null = null;
      try {
        file = item.getAsFile();
      } catch {
        file = null;
      }
      if (!file) continue;
      const name = isBarePastedImage(file)
        ? timestampedImageName(file.type || "image/png", new Date(now.getTime() + imageOffset++))
        : file.name;
      results.push({ relativePath: name, file });
    }
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Conflict naming + planning (pure) — shared by both import paths.
// ---------------------------------------------------------------------------

/** Same non-colliding-suffix scheme `useFsStore.ts`'s `uniqueName` already
 * uses for new files/folders/moves (`base-1.ext`, `base-2.ext`, ...), kept
 * consistent here rather than inventing a second naming convention. */
export function nextAvailableName(existingNames: ReadonlySet<string>, name: string): string {
  if (!existingNames.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  let n = 1;
  for (;;) {
    const candidate = `${base}-${n}${ext}`;
    if (!existingNames.has(candidate)) return candidate;
    n++;
  }
}

function splitFsPath(fsPath: string): { dir: string; name: string } {
  const idx = fsPath.lastIndexOf("/");
  return { dir: idx <= 0 ? "" : fsPath.slice(0, idx), name: fsPath.slice(idx + 1) };
}

function joinFsPath(dir: string, relativePath: string): string {
  return `${dir}/${relativePath}`.replace(/\/+/g, "/");
}

/** Renames one fs path to a sibling-non-colliding one, checking only the
 * OTHER paths that share its parent directory (so renaming a conflicting
 * `notes/a.md` never looks at, or corrupts, an unrelated `assets/a.md`). */
function resolveConflictFsPath(fsPath: string, claimedFsPaths: ReadonlySet<string>): string {
  const { dir, name } = splitFsPath(fsPath);
  const prefix = `${dir}/`;
  const siblingNames = new Set<string>();
  for (const claimed of claimedFsPaths) {
    if (claimed.startsWith(prefix) && !claimed.slice(prefix.length).includes("/")) {
      siblingNames.add(claimed.slice(prefix.length));
    }
  }
  const newName = nextAvailableName(siblingNames, name);
  return `${dir}/${newName}`;
}

export interface ImportPlanItem {
  entry: FlattenedEntry;
  /** Absolute fs path this entry will actually be written to. */
  targetFsPath: string;
  /** Whether the entry's ORIGINAL (pre-rename) target path already existed. */
  conflicted: boolean;
}

/**
 * Pure planning step: given the target folder, the entries to import, and
 * the set of fs paths that already exist among their intended targets,
 * decides the final write path for each entry.
 * - `"replace"`: every entry writes to its original intended path
 *   (overwriting whatever's there).
 * - `"rename"`: a conflicting entry gets the next available sibling name;
 *   entries with no conflict are untouched. Renames are computed against a
 *   running `claimed` set (starting from `existingFsPaths`) so two entries
 *   in the SAME batch that would land on the same name don't collide with
 *   each other either, and no unrelated sibling path is ever touched.
 */
export function planImportPaths(
  targetFsPath: string,
  entries: FlattenedEntry[],
  existingFsPaths: ReadonlySet<string>,
  mode: "rename" | "replace",
): ImportPlanItem[] {
  const claimed = new Set(existingFsPaths);
  const items: ImportPlanItem[] = [];
  for (const entry of entries) {
    const desiredFsPath = joinFsPath(targetFsPath, entry.relativePath);
    const conflicted = claimed.has(desiredFsPath);
    const finalFsPath = conflicted && mode === "rename" ? resolveConflictFsPath(desiredFsPath, claimed) : desiredFsPath;
    claimed.add(finalFsPath);
    items.push({ entry, targetFsPath: finalFsPath, conflicted });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Async orchestration — the only part of this file that touches the real
// vault filesystem (`fs/operations.ts`). Not unit-tested directly (would
// need the same real-lightning-fs/`fake-indexeddb` setup `drafts.test.ts`
// uses); every path-and-naming DECISION it depends on is covered above.
// ---------------------------------------------------------------------------

/** Which of `entries`' intended target paths (relative, matching
 * `FlattenedEntry.relativePath`) already exist under `targetDisplayPath` —
 * empty means "no prompt needed, just import". */
export async function detectConflictingPaths(
  targetDisplayPath: string,
  entries: FlattenedEntry[],
): Promise<string[]> {
  const targetFsPath = displayToFsPath(targetDisplayPath);
  const conflicts: string[] = [];
  for (const entry of entries) {
    const fsPath = joinFsPath(targetFsPath, entry.relativePath);
    if (await pathExists(fsPath)) conflicts.push(entry.relativePath);
  }
  return conflicts;
}

/** Writes every entry into the vault under `targetDisplayPath`, resolving
 * conflicts per `mode`. Binary files land as-is (`ArrayBuffer` -> raw
 * `Uint8Array` write, no text decoding). Returns the created display paths. */
export async function importEntriesIntoVault(
  targetDisplayPath: string,
  entries: FlattenedEntry[],
  mode: "rename" | "replace",
): Promise<string[]> {
  const targetFsPath = displayToFsPath(targetDisplayPath);
  const existing = new Set<string>();
  for (const entry of entries) {
    const fsPath = joinFsPath(targetFsPath, entry.relativePath);
    if (await pathExists(fsPath)) existing.add(fsPath);
  }
  const plan = planImportPaths(targetFsPath, entries, existing, mode);
  const createdDisplayPaths: string[] = [];
  for (const item of plan) {
    const bytes = new Uint8Array(await item.entry.file.arrayBuffer());
    await writeFile(item.targetFsPath, bytes);
    createdDisplayPaths.push(fsToDisplayPath(item.targetFsPath));
  }
  return createdDisplayPaths;
}

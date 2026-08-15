/**
 * Unsaved-buffer checkpointing — DESIGN-SPEC "Amendments" §6 (persistence,
 * hard Phase 2 requirement): every dirty editor buffer is checkpointed to
 * IndexedDB on a ~300ms debounce, so a reload or crash never loses unsaved
 * work; on reopen a dirty tab comes back dirty with its draft content
 * intact (the draft, not the on-disk file).
 *
 * Deliberately keyed by display path and independent of any editor widget
 * (per the amendment's design note) — Phase 3 swaps the textarea for
 * CodeMirror without touching this module. Storage reuses the same
 * IndexedDB-backed lightning-fs instance (`client.ts`) under a `/.drafts`
 * folder outside `/vault`, so it's a second logical store on one physical
 * database rather than a second IndexedDB wrapper dependency.
 */
import { pfs } from "./client";
import { pathExists, removeFile, writeFile } from "./operations";

const DRAFTS_DIR = "/.drafts";
const DEBOUNCE_MS = 300;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function draftFsPath(displayPath: string): string {
  return `${DRAFTS_DIR}/${encodeURIComponent(displayPath)}.draft`;
}

// Routed through fs/operations.ts's writeFile/removeFile (not raw `pfs`
// calls) so every draft write/delete gets the same forced `pfs.flush()`
// those apply — see the long comment on `flush()` there for why that
// matters for "reload must never lose unsaved work."
async function writeDraftNow(displayPath: string, content: string): Promise<void> {
  await writeFile(draftFsPath(displayPath), content);
}

/** Schedules a debounced checkpoint write; coalesces rapid keystrokes. */
export function scheduleDraftSave(displayPath: string, content: string): void {
  const existing = timers.get(displayPath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(displayPath);
    void writeDraftNow(displayPath, content);
  }, DEBOUNCE_MS);
  timers.set(displayPath, timer);
}

/** Writes immediately, bypassing the debounce (e.g. before unload). */
export async function flushDraftSave(displayPath: string, content: string): Promise<void> {
  const existing = timers.get(displayPath);
  if (existing) {
    clearTimeout(existing);
    timers.delete(displayPath);
  }
  await writeDraftNow(displayPath, content);
}

export async function loadDraft(displayPath: string): Promise<string | undefined> {
  const path = draftFsPath(displayPath);
  if (!(await pathExists(path))) return undefined;
  return pfs.readFile(path, { encoding: "utf8" });
}

/** Clears a checkpoint once its buffer is saved to the real file (or discarded). */
export async function clearDraft(displayPath: string): Promise<void> {
  const existing = timers.get(displayPath);
  if (existing) {
    clearTimeout(existing);
    timers.delete(displayPath);
  }
  const path = draftFsPath(displayPath);
  if (await pathExists(path)) {
    await removeFile(path);
  }
}

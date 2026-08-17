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
 *
 * DESIGN-SPEC Amendments item 16 (typing-latency bug): the actual disk
 * write — `writeFile` -> lightning-fs -> IndexedDB, plus the forced
 * `pfs.flush()` `fs/operations.ts` applies (see its own long comment) — is
 * real, non-trivial main-thread work. A bare `setTimeout(..., 300)` fires
 * that work on a normal task queued at an arbitrary point relative to the
 * user's typing, with no guarantee the main thread is actually free; if the
 * user resumes typing right as it lands, the write competes with input
 * handling for the same frame. `scheduleDraftSave` keeps the 300ms debounce
 * (still coalesces rapid keystrokes into one write of the LAST value) but
 * now hands the actual write to `requestIdleCallback` once the debounce
 * fires, so the browser only runs it when the main thread is genuinely
 * idle — with a `timeout` so a tab that's continuously busy (never goes
 * idle) still flushes within ~500ms rather than starving forever, and a
 * bare `setTimeout(fn, 0)` fallback for browsers without
 * `requestIdleCallback` (Safari, as of this writing).
 */
import { pfs } from "./client";
import { pathExists, removeFile, writeFile } from "./operations";

const DRAFTS_DIR = "/.drafts";
const DEBOUNCE_MS = 300;

/**
 * Test seam for the debounce window. Production never calls the setter, so
 * the app always uses the 300ms above.
 *
 * It exists because `tests/unit/drafts.test.ts` must use REAL timers (see
 * that file's docstring: `fake-indexeddb`'s request machinery does not
 * advance reliably under a faked clock), which made the suite's pass/fail
 * depend on wall-clock scheduling under load. On a cold CI runner those
 * real-timer callbacks get starved: the file first failed all six cases at
 * the 5s default, was given 20s of headroom, and then failed at 20s too once
 * Phase 15 grew the suite from 16 to 20 files. Raising the ceiling again
 * just moves the next failure further out.
 *
 * Shrinking the window instead removes the sensitivity at its source: the
 * same real timers and the same real IndexedDB writes still run, and the
 * debounce/coalescing semantics under test are unchanged, but the file's
 * wall-clock cost drops from roughly 800ms to about 100ms, so starving it
 * past the timeout would now take an order of magnitude more contention.
 */
let debounceMs = DEBOUNCE_MS;

export function setDraftDebounceMsForTests(ms: number): void {
  debounceMs = ms;
}

export function resetDraftDebounceForTests(): void {
  debounceMs = DEBOUNCE_MS;
}
/** Upper bound on how long the idle-scheduled write may be deferred past
 * the debounce firing, so a continuously-busy tab still checkpoints. */
const IDLE_TIMEOUT_MS = 500;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Handles for the idle-scheduled write itself (post-debounce), separate
 * from `timers` (the debounce) so `flushDraftSave`/`clearDraft` can cancel
 * either stage cleanly. */
const idleHandles = new Map<string, ReturnType<typeof setTimeout>>();

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

function cancelIdleWrite(displayPath: string): void {
  const handle = idleHandles.get(displayPath);
  if (handle === undefined) return;
  if (typeof requestIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
  idleHandles.delete(displayPath);
}

/** Schedules a debounced checkpoint write; coalesces rapid keystrokes. The
 * write itself runs off the critical path — see module doc. */
export function scheduleDraftSave(displayPath: string, content: string): void {
  const existing = timers.get(displayPath);
  if (existing) clearTimeout(existing);
  cancelIdleWrite(displayPath);
  const timer = setTimeout(() => {
    timers.delete(displayPath);
    const run = () => {
      idleHandles.delete(displayPath);
      void writeDraftNow(displayPath, content);
    };
    if (typeof requestIdleCallback === "function") {
      idleHandles.set(displayPath, requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS }));
    } else {
      idleHandles.set(displayPath, setTimeout(run, 0));
    }
  }, debounceMs);
  timers.set(displayPath, timer);
}

/** Writes immediately, bypassing both the debounce and the idle scheduling
 * (e.g. before unload — see App.tsx's `visibilitychange` safety net). */
export async function flushDraftSave(displayPath: string, content: string): Promise<void> {
  const existing = timers.get(displayPath);
  if (existing) {
    clearTimeout(existing);
    timers.delete(displayPath);
  }
  cancelIdleWrite(displayPath);
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
  cancelIdleWrite(displayPath);
  const path = draftFsPath(displayPath);
  if (await pathExists(path)) {
    await removeFile(path);
  }
}

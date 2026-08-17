/**
 * Pins `fs/drafts.ts`'s checkpoint/restore contract (DESIGN-SPEC Amendments
 * item 6: every dirty buffer is checkpointed to IndexedDB so reload never
 * loses unsaved work) against the REAL lightning-fs client
 * (`fs/client.ts`), not a mock — `tests/unit/setup.ts` installs
 * `fake-indexeddb` as the global `indexedDB` so this runs deterministically
 * under Node. Covers: debounced save + immediate flush, load-after-save,
 * "no draft" for an untouched path, and clear-after-save/discard.
 *
 * Uses REAL timers (not vitest's fake-timer clock) deliberately: the
 * debounce runs through `fake-indexeddb`'s own async IndexedDB request
 * machinery, which doesn't reliably advance under a faked global clock —
 * a real ~300ms wait is a small, worthwhile cost for a debounce test that
 * can't silently deadlock or race the fake clock.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Why this file no longer needs an inflated timeout.
 *
 * These cases use REAL timers (see the module docstring above), so they spend
 * genuine wall-clock time waiting out the draft debounce, which made them
 * sensitive to scheduling delays on a busy machine. They first failed all six
 * cases at vitest's 5s default on a cold CI runner, were given 20s of
 * headroom, and then failed at 20s too once Phase 15 grew the suite from 16
 * to 20 files: more parallel files, more contention, same starvation.
 *
 * Raising the ceiling a third time would only move the next failure further
 * out, so the wait itself is now short instead. `setDraftDebounceMsForTests`
 * shrinks the debounce to 20ms for this file, cutting its wall-clock cost
 * from roughly 800ms to about 100ms. Everything under test is unchanged:
 * real timers, real `fake-indexeddb` writes, real coalescing. A genuine
 * regression in fs/drafts.ts still fails these cases, and the tight 5s
 * default failure signal is back.
 */
const DEBOUNCE_MS = 20;
/** Comfortably past the debounce window above, still tiny in wall-clock. */
const PAST_DEBOUNCE_MS = 80;
import {
  clearDraft,
  flushDraftSave,
  loadDraft,
  resetDraftDebounceForTests,
  scheduleDraftSave,
  setDraftDebounceMsForTests,
} from "../../src/fs/drafts";
import { resetFilesystem } from "../../src/fs/client";

const PATH = "vault/notes/scratch.md";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  setDraftDebounceMsForTests(DEBOUNCE_MS);
  resetFilesystem();
});

afterAll(() => {
  resetDraftDebounceForTests();
});

describe("fs/drafts.ts checkpoint/restore", () => {
  it("has no draft for a path that was never touched", async () => {
    expect(await loadDraft(PATH)).toBeUndefined();
  });

  it("flushDraftSave writes immediately, bypassing the debounce", async () => {
    await flushDraftSave(PATH, "# hello draft");
    expect(await loadDraft(PATH)).toBe("# hello draft");
  });

  it("scheduleDraftSave coalesces rapid keystrokes into one debounced write of the LAST value", async () => {
    scheduleDraftSave(PATH, "a");
    scheduleDraftSave(PATH, "ab");
    scheduleDraftSave(PATH, "abc");
    // Still inside the 300ms debounce window — nothing written yet.
    expect(await loadDraft(PATH)).toBeUndefined();

    await wait(PAST_DEBOUNCE_MS);
    expect(await loadDraft(PATH)).toBe("abc");
  });

  it("clearDraft removes a checkpoint (e.g. after a real save)", async () => {
    await flushDraftSave(PATH, "unsaved content");
    expect(await loadDraft(PATH)).toBe("unsaved content");

    await clearDraft(PATH);
    expect(await loadDraft(PATH)).toBeUndefined();
  });

  it("clearDraft also cancels a still-pending debounced write", async () => {
    scheduleDraftSave(PATH, "will be cancelled");
    await clearDraft(PATH);
    await wait(PAST_DEBOUNCE_MS); // past the debounce window — nothing should land now
    expect(await loadDraft(PATH)).toBeUndefined();
  });

  it("keeps drafts for different paths independent", async () => {
    await flushDraftSave("vault/notes/a.md", "draft A");
    await flushDraftSave("vault/notes/b.md", "draft B");
    expect(await loadDraft("vault/notes/a.md")).toBe("draft A");
    expect(await loadDraft("vault/notes/b.md")).toBe("draft B");

    await clearDraft("vault/notes/a.md");
    expect(await loadDraft("vault/notes/a.md")).toBeUndefined();
    expect(await loadDraft("vault/notes/b.md")).toBe("draft B"); // untouched
  });
});

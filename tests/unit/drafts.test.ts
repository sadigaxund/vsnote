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
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Timeout headroom, and why this file specifically needs it.
 *
 * These cases deliberately use REAL timers (see the module docstring above)
 * and therefore spend ~300-400ms of genuine wall-clock time each waiting out
 * the draft debounce. Vitest's 5s default leaves that only ~12x headroom,
 * which is enough on a warm developer machine and NOT enough on a cold CI
 * runner: the first GitHub Actions run after a fresh `npm ci` failed all six
 * cases at exactly 5000-5009ms while every other unit file passed.
 *
 * Measured rather than assumed, in a throwaway clone with a clean `npm ci`:
 * the failure reproduces on the FIRST full-suite run on a cold machine and
 * then never again (five consecutive clean runs afterwards), it never
 * reproduces with the file run alone, in pairs, or with
 * `--no-file-parallelism`, and whenever the file does complete it takes
 * ~840ms. A deadlock would not resolve in 840ms on the next attempt, so this
 * is I/O and CPU contention on a cold box delaying real-timer callbacks,
 * not a hang and not a product defect.
 *
 * The timeout is raised HERE rather than globally so every other spec keeps
 * the tight 5s failure signal, and it is not a retry: a genuine regression in
 * fs/drafts.ts still fails this file, it just is not allowed to fail merely
 * because the machine was busy.
 */
vi.setConfig({ testTimeout: 20_000 });
import { clearDraft, flushDraftSave, loadDraft, scheduleDraftSave } from "../../src/fs/drafts";
import { resetFilesystem } from "../../src/fs/client";

const PATH = "vault/notes/scratch.md";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  resetFilesystem();
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

    await wait(400);
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
    await wait(400); // past the debounce window — nothing should land now
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

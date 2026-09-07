/**
 * Pins `src/lib/debounce.ts` — the trailing-edge debounce behind the
 * Preview pane's ~150ms re-render (R3-11, `MarkdownPreviewPane.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../../src/lib/debounce";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("debounce", () => {
  it("does not call the function before the delay elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced("a");
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the function once, with the latest arguments, after the delay", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced("a");
    debounced("b");
    debounced("c");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("resets the timer on every call within the window (a burst of keystrokes never fires mid-burst)", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced(1);
    vi.advanceTimersByTime(100);
    debounced(2);
    vi.advanceTimersByTime(100);
    debounced(3);
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("cancel() prevents a pending call from firing", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a call after cancel() schedules normally", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced("a");
    debounced.cancel();
    debounced("b");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });
});

/**
 * Unit coverage for `src/lib/dirtyGuard.ts` — pure collector + the
 * attach/detach facade over a fake event target (DOM-free, matching the
 * unit suite's Node environment; see tests/unit/setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { collectDirtyPaths, createDirtyGuard, type BeforeUnloadTarget, type DirtyAwareBuffer } from "../../src/lib/dirtyGuard";

function buffer(path: string, dirty: boolean): DirtyAwareBuffer {
  return { path, dirty };
}

describe("collectDirtyPaths", () => {
  it("returns only dirty buffers' paths", () => {
    const buffers = {
      "vault/a.md": buffer("vault/a.md", true),
      "vault/b.md": buffer("vault/b.md", false),
      "vault/c.txt": buffer("vault/c.txt", true),
    };
    expect(collectDirtyPaths(buffers)).toEqual(["vault/a.md", "vault/c.txt"]);
  });

  it("returns empty for no buffers or all-clean buffers", () => {
    expect(collectDirtyPaths({})).toEqual([]);
    expect(collectDirtyPaths({ "vault/a.md": buffer("vault/a.md", false) })).toEqual([]);
  });
});

describe("createDirtyGuard", () => {
  function fakeTarget() {
    const listeners = new Map<string, (event: BeforeUnloadEvent) => void>();
    const target: BeforeUnloadTarget = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    return { target, listeners };
  }

  it("registers exactly one beforeunload listener while dirty", () => {
    const { target, listeners } = fakeTarget();
    const guard = createDirtyGuard(target);
    guard.setActive(true);
    guard.setActive(true); // idempotent — no stacking
    expect(listeners.get("beforeunload")).toBeTypeOf("function");
  });

  it("detaches when clean again and tolerates repeated clean calls", () => {
    const { target, listeners } = fakeTarget();
    const guard = createDirtyGuard(target);
    guard.setActive(true);
    guard.setActive(false);
    guard.setActive(false);
    expect(listeners.has("beforeunload")).toBe(false);
  });

  it("never registers for a clean-only lifecycle", () => {
    const { target, listeners } = fakeTarget();
    createDirtyGuard(target).setActive(false);
    expect(listeners.size).toBe(0);
  });

  it("handler cancels navigation via both preventDefault and returnValue", () => {
    const { target, listeners } = fakeTarget();
    createDirtyGuard(target).setActive(true);
    const event = { preventDefault: vi.fn(), returnValue: "" } as unknown as BeforeUnloadEvent;
    listeners.get("beforeunload")!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });
});

/**
 * The store-wiring half of the dirty-before-unload guard — see
 * `lib/dirtyGuard.ts` for the rationale and the pure, testable mechanics.
 * Split into its own module purely for the unit suite's fs-isolation
 * invariant: importing `useBufferStore` here transitively pulls
 * `fs/client.ts`, so tests import only the pure half.
 *
 * React discipline: deliberately does NOT subscribe the mounting component
 * to `useBufferStore` (App.tsx's typing-latency fix removed exactly that
 * subscription — buffers change on every keystroke). A transient
 * `store.subscribe()` flips the beforeunload listener only on the
 * clean→dirty / dirty→clean EDGE, so keystrokes cost one boolean compare,
 * zero re-renders.
 */
import { useEffect } from "react";
import { collectDirtyPaths, createDirtyGuard } from "./dirtyGuard";
import { useBufferStore } from "../stores/useBufferStore";

/** Mount once inside the main app shell (`App.tsx`). */
export function useDirtyBeforeunloadGuard(): void {
  useEffect(() => {
    const guard = createDirtyGuard(window);
    let last = collectDirtyPaths(useBufferStore.getState().buffers).length > 0;
    guard.setActive(last);
    const check = (): void => {
      const dirty = collectDirtyPaths(useBufferStore.getState().buffers).length > 0;
      if (dirty === last) return;
      last = dirty;
      guard.setActive(dirty);
    };
    const unsubscribe = useBufferStore.subscribe(check);
    return () => {
      unsubscribe();
      guard.setActive(false);
    };
  }, []);
}

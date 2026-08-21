/**
 * Warn-before-unload guard for unsaved buffers — COMPONENT-BACKLOG §3.3
 * (source: vercel-labs web-interface-guidelines, "warn before navigation
 * with unsaved changes"; arguably mandatory for a code editor).
 *
 * Why a guard at all when `fs/drafts.ts` already checkpoints every edit to
 * IndexedDB (~300ms debounce): the draft tail is a real but tiny data-loss
 * window; the bigger reason is CONTRACT — a dirty tab is user-visible state
 * (amber dot in `EditorTabBar`), and a silent reload (PWA service-worker
 * auto-update in `main.tsx`, accidental ⌘R) must not discard it without
 * asking. The browser's own dialog is the only pre-navigation confirmation
 * surface a plain SPA has.
 *
 * Scope: the wiring hook (`useDirtyBeforeunloadGuard.ts`) is mounted once
 * from `App.tsx`, which `main.tsx` reaches ONLY on the non-share branch
 * (the `/share/<slug>` route dynamically imports `share/ShareApp.tsx` and
 * never downloads this module's chunk — see main.tsx's routing doc), so
 * the read-only share reader can never prompt.
 *
 * This module is deliberately PURE (zero imports) so unit tests can cover
 * it without transitively opening lightning-fs — the same split
 * `fs/importEntriesFs.ts` established for the suite's fs-isolation
 * invariant; the store-wiring hook lives in `useDirtyBeforeunloadGuard.ts`.
 */

/** Structural minimum the collector needs — keeps this file decoupled from
 * the buffer store's full shape. */
export interface DirtyAwareBuffer {
  path: string;
  dirty: boolean;
}

/** Pure helper so the "is anything unsaved" rule is testable without DOM. */
export function collectDirtyPaths(buffers: Record<string, DirtyAwareBuffer>): string[] {
  const out: string[] = [];
  for (const buffer of Object.values(buffers)) {
    if (buffer.dirty) out.push(buffer.path);
  }
  return out;
}

/** The slice of `Window` (or any event target) the facade needs — keeps the
 * unit tests free of jsdom. */
export interface BeforeUnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

/**
 * Attach/detach facade. `setActive(true)` registers ONE beforeunload
 * listener (idempotent — repeated true calls never stack handlers);
 * `setActive(false)` removes it. The handler uses BOTH cancellation
 * mechanisms because they're complementary, not redundant:
 * `preventDefault()` is the spec'd API, while legacy `returnValue = ""`
 * is what Chrome-based browsers still require to show the dialog at all.
 */
export function createDirtyGuard(target: BeforeUnloadTarget): { setActive(dirty: boolean): void } {
  let active = false;
  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  return {
    setActive(dirty: boolean): void {
      if (dirty === active) return;
      active = dirty;
      if (dirty) target.addEventListener("beforeunload", handler);
      else target.removeEventListener("beforeunload", handler);
    },
  };
}

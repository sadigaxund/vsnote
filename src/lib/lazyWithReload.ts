/**
 * fix(pwa) — stale-chunk recovery for `React.lazy` dynamic imports.
 *
 * Root cause (the actual bug report, "Failed to fetch dynamically imported
 * module: .../assets/SharedView-<hash>.js"): `vite.config.ts`'s service
 * worker already sets `skipWaiting`/`clientsClaim` (true well before this
 * fix), which is exactly the combination that makes this failure possible
 * in the first place — a new SW activates and takes over an ALREADY-OPEN
 * tab immediately, but that tab's in-memory module graph still names the
 * OLD build's chunk hashes. The very next lazy `import()` that tab makes
 * (e.g. opening the Shared view, `EditorContent.tsx`'s `SharedView` lazy
 * point) asks the now-active NEW service worker/precache for a chunk file
 * that belonged to the PREVIOUS build and no longer exists on disk (the
 * server's `dist/` was replaced wholesale by the rebuild — there is no
 * "keep old hashed chunks around" step anywhere in the deploy path) — a
 * genuine 404, surfaced by the browser as this exact "Failed to fetch
 * dynamically imported module" error, not a network flake.
 * `main.tsx`'s `registerSW({ immediate: true })` + `autoUpdate` already
 * reloads a tab that is idle when the update lands, but a tab that makes a
 * NEW lazy import in the narrow window between SW activation and its own
 * reload lands here instead.
 *
 * The fix is client-side self-healing, not a precache change: a stale tab
 * cannot be prevented from ever hitting this window (the SW update can
 * activate at any moment), so instead every `React.lazy` factory in this
 * app that is worth protecting is wrapped with `lazyWithReload`, which
 * reloads the page ONCE or the failure a genuine, persistent network
 * outage would keep re-triggering forever. `event.preventDefault()`
 * on `vite:preloadError` is not needed here — the entrypoint listener in
 * `main.tsx` handles that Vite-emitted event separately, this module
 * covers React's own dynamic-import rejection path.
 */
import { lazy, type ComponentType } from "react";

const RELOAD_FLAG = "vsnote:reload-after-chunk-error";

/** True if this is the first stale-chunk reload attempt this browser
 * session has made (sessionStorage — cleared per-tab on close, so a fresh
 * tab always gets one more try) — false (and does NOT reload) once one has
 * already fired, so a genuinely broken deploy fails loudly (the thrown
 * error still propagates to the nearest error boundary / Suspense
 * fallback) instead of reload-looping forever. */
export function reloadOnceForStaleChunk(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // sessionStorage unavailable (private mode, storage disabled) — still
    // reload once, best-effort; there's just no guard against a loop.
  }
  window.location.reload();
  return true;
}

/** Clears the guard once a dynamic import has actually succeeded, so a
 * LATER real deploy gets its own fresh one-time reload rather than being
 * silently blocked by a flag left over from an earlier, already-recovered
 * failure in the same tab session. */
function clearStaleChunkGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Nothing to clear if storage isn't available in the first place.
  }
}

/**
 * Drop-in replacement for `React.lazy(factory)`: on a failed dynamic
 * import (the exact shape of the bug this fixes), reloads the page once
 * (guarded by `reloadOnceForStaleChunk`) instead of leaving the Suspense
 * boundary stuck on a rejected promise / thrown error. A successful import
 * clears the guard so a later, unrelated failure still gets its own retry.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own `ComponentType<any>` constraint so every prop shape (not just no-prop components) can be wrapped.
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(() =>
    factory().then(
      (mod) => {
        clearStaleChunkGuard();
        return mod;
      },
      (err: unknown) => {
        if (reloadOnceForStaleChunk()) {
          // Reload is already in flight — never resolve/reject so the
          // Suspense fallback just keeps spinning until the navigation
          // actually happens (a rejected promise here would otherwise
          // flash a broken error state for the instant before reload).
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      },
    ),
  );
}

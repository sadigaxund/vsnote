import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider, Toaster } from "my-you-eye";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { applyDomSettings, useSettingsStore } from "./stores/useSettingsStore";

// Phase 5b PWA (IMPLEMENTATION-PLAN.md Phase 5): explicit `virtual:pwa-
// register` registration, not `vite.config.ts`'s `injectRegister: 'auto'`
// default — that default only injects a bare `.register()` call with no
// update-detection logic, so `registerType: 'autoUpdate'` would silently
// do nothing (see vite.config.ts's comment on `injectRegister: false` for
// how this was actually caught: a rebuilt bundle stayed unreloaded in an
// already-open tab under the bare-register default). This `workbox-
// window`-backed client listens for the browser's own SW-update lifecycle
// and calls `window.location.reload()` itself once the new SW activates —
// no prompt, matching `registerType: 'autoUpdate'`'s no-user-interaction
// contract. A no-op outside a built PWA context (dev's `devOptions.enabled`
// stays false per `vite.config.ts`'s doc), so this is safe to call
// unconditionally rather than gating on `import.meta.env.PROD`.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    // A long-lived SPA tab (this app is meant to stay open all day) never
    // navigates again on its own, and the browser's automatic "check sw.js
    // for changes" step only runs around navigation/registration — without
    // an explicit poll, a tab left open would never notice a deploy until
    // the user closes and reopens it, defeating "never serve a stale
    // index.html after a deploy". `registerType: 'autoUpdate'`'s generated
    // client (`register.js`, this module's `registerSW` import) already
    // auto-reloads with no prompt the instant it DOES detect one; this
    // just makes sure detection itself actually happens periodically for a
    // tab that's simply been sitting open.
    if (!registration) return;
    setInterval(() => void registration.update(), 60 * 60 * 1000);
  },
});

declare global {
  var Buffer: typeof import("buffer").Buffer;
}

// isomorphic-git's index (.git/index) reader/writer uses Node's `Buffer`
// global directly (confirmed in node_modules/isomorphic-git/index.js —
// `GitIndex`'s buffer parsing/serialization). The browser has no such
// global; polyfill it once here, before any git/fs module runs, rather
// than pulling in a full node-polyfills bundler plugin for one global.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

// Phase 5a: push the persisted theme/accent onto <html> before the first
// paint (zustand's `persist` middleware rehydrates from localStorage
// synchronously as part of `create()`, so `getState()` here already has
// whatever the Settings dialog last saved — no flash of the wrong theme),
// then keep it in sync with every later change (Settings dialog edits, the
// command palette's "Toggle theme"). See useSettingsStore.ts's
// `applyDomSettings` doc for why boot still renders this app's own Slate
// palette regardless of the persisted value.
applyDomSettings(useSettingsStore.getState());
useSettingsStore.subscribe((state) => applyDomSettings(state));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      {/* `Toaster` IS the toast context provider (`ToastContext.Provider`,
          confirmed in node_modules/my-you-eye/dist/index.js) as well as the
          viewport that renders active toasts — it must WRAP whatever calls
          `useToast()`, not sit as a sibling. Phase 1-4 never called
          `useToast` from anywhere, so `<App /><Toaster />` as siblings never
          threw; Phase 5a's `App.tsx` (sync/reset-vault toasts) is the first
          real consumer and surfaced this pre-existing wiring bug — fixed
          here rather than worked around in App.tsx. */}
      <Toaster>
        <App />
      </Toaster>
    </TooltipProvider>
  </StrictMode>,
);

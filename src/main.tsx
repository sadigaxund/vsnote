import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider, Toaster } from "my-you-eye";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
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
// `applyDomSettings` doc for why boot still renders this app's own VSNote
// palette regardless of the persisted value.
applyDomSettings(useSettingsStore.getState());
useSettingsStore.subscribe((state) => applyDomSettings(state));

// Phase 10 (sharing) — minimum-viable routing. This app had NO router
// before this phase (a single always-mounted `<App/>`); rather than pull in
// react-router for one route, `window.location.pathname` is read once here,
// at boot, and used to pick which of two ENTIRELY SEPARATE render roots to
// mount — never both. This is the actual mechanism behind
// `share/ShareApp.tsx`'s "never touches vault storage" guarantee: `<App/>`
// (and everything it statically imports — `fs/seed.ts`, every
// `stores/use{Fs,Buffer,Tabs,Git}Store.ts`, isomorphic-git, lightning-fs)
// is now behind a DYNAMIC `import()`, reached only on the non-share branch,
// so the `/share/<slug>` route's JS bundle never even downloads that code,
// let alone executes it — not just "unused", structurally absent from that
// page load (confirmed in this phase's manual verification: see the final
// report's network-tab check). `vite build`'s default code-splitting turns
// each dynamic `import()` into its own chunk automatically, so this needs
// no bundler config of its own.
//
// Route shape: `/share/<slug>` (rendered-mode file shares), extended Phase
// 10.5 to `/share/<slug>/<relpath...>` for folder shares (roadmap §5.1) —
// `relpath` may itself contain slashes (a nested file/directory), so the
// second capture group is greedy over the rest of the path; raw-mode links
// (and a folder share's individual raw-mode files) point at the backend's
// own origin per `share/shareLinks.ts` and are never served by this app at
// all. `vite.config.ts`'s dev/preview server defaults (`appType: "spa"`,
// the Vite default) already fall back to `index.html` for any unmatched
// navigation, including this path — the production build's `vite preview`
// does the same for the built `dist/`, and the PWA service worker's
// `navigateFallback` (vite-plugin-pwa's default for `registerType:
// "autoUpdate"`) matches it too; all three were verified directly rather
// than assumed (see this phase's e2e coverage + final report).
const pathname = window.location.pathname;
const shareMatch = /^\/share\/([^/]+)(?:\/(.*))?$/.exec(pathname);

const root = createRoot(document.getElementById("root")!);

if (shareMatch) {
  const identifier = decodeURIComponent(shareMatch[1]);
  const initialRelpath = shareMatch[2] ? decodeURIComponent(shareMatch[2]).replace(/\/+$/, "") : "";
  void import("./share/ShareApp").then(({ ShareApp }) => {
    root.render(
      <StrictMode>
        <ShareApp identifier={identifier} initialRelpath={initialRelpath} />
      </StrictMode>,
    );
  });
} else {
  void import("./App").then(({ default: App }) => {
    root.render(
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
  });
}

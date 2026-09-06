import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
//
// Public share reader rewrite (docs/PLAN-2026-09-05-refresh.md §4.3):
// skipped entirely on the `/share/<slug>` branch below. That route follows
// the visitor's system `prefers-color-scheme` on its own (`.share-reader`
// in `src/theme.css`), independent of this app's persisted theme/density —
// running `applyDomSettings` there would stamp `data-theme`/
// `data-ui-density` from the visitor's OWN earlier app usage onto a page
// that has no chrome to theme, defeating that independence.
const pathname = window.location.pathname;
const shareMatch = /^\/share\/(.+?)\/?$/.exec(pathname);

if (!shareMatch) {
  applyDomSettings(useSettingsStore.getState());
  useSettingsStore.subscribe((state) => applyDomSettings(state));
}

// Phase 10 (sharing) — minimum-viable routing. This app had NO router
// before this phase (a single always-mounted `<App/>`); rather than pull in
// react-router for one route, `window.location.pathname` is read once here,
// at boot, and used to pick which of two ENTIRELY SEPARATE render roots to
// mount — never both. This is the actual mechanism behind
// `share/ShareApp.tsx`'s "never touches vault storage" guarantee: `<App/>`
// (and everything it statically imports — `fs/seed.ts`, every
// `stores/use{Fs,Buffer,Tabs,Git}Store.ts`, isomorphic-git, lightning-fs) is
// now behind a DYNAMIC `import()`, reached only on the non-share branch, so
// the `/share/<slug>` route's JS bundle never even downloads that code, let
// alone executes it — not just "unused", structurally absent from that page
// load (confirmed in this phase's manual verification: see the final
// report's network-tab check). `vite build`'s default code-splitting turns
// each dynamic `import()` into its own chunk automatically, so this needs
// no bundler config of its own.
//
// Phase 17 (`boot.tsx`, the app-wide login gate) extended this without
// weakening it: the non-share branch now dynamically imports `./boot`
// instead of `./App` directly, but `boot.tsx` is ITSELF reached only from
// here, and its own imports (`LoginGate.tsx`, `share/api.ts`'s
// `getAppConfig`/`whoami`, and `App.tsx` behind its own further dynamic
// import) stay just as absent from the share route's bundle as `App.tsx`
// always was — see `boot.tsx`'s own header doc for the gate's full
// contract and why it lives in its own file rather than inline here.
//
// Route shape: `/share/<slug>` (or a custom alias) for rendered-mode file
// shares. Folder shares (and their `/share/<slug>/<relpath...>` deep links)
// were removed in the 2026-09-05 refresh (docs/PLAN-2026-09-05-refresh.md
// §4.4), so a path with anything after the slug is no longer a route this
// app serves. Rather than special-casing it, the whole remainder is passed
// through as the identifier: it fails the backend's slug format check and
// comes back as the same uniform 404 every other deny reason produces, so
// a stale folder-share bookmark lands on the ordinary "this link is
// unavailable" state instead of silently serving the parent slug's share.
// Raw-mode links are served by the backend directly and never reach this
// app at all. `vite.config.ts`'s dev/preview server defaults
// (`appType: "spa"`), the production build's `vite preview`, and the PWA
// service worker's `navigateFallback` all fall back to `index.html` for
// this path; all three were verified directly rather than assumed.
const root = createRoot(document.getElementById("root")!);

if (shareMatch) {
  const identifier = decodeURIComponent(shareMatch[1]);
  void import("./share/ShareApp").then(({ ShareApp }) => {
    root.render(
      <StrictMode>
        <ShareApp identifier={identifier} />
      </StrictMode>,
    );
  });
} else {
  // Phase 17 — `boot.tsx` owns the app-wide login gate + the shell's own
  // TooltipProvider/Toaster wiring (moved there verbatim from this file;
  // see its header doc for both the gate contract and the Toaster-must-
  // wrap-App reasoning that used to live in this comment).
  void import("./boot").then(({ Boot }) => {
    root.render(
      <StrictMode>
        <Boot />
      </StrictMode>,
    );
  });
}

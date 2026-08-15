import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider, Toaster } from "my-you-eye";
import "./index.css";
import App from "./App";
import { applyDomSettings, useSettingsStore } from "./stores/useSettingsStore";

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

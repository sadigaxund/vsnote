import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Names (pre-hash) of build output chunks the SW precache manifest must
 * NOT include: the two "full manifest" escape-hatch chunks
 * (`materialIconLoader.ts`'s own chunk + the ~450KB upstream JSON it
 * fetches) and every material-icon-theme SVG that ONLY that fallback tier
 * ever references — i.e. every icon EXCEPT the ~96
 * `materialIcons.curated.ts` already statically lists (those genuinely
 * render at boot — the demo vault's own tree/tab icons — and stay
 * precached like any other boot-critical asset).
 *
 * Caught in review: the naive `globPatterns: "**\/*.js"` swept up all
 * ~1250 of `import.meta.glob`'s per-icon chunks (`materialIconLoader.ts`'s
 * "only fetch the one icon that's actually missing" design exists
 * specifically so a cold boot never pays for that pack — precaching them
 * unconditionally defeats the entire point and, worse, spends the same
 * origin quota `navigator.storage.persist()` is trying to protect on
 * ~1300 Cache Storage entries that are, by that module's own design,
 * essentially never fetched). Computed from the actual installed package
 * + the curated file's real import specifiers (not a hardcoded number)
 * so this stays correct if either changes.
 */
function computeExcludedIconChunkNames(): Set<string> {
  const excluded = new Set(["materialIconLoader", "material-icons"]);
  let allIconFiles: string[];
  try {
    allIconFiles = readdirSync(path.join(ROOT, "node_modules/material-icon-theme/icons"));
  } catch {
    return excluded; // package not found at config-eval time — exclude nothing icon-related, fail safe
  }
  const curatedSrc = readFileSync(
    path.join(ROOT, "src/components/local/materialIcons.curated.ts"),
    "utf8",
  );
  const curated = new Set([...curatedSrc.matchAll(/icons\/([\w.-]+)\.svg\?url/g)].map((m) => m[1]));
  for (const file of allIconFiles) {
    if (!file.endsWith(".svg")) continue;
    const name = file.slice(0, -4);
    if (!curated.has(name)) excluded.add(name);
  }
  return excluded;
}

const EXCLUDED_ICON_CHUNKS = computeExcludedIconChunkNames();
// Vite/Rollup's default hash is 8 chars of [A-Za-z0-9_-]; strips exactly
// that trailing `-<hash>.<ext>` so multi-dash real names ("material-icons",
// "folder-redux-actions.clone") survive intact.
const HASHED_CHUNK_NAME = /^(.*)-[\w-]{8}\.\w+$/;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Phase 5b (IMPLEMENTATION-PLAN.md Phase 5's PWA bullet): installable
    // app shell that also loads offline. `registerType: 'autoUpdate'` +
    // `clientsClaim`/`skipWaiting` is the documented combo for "never serve
    // a stale index.html after a deploy" — the precache manifest keys
    // index.html by a per-build content hash (not its URL, which never
    // changes), so a real content change always produces a different
    // precache entry; the new SW activates immediately (skipWaiting) and
    // takes control of already-open tabs (clientsClaim) instead of waiting
    // for every tab to close first, and the injected `registerSW.js`
    // (`injectRegister: 'auto'`, the default) reloads the page once the new
    // SW has taken over. `devOptions` stays disabled (the default) so
    // `npm run dev` never registers a service worker at all — the PWA-
    // caution note in this phase's brief is specifically about a stale dev
    // SW masking real changes during iteration.
    VitePWA({
      registerType: "autoUpdate",
      // The default `injectRegister: 'auto'` only injects a bare
      // `navigator.serviceWorker.register(...)` call with no update
      // detection at all — it does NOT implement `registerType`'s
      // behavior. Real "never serve a stale index.html" needs the
      // `workbox-window`-backed `virtual:pwa-register` client (registered
      // explicitly in `src/main.tsx`), which listens for the browser's own
      // SW-update lifecycle events and reloads automatically once the new
      // SW has activated — confirmed the hard way: a bare-register build
      // left an already-open tab on the OLD bundle after a rebuild + one
      // reload (the new SW had installed/activated in the background, but
      // nothing ever told the page to reload onto it).
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons.svg"],
      manifest: {
        name: "Slate",
        short_name: "Slate",
        description:
          "A local-first note & code workspace: VSCode's shell and power with Obsidian's live-preview writing experience.",
        theme_color: "#0e1015",
        background_color: "#0e1015",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell + every hashed build asset — offline boot needs the JS/
        // CSS/HTML the shell renders with, not vault content (that already
        // lives in IndexedDB via lightning-fs, outside the SW's remit).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Drop the exotic-icon-fallback chunks computed above — see that
        // function's doc. `manifestTransforms` (a JS predicate over the
        // already-resolved candidate list) instead of `globIgnores` (glob
        // patterns) because the exclusion set is a ~1150-name membership
        // test, not a path-shape rule; a Set lookup here is both correct
        // and cheap where ~1150 glob patterns would be neither.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.filter((entry) => {
              const fileName = entry.url.split("/").pop() ?? "";
              const match = HASHED_CHUNK_NAME.exec(fileName);
              const baseName = match ? match[1] : fileName;
              return !EXCLUDED_ICON_CHUNKS.has(baseName);
            }),
          }),
        ],
      },
    }),
  ],
});

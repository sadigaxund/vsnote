import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** ALWAYS excluded, regardless of size, no name-collision risk: the two
 * chunks ARE the fallback tier itself (`materialIconLoader.ts`'s own JS +
 * the ~450KB upstream manifest JSON it fetches), not an `import.meta.glob`
 * per-icon wrapper — see `ICON_URL_WRAPPER_MAX_BYTES`'s doc for why these
 * two must NOT get the size guard the per-icon names below do. */
const ALWAYS_EXCLUDED_ICON_CHUNKS = new Set(["materialIconLoader", "material-icons"]);

function computeIconUrlWrapperNames(): Set<string> {
  let allIconFiles: string[];
  try {
    allIconFiles = readdirSync(path.join(ROOT, "node_modules/material-icon-theme/icons"));
  } catch {
    return new Set(); // package not found at config-eval time — exclude nothing icon-related, fail safe
  }
  const curatedSrc = readFileSync(
    path.join(ROOT, "src/components/local/materialIcons.curated.ts"),
    "utf8",
  );
  const curated = new Set([...curatedSrc.matchAll(/icons\/([\w.-]+)\.svg\?url/g)].map((m) => m[1]));
  const names = new Set<string>();
  for (const file of allIconFiles) {
    if (!file.endsWith(".svg")) continue;
    const name = file.slice(0, -4);
    if (!curated.has(name)) names.add(name);
  }
  return names;
}

/** Names (pre-hash) of `import.meta.glob(...,{query:"?url"})` per-icon
 * WRAPPER chunks (`materialIconLoader.ts`'s "only fetch the one icon that's
 * actually missing" design exists specifically so a cold boot never pays
 * for that pack) — every icon EXCEPT the ~96 `materialIcons.curated.ts`
 * already statically lists (those genuinely render at boot — the demo
 * vault's own tree/tab icons — and stay precached like any other
 * boot-critical asset).
 *
 * Caught in review: the naive `globPatterns: "**\/*.js"` swept up all
 * ~1250 of these (precaching them unconditionally defeats the entire point
 * of the lazy fallback tier and, worse, spends the same origin quota
 * `navigator.storage.persist()` is trying to protect on ~1300 Cache
 * Storage entries that are, by that module's own design, essentially never
 * fetched). Computed from the actual installed package + the curated
 * file's real import specifiers (not a hardcoded number) so this stays
 * correct if either changes. See `ICON_URL_WRAPPER_MAX_BYTES`'s doc for why
 * this set alone (not `ALWAYS_EXCLUDED_ICON_CHUNKS` above) needs the size
 * guard applied to it in `manifestTransforms` below. */
const ICON_URL_WRAPPER_NAMES = computeIconUrlWrapperNames();

/**
 * Phase 17 Milestone C1 fix — a REAL bug this phase's own offline-cold-
 * start e2e coverage caught (not a pre-existing regression this phase
 * introduced, but one this phase's restructuring of `main.tsx` into
 * `main.tsx` -> `boot.tsx` -> `App.tsx` was the first thing to expose):
 * `ICON_URL_WRAPPER_NAMES` above is a set of ICON NAMES (SVG basenames from
 * material-icon-theme's pack), used below to drop each icon's tiny
 * `import.meta.glob(...,{query:"?url"})` WRAPPER chunk (`materialIconLoader.
 * ts`'s per-icon lazy loader — a JS module whose entire body is a URL
 * string, always a few hundred bytes) from the precache. A name-only filter
 * can only see the FINAL chunk basename, not which source module produced
 * it — so it would silently also drop any UNRELATED chunk that happens to
 * share an icon's name (this is exactly why `ALWAYS_EXCLUDED_ICON_CHUNKS`
 * above is kept SEPARATE and unguarded: those two names have no plausible
 * collision, since nothing else in this build could ever be named exactly
 * "materialIconLoader" or "material-icons"). Confirmed concretely: material-icon-theme ships a real
 * `diff.svg` icon, and restructuring the entry graph for this phase's login
 * gate (an extra `boot.tsx` module between `main.tsx` and `App.tsx`) tipped
 * Rollup's chunking heuristic into splitting the (pre-existing, unrelated)
 * `diff` npm package — used by `@codemirror/merge`'s diff machinery,
 * pulled in by `App.tsx` itself now — into its OWN chunk, ALSO named
 * "diff" by Rollup. The name-only filter then excluded that 100KB+ vendor
 * chunk from precache right alongside the real ~0.4KB icon wrapper of the
 * same name — invisible until something offline actually needed to load
 * `App.tsx`'s chunk graph (a genuinely offline cold start reload), which
 * failed with "Failed to fetch dynamically imported module" once this
 * missing dependency chunk 404'd against the SW's own cache.
 *
 * The real, structural distinguisher between "a `?url` icon wrapper" and
 * "an unrelated chunk that happens to share its name" isn't the name at
 * all — it's SIZE: an icon wrapper's entire body is one URL string, so it
 * can never be more than a couple hundred bytes, while every real JS chunk
 * in this app is at minimum multiple KB. `manifestTransforms` below only
 * excludes a name match when the entry is ALSO small enough to plausibly
 * BE one of those wrapper chunks — generous headroom over the largest real
 * one observed (`architecture-*.js`, ~740 bytes) while staying far below
 * the smallest genuine vendor/app chunk this build has ever produced. */
const ICON_URL_WRAPPER_MAX_BYTES = 4096;

/**
 * Phase 13 (CI + GitHub Pages demo) — configurable deploy base path.
 * Defaults to "/" so every existing local flow (dev, build, preview, the
 * e2e suite's `vite preview` on port 5290) is byte-for-byte unchanged from
 * before this phase. CI's Pages job sets `VSNOTE_BASE_PATH=/vsnote/` (see
 * `.github/workflows/ci.yml`'s `pages` job) because GitHub Pages serves a
 * project site from `https://<user>.github.io/<repo>/`, not from the
 * origin root — every asset URL, the PWA manifest, and the service worker
 * all need to know that prefix, or the demo 404s its own assets the moment
 * it's not served from `/`. See docs/ARCHITECTURE.md's base-path note.
 *
 * Always ends with a trailing slash (vite's own `base` contract — see
 * https://vite.dev/config/shared-options.html#base) so `${BASE}foo.png`
 * concatenation below never needs a separate separator.
 */
const BASE = (() => {
  const raw = process.env.VSNOTE_BASE_PATH ?? "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
})();

/**
 * Phase 10 (sharing), extended Phase 10.5a (single-origin refactor, roadmap
 * §5.4) — dev/preview-only proxy for backend routes that need to be reached
 * SAME-ORIGIN from the SPA. In production this is moot: `server/app/
 * main.py` IS the SPA's web server, so every one of these paths is
 * genuinely same-origin with no proxy involved at all. In dev/preview,
 * `vite`/`vite preview` are a SEPARATE process from the backend
 * (`npm run server`, port 8787, or the e2e suite's own spawned instance on
 * 8788 — see `tests/e2e/shareFixtures.ts`), so this proxy exists purely to
 * make that split invisible to the client code, which as of Phase 10.5a
 * never has a configurable backend URL to fall back on — every one of its
 * `/api`, `/share`, `/git` calls is relative, full stop, and therefore
 * MUST reach a real backend through whatever origin served the page.
 *
 * `/api(/.*)?` and `/git(/.*)?` (Phase 10.5a — new this phase) are
 * unconditional proxies: both are pure JSON/git-protocol APIs with no
 * client-side route of their own to protect (unlike `/share/*` below), so
 * there's no bypass logic needed.
 *
 * `/share/*` below predates this phase and keeps its existing bypass logic
 * verbatim — everything below this paragraph is unchanged from Phase 10/
 * 10.5's own doc, still accurate:
 *
 * **Rule 1 — `POST /share/{slug}/auth` always needs the proxy.** This route
 * is mounted on the backend's ROOT app (`server/app/main.py`), which has NO
 * `CORSMiddleware` at all, by deliberate design (a raw share response must
 * carry zero CORS headers) — a cross-origin `fetch()` to it is structurally
 * unreadable from a different-origin dev server. See `src/share/api.ts`'s
 * `postShareAuth` doc for the full reasoning.
 *
 * **Rule 2 — `GET /share/{slug}` (JSON) needs the proxy too, but ONLY for
 * actual data fetches, never for the SPA's own page navigation to that
 * exact path.** Discovered during this phase's own e2e verification (the
 * password-share flow test failed at exactly this step until traced down):
 * `POST /share/{slug}/auth`'s success response sets a session cookie
 * scoped to `Path=/share/{slug}` (`server/app/routers/share_public.py`,
 * fixed server-side, not this phase's to change). A cookie's Path only
 * covers that prefix — `/api/share/{slug}/content` (the CORS-enabled route
 * this phase's own brief names as the one to use) does NOT start with
 * `/share/`, so the browser never attaches that cookie to a fetch there,
 * and a just-entered-correctly password share would 404 forever on the
 * content re-fetch. The fix is `share/ShareApp.tsx` fetching content via
 * THIS relative, same-origin `/share/{slug}` path (`Accept:
 * application/json`, matching `_wants_json` server-side) instead — its
 * Path prefix genuinely matches the cookie, and it's CORS-safe the exact
 * same way Rule 1 is (same-origin via this proxy in dev, same-origin
 * natively in the real Cloudflare Access topology). `share/api.ts` keeps
 * `getShareContent` (the `/api/.../content` CORS route) around too,
 * documented as the spec-following default for a deployment where the SPA
 * genuinely IS cross-origin from the backend — this app's own
 * `ShareApp.tsx` just doesn't use it, for the reason above.
 *
 * The tricky part: `/share/{slug}` (no suffix) is ALSO the exact address-
 * bar path THIS APP'S OWN router (`main.tsx`) owns for a real page
 * navigation to a rendered share — proxying it unconditionally would
 * silently break that (every visit would hit the backend's raw/JSON
 * response instead of `index.html`). `bypass` (a real, documented Vite/
 * `http-proxy-middleware` proxy option) distinguishes the two: a page
 * navigation never sends `Accept: application/json` (browsers request
 * `text/html` first for navigations), while every fetch this app makes to
 * this path explicitly does — so `bypass` returns the untouched request
 * path (telling Vite to handle it itself, i.e. serve `index.html` via its
 * own SPA fallback) for anything that ISN'T asking for JSON, and returns
 * nothing (falls through to the proxy) when it is.
 *
 * Target is env-driven (`VSNOTE_SHARE_PROXY_TARGET`) so the e2e suite can
 * point it at its own spawned backend (port 8788 — see
 * `tests/e2e/shareFixtures.ts`) via `package.json`'s `test:e2e` script,
 * without touching this file or colliding with a real `npm run dev`
 * session's backend on 8787.
 *
 * **Phase 10.5 (folder shares) extended Rule 2's pattern**, not its logic:
 * `share/ShareApp.tsx`'s folder-browsing mode fetches
 * `/share/{slug}/{relpath}` (any depth, e.g. `/share/abc/notes/x.md`) the
 * exact same same-origin, `Accept: application/json` way the root
 * `/share/{slug}` fetch always has — the ORIGINAL `^/share/[^/]+$` pattern
 * only ever matched the zero-relpath case, so a folder share's per-file/
 * per-directory fetch silently fell through to the SPA's own `index.html`
 * fallback instead of reaching the backend (caught by
 * `tests/e2e/share-folder.spec.ts`: the listing rendered fine — its own
 * fetch is the zero-relpath case — but clicking into a file 404'd because
 * THAT fetch never left this dev server). `(/.*)?` makes the relpath
 * segment optional, covering both cases with the identical JSON-only
 * `bypass` rule below — a real browser navigation to a deep folder-share
 * link (no `Accept: application/json`) still falls through to the SPA
 * fallback so `main.tsx`'s router can parse the relpath and mount
 * `ShareApp` itself, exactly as it always has for the root case.
 */
const SHARE_AUTH_PROXY_TARGET = process.env.VSNOTE_SHARE_PROXY_TARGET ?? "http://127.0.0.1:8787";
const shareAuthProxy = {
  // Phase 10.5a — /api and /git are plain APIs, no client-side route to
  // protect, so an unconditional proxy (no bypass) is correct as-is.
  "^/api(/.*)?$": {
    target: SHARE_AUTH_PROXY_TARGET,
    changeOrigin: true,
  },
  "^/git(/.*)?$": {
    target: SHARE_AUTH_PROXY_TARGET,
    changeOrigin: true,
  },
  "^/share/[^/]+/auth$": {
    target: SHARE_AUTH_PROXY_TARGET,
    changeOrigin: true,
  },
  "^/share/[^/]+(/.*)?$": {
    target: SHARE_AUTH_PROXY_TARGET,
    changeOrigin: true,
    bypass(req: { method?: string; headers: Record<string, string | string[] | undefined>; url?: string }) {
      // Only a GET can be a real browser navigation — a PUT (the editor
      // role's Save write-back, round 6 item 12) must always reach the
      // backend regardless of its Accept header. Before this method check,
      // the Accept-only heuristic misrouted Save PUTs into vite's SPA
      // fallback under dev/preview (found by the rebuilt reader's e2e).
      if (req.method && req.method !== "GET" && req.method !== "HEAD") return undefined;
      const accept = req.headers.accept;
      const acceptsJson = typeof accept === "string" && accept.includes("application/json");
      if (!acceptsJson) return req.url; // real navigation — let the SPA fallback handle it
      return undefined; // JSON fetch — proxy it to the backend
    },
  },
};
// Vite/Rollup's default hash is 8 chars of [A-Za-z0-9_-]; strips exactly
// that trailing `-<hash>.<ext>` so multi-dash real names ("material-icons",
// "folder-redux-actions.clone") survive intact.
const HASHED_CHUNK_NAME = /^(.*)-[\w-]{8}\.\w+$/;

// https://vite.dev/config/
export default defineConfig({
  // DESIGN-SPEC Amendments round 5 item 36 — the full demo vault is opt-in.
  // A default build (and therefore `docker compose up`) seeds a minimal
  // welcome vault; `VSNOTE_DEMO_VAULT=1` opts into the showcase content.
  // CI's Pages job sets it so the public demo is unchanged, and
  // package.json's `test:e2e` sets it so the e2e suite seeds the demo vault
  // explicitly instead of depending on it being the default. Declared for
  // TypeScript in src/env.d.ts.
  define: {
    __VSNOTE_DEMO_VAULT__: JSON.stringify(process.env.VSNOTE_DEMO_VAULT === "1"),
  },
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
      // `base`/`scope` (the plugin's own top-level options, distinct from
      // the `manifest.scope` web-manifest field below) already default to
      // vite's resolved `base` per vite-plugin-pwa's own docs — passed
      // explicitly here anyway so the SW registration path and precache
      // URL prefix are visibly tied to `BASE` rather than relying on an
      // implicit default reading vite's config correctly.
      base: BASE,
      scope: BASE,
      manifest: {
        name: "VSNote",
        short_name: "VSNote",
        description:
          "A local-first note & code workspace: VSCode's shell and power with Obsidian's live-preview writing experience.",
        theme_color: "#0e1015",
        background_color: "#0e1015",
        display: "standalone",
        // Unlike the plugin's own top-level `base`/`scope` above, these are
        // literal Web App Manifest fields (the W3C spec's `start_url`/
        // `scope`) — vite-plugin-pwa does NOT derive them from vite's
        // `base` on its own, so they're computed from `BASE` explicitly.
        // Left hardcoded at "/" (as this file did pre-Phase-13), a
        // `/vsnote/`-hosted install would register a PWA whose manifest
        // claims scope "/" — outside what the origin actually lets it
        // control, breaking install/standalone-launch on GitHub Pages.
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}pwa-192x192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${BASE}pwa-512x512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `${BASE}pwa-maskable-512x512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
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
        // and cheap where ~1150 glob patterns would be neither. The `size`
        // guard is `ICON_URL_WRAPPER_MAX_BYTES`'s own fix — see that
        // constant's doc for the exact collision it prevents.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.filter((entry) => {
              const fileName = entry.url.split("/").pop() ?? "";
              const match = HASHED_CHUNK_NAME.exec(fileName);
              const baseName = match ? match[1] : fileName;
              if (ALWAYS_EXCLUDED_ICON_CHUNKS.has(baseName)) return false;
              const looksLikeIconWrapper = entry.size <= ICON_URL_WRAPPER_MAX_BYTES;
              return !(ICON_URL_WRAPPER_NAMES.has(baseName) && looksLikeIconWrapper);
            }),
          }),
        ],
        // Phase 17 Milestone C1 (the app-wide login gate, `src/main.tsx` +
        // `src/share/api.ts::getAppConfig`) — this is the ONE runtime-
        // caching route in this app, and it exists purely to keep a
        // genuinely offline cold boot silent, not to cache anything.
        //
        // `getAppConfig()` runs UNCONDITIONALLY on every single boot (it
        // has to, to decide whether to gate) — unlike every other backend
        // probe in this app (`whoami()`, share reachability), which are all
        // deliberately lazy/opt-in specifically because an eager one at
        // boot was found to break `tests/e2e/probes.spec.ts`'s offline
        // cold-start probe (see `src/App.tsx`'s boot-effect doc for the
        // full empirical finding): Chromium logs "Failed to load resource:
        // net::ERR_..." to the page console for ANY request that fails at
        // the network layer, independent of whether app code catches the
        // rejection, and `navigator.onLine` can't be used to dodge the
        // attempt because Playwright's `context.setOffline(true)` doesn't
        // flip it the way a real disconnected NIC does. Confirmed directly
        // for this exact case (a throwaway repro) rather than assumed: a
        // service worker's OWN internal `fetch()` to the network, wrapped
        // in try/catch inside a `fetch` event handler, produces ZERO
        // console output when it fails, because the browser's resource-load
        // accounting is against the PAGE-visible request (which the SW's
        // `respondWith` always resolves successfully), not the SW's private
        // network attempt behind it.
        //
        // So: intercept exactly `GET /api/app-config`, try the real
        // network first, and on failure resolve with a synthetic
        // `{login_required:false,...}` response instead of letting the
        // request fail — the client-side `getAppConfig()` never even sees
        // a rejection in this case, and per the gate's own contract
        // (`login_required:false` never gates) this is EXACTLY the right
        // answer for "backend unreachable" anyway (CLAUDE.md rule 3: an
        // unreachable backend must never gate the shell). A plain function
        // handler (not a named Workbox strategy) so nothing here writes to
        // Cache Storage at all — this must never interact with
        // `tests/e2e/probes.spec.ts`'s precache-budget assertions, and it
        // doesn't: no `caches.open`/`cache.put` call exists anywhere below.
        //
        // This function is inlined verbatim into the generated service
        // worker's source (`workbox-build`'s documented behavior for a
        // function `handler`, confirmed in `runtime-caching-converter.js`:
        // `entry.handler.toString()`), so it must be entirely
        // self-contained — no reference to anything in this module's outer
        // scope (`BASE`, `ICON_URL_WRAPPER_NAMES`, etc.) survives that
        // serialization.
        runtimeCaching: [
          {
            urlPattern: /\/api\/app-config$/,
            handler: async ({ request }) => {
              try {
                return await fetch(request);
              } catch {
                return new Response(
                  JSON.stringify({ login_required: false, password_login: false, cf_access: false }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                );
              }
            },
          },
        ],
      },
    }),
  ],
  // See `BASE`'s doc above — this is the one setting that actually drives
  // where Vite emits/expects every built asset URL (JS/CSS chunks, the
  // entry script tag rewritten into index.html, and `%BASE_URL%` in
  // index.html itself). Defaults to "/", so a plain `npm run build`/`vite
  // preview`/`vite dev` with no env var is unchanged.
  base: BASE,
  // Phase 10 (sharing) — see `shareAuthProxy`'s doc above. Both `vite dev`
  // (`server.proxy`) and `vite preview` (`preview.proxy` — a SEPARATE Vite
  // option; `server.proxy` alone does NOT apply to `vite preview`) need it,
  // since either can be the SPA origin the e2e suite/a developer uses.
  server: {
    proxy: shareAuthProxy,
  },
  preview: {
    proxy: shareAuthProxy,
  },
});

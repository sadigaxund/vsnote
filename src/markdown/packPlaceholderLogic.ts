/**
 * Phase M3 (worker 2) — the ONE place a pack's component ever reaches the
 * renderer: as a clearly-labelled, unrendered placeholder, never as
 * executed code. Consumed by both `render.tsx` (the static renderer) and
 * `directiveLezer/decorations.ts` (the CM6 live-preview widget renderer) —
 * see each file's own wiring for why both needed to change, not just one.
 * The two placeholder components themselves live in
 * `packPlaceholderComponents.tsx` (ESLint's `react-refresh/only-export-
 * components` — this file's other exports, `buildPackRegistry`/
 * `PackForRegistry`, are not components).
 *
 * ## Why a pack's component is NEVER executed here
 *
 * `@markii/pack`'s `.mkp` archive format (`openPackArchive`) produces
 * exactly one compiled rendering artifact per pack: `webview.js`, a
 * PREBUILT, engine-targeted (`pack.json`'s `engine` field — always
 * `"react"` for anything `@markii/react` could run at all) JavaScript
 * bundle. There is no second, sandboxed way to run a pack's component:
 * `webview.js` either runs with the SAME privileges as every other module
 * in this app's bundle (the app origin, `document`, the in-memory lightning-
 * fs vault, any live share token this session holds) or it does not run at
 * all. This app's rendering path is plain React on the main thread with no
 * process/iframe/worker sandbox around a directive's render — unlike
 * scripts (`src/markii/host/`'s whole `ScriptIsolate` apparatus: a
 * terminatable Web Worker, a capability allowlist, a grant prompt), a pack
 * component renders at NOTE-OPEN time, by definition, which would mean a
 * pack's arbitrary JavaScript runs the instant a note that merely
 * REFERENCES it is opened — no separate "run" action, no grant prompt, no
 * opportunity to say no. That is exactly the "rendering never executes
 * anything" line CLAUDE.md/M3 draws for scripts, applied to packs: this
 * app does not build a JS sandbox to cross it (a real one — V8 isolates,
 * an iframe with a locked-down CSP and postMessage-only communication —
 * is a substantial, separate engineering investment, not something to
 * improvise partially), so a pack component is decoded (`host/packs.ts`
 * reads `scriptModules`, the pack's Lua, for `require`) but its
 * `webview.js`/`webview.css` bytes are never read past `openPackArchive`'s
 * own return value, are never persisted (`packStore.ts`), and are never
 * referenced by name from this file or anywhere else. See
 * `docs/ARCHITECTURE.md`'s Phase M3 section for the same reasoning and
 * what it costs (every pack's actual UI is unavailable, indefinitely,
 * until this app grows a real component sandbox).
 *
 * ## Reusing `@markii/react`'s namespacing/collision machinery
 *
 * Rather than reimplement `composeDirectiveName`/collision detection,
 * `buildPackRegistry` calls `@markii/react`'s own `installPacks` — the
 * SAME function a host that actually ran pack components would call —
 * with `componentModules` built from OUR placeholder components, never
 * from anything derived out of `webview.js`. `installPacks` still performs
 * every check it always does (namespace collision detection via
 * `detectNamespaceCollisions`, per-manifest `engine` gating dropping a
 * non-`"react"` pack to an empty registry, `Object.hasOwn`-guarded
 * manifest reads) — this file only supplies WHAT gets registered under
 * each composed name, never bypasses HOW registration happens.
 *
 * ## Styling
 *
 * Reuses `@markii/react`'s own `.mk-unknown`/`.mk-unknown--block`/
 * `.mk-unknown--inline`/`.mk-unknown__label` classes (see `doc.css`) rather
 * than inventing new CSS: a pack component this app declines to render is,
 * visually, the same "dashed box, italic label" affordance as any other
 * directive the renderer doesn't know how to render — just with a REASON
 * in the label instead of "unknown directive."
 */
import { createElement, type ComponentType } from "react";
import type { PackManifest } from "@markii/pack";
import { packComponents } from "@markii/pack";
import {
  installPacks,
  type InstallPacksResult,
  type MarkComponentProps,
  type PackComponentModules,
  type PackToInstall,
  type Registry,
} from "@markii/react";
import { PackComponentPlaceholder, PackComponentPlaceholderInline } from "./packPlaceholderComponents";

/** The minimal shape this module needs from an enabled pack — see `host/packs.ts`'s `EnabledPack`, which structurally satisfies this. */
export interface PackForRegistry {
  manifest: PackManifest;
}

function placeholderEntry(packName: string, localName: string, inline: boolean): { component: ComponentType<MarkComponentProps>; inline: boolean } {
  const Component = inline ? PackComponentPlaceholderInline : PackComponentPlaceholder;
  return {
    component: () => createElement(Component, { packName, localName }),
    inline,
  };
}

function componentModulesFor(manifest: PackManifest): PackComponentModules {
  const modules: PackComponentModules = {};
  for (const listing of packComponents(manifest)) {
    modules[listing.localName] = placeholderEntry(manifest.name, listing.localName, listing.kind === "inline");
  }
  return modules;
}

/**
 * Builds the placeholder `Registry` for a set of enabled packs, via
 * `@markii/react`'s `installPacks` — see module doc. `base` (default:
 * empty) is passed through to `installPacks` unchanged, so a caller can
 * layer this under/over its own registry the same way `installPacks`
 * itself supports.
 */
export function buildPackRegistry(packs: readonly PackForRegistry[], base?: Registry): InstallPacksResult {
  const toInstall: PackToInstall[] = packs.map((p) => ({
    manifest: p.manifest,
    componentModules: componentModulesFor(p.manifest),
  }));
  return installPacks(toInstall, base);
}

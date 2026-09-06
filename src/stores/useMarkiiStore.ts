/**
 * Phase M3, worker 3 — the one app-shell store that turns worker 1/2's
 * platform-agnostic `src/markii/host/` orchestration and browser adapters
 * (`src/markii/platform/browser/`) into something the UI can actually
 * drive: pack enable/disable/remove, grant listing/revocation, the
 * grant-prompt bridge (`runScripts`'s `deps.grantPrompt` is an async
 * callback; this store is where that callback's Promise gets its
 * `resolve`), per-note run state (`RunSummary`, a running flag, a bump
 * counter the Rendered-mode live preview watches to know a note's values
 * changed), and this note's opened `.mkz` bundle (if any).
 *
 * Nothing here ever calls `runScripts` except `runNote`, and `runNote` is
 * only ever called from a real user action (`EditorHeader`'s "Run
 * scripts" button, or `OverflowMenuItems`' mirror entry — see this
 * module's doc note below on why there is no third, automatic caller).
 * Rendering (`LivePreviewEditor`, `render.tsx`) only ever READS
 * `runVersion`/persisted values through `loadPersistedValues`, never
 * triggers a run.
 *
 * **No `auto`/`scheduled` trigger exists yet.** An earlier draft of this
 * store shipped an `autoRunEnabled` setting with no code path that ever
 * consulted it — a settings toggle that changed no behavior, caught in
 * review and removed rather than shipped. `runScripts.ts`'s tier
 * enforcement (an `auto`/`scheduled` trigger is read-only and never
 * prompts, regardless of what a manual grant contains) is unaffected and
 * ready for whoever builds a real scheduler; see `docs/DESIGN-SPEC.md`
 * item 97 and `docs/ARCHITECTURE.md`'s Phase M3 worker-3 section for the
 * explicit "not implemented yet" record.
 */
import { create } from "zustand";
import type { GrantDecision, GrantPromptRequest, GrantRecord } from "../markii/host/types";
import type { EnabledPack, PackLoadFailure } from "../markii/host/packs";
import {
  createBrowserGrantStore,
  createBrowserNetProvider,
  createBrowserPackStore,
  createBrowserScriptIsolate,
  loadBundleFromVault,
  loadPersistedValues,
  savePersistedValues,
  type OpenedBundle,
  type PackEnableResult,
} from "../markii/platform/browser";
import { runScripts } from "../markii/host/runScripts";
import type { RunSummary, RunTrigger } from "@markii/runtime";
import { setMarkiiDiscoveredPacks } from "../editor/markiiCompletion";
import { displayToFsPath } from "../fs/paths";

const packStore = createBrowserPackStore();
const grantStore = createBrowserGrantStore();

/** `vault/notes/x.mk.md` -> `vault/notes/x.mkz` — the one convention this
 * app uses to find a note's bundle without a full Explorer-driven `.mkz`
 * open surface (see `docs/ARCHITECTURE.md`'s Phase M3 worker-3 section for
 * why: a bundle is opened automatically by sibling naming, not browsed
 * for). Any other display path (no `.mk.md` suffix) has no bundle
 * convention and always resolves to `undefined`. */
export function siblingBundleDisplayPath(notePath: string): string | undefined {
  if (!notePath.endsWith(".mk.md")) return undefined;
  return `${notePath.slice(0, -".mk.md".length)}.mkz`;
}

interface MarkiiState {
  packs: EnabledPack[];
  packsLoaded: boolean;
  grants: GrantRecord[];
  grantsLoaded: boolean;
  /** Set while a `GrantPrompt` request is awaiting a decision from
   * `GrantPromptDialog` — `null` when no prompt is pending. */
  pendingGrantRequest: GrantPromptRequest | null;
  runningPaths: Record<string, boolean>;
  runSummaries: Record<string, RunSummary | undefined>;
  /** Bumped every time a manual run finishes for a path — the ONE thing
   * `LivePreviewEditor` watches to know it should reload persisted values
   * and re-render. Never read as anything but a change signal. */
  runVersions: Record<string, number>;
  bundles: Record<string, OpenedBundle | undefined>;
  bundleLoadAttempted: Record<string, boolean>;

  refreshPacks: () => Promise<void>;
  refreshGrants: () => Promise<void>;
  enablePack: (bytes: Uint8Array) => Promise<PackEnableResult>;
  disablePack: (namespace: string) => Promise<void>;
  reenablePack: (namespace: string) => Promise<void>;
  removePack: (namespace: string) => Promise<void>;
  revokeGrant: (key: string) => Promise<void>;

  /** The `GrantPrompt` handed to `runScripts` — resolves once
   * `GrantPromptDialog` calls `resolveGrantPrompt`. */
  requestGrantDecision: (request: GrantPromptRequest) => Promise<GrantDecision>;
  resolveGrantPrompt: (decision: GrantDecision) => void;

  runNote: (path: string, text: string, trigger: RunTrigger) => Promise<RunSummary>;
}

let grantPromptResolve: ((decision: GrantDecision) => void) | null = null;

export const useMarkiiStore = create<MarkiiState>()((set, get) => ({
      packs: [],
      packsLoaded: false,
      grants: [],
      grantsLoaded: false,
      pendingGrantRequest: null,
      runningPaths: {},
      runSummaries: {},
      runVersions: {},
      bundles: {},
      bundleLoadAttempted: {},

      async refreshPacks() {
        const packs = await packStore.list();
        set({ packs, packsLoaded: true });
        setMarkiiDiscoveredPacks(packs.filter((p) => p.enabled));
      },

      async refreshGrants() {
        const grants = await grantStore.list();
        set({ grants, grantsLoaded: true });
      },

      async enablePack(bytes) {
        const result = await packStore.enable(bytes);
        await get().refreshPacks();
        return result;
      },
      async disablePack(namespace) {
        await packStore.disable(namespace);
        await get().refreshPacks();
      },
      async reenablePack(namespace) {
        await packStore.reenable(namespace);
        await get().refreshPacks();
      },
      async removePack(namespace) {
        await packStore.remove(namespace);
        await get().refreshPacks();
      },
      async revokeGrant(key) {
        await grantStore.revoke(key);
        await get().refreshGrants();
      },

      requestGrantDecision(request) {
        return new Promise<GrantDecision>((resolve) => {
          grantPromptResolve = resolve;
          set({ pendingGrantRequest: request });
        });
      },
      resolveGrantPrompt(decision) {
        const resolve = grantPromptResolve;
        grantPromptResolve = null;
        set({ pendingGrantRequest: null });
        resolve?.(decision);
      },

      async runNote(path, text, trigger) {
        set((s) => ({ runningPaths: { ...s.runningPaths, [path]: true } }));
        try {
          const enabledPacks = get().packs.filter((p) => p.enabled);

          let bundle = get().bundles[path];
          if (!bundle && !get().bundleLoadAttempted[path]) {
            const siblingPath = siblingBundleDisplayPath(path);
            if (siblingPath) {
              bundle = await loadBundleFromVault(displayToFsPath(siblingPath));
            }
            set((s) => ({
              bundleLoadAttempted: { ...s.bundleLoadAttempted, [path]: true },
              bundles: { ...s.bundles, [path]: bundle },
            }));
          }

          const summary = await runScripts(path, text, trigger, {
            isolateFactory: (config) => createBrowserScriptIsolate(config),
            netProvider: createBrowserNetProvider(),
            grantStore,
            grantPrompt: (request) => get().requestGrantDecision(request),
            loadPersistedValues,
            savePersistedValues,
            bundle,
            enabledPacks,
          });

          set((s) => ({
            runSummaries: { ...s.runSummaries, [path]: summary },
            runVersions: { ...s.runVersions, [path]: (s.runVersions[path] ?? 0) + 1 },
          }));
          void get().refreshGrants();
          return summary;
        } finally {
          set((s) => ({ runningPaths: { ...s.runningPaths, [path]: false } }));
        }
      },
    }));

export type { PackLoadFailure };

/**
 * Named selector (not an inline `(s) => s.packs.filter(...)` arrow) for
 * `LivePreviewEditor.tsx`'s `useShallow` subscription — kept as its own
 * function so `tests/unit/storeSelectorHygiene.test.ts`'s static scan
 * (which flags an inline fresh-array arrow regardless of `useShallow`)
 * reads it as what it is: a `useShallow`-safe selector, not a bare
 * `Object.is`-compared one.
 */
export function selectEnabledPacks(s: { packs: EnabledPack[] }): EnabledPack[] {
  return s.packs.filter((p) => p.enabled);
}

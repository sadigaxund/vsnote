/**
 * Markii-the-extension's own settings (R5-9, "Markii as an extension") —
 * separate from `useMarkiiStore.ts` (packs/grants/run orchestration, Phase
 * M3) because this store holds PREFERENCES, not runtime state: the
 * Extensions panel's per-row `Enabled` switch, the extension page's
 * Rendering/Editor/Scripting sections. Naming for the rows this backs
 * follows markii-org/markii-obsidian's own `src/settings-tab.ts` (fetched
 * via `gh api` for this round) where an equivalent setting exists there —
 * "Hide script blocks" and "Render components in Reading view" (renamed
 * "Render components in the Preview pane" here — VSNote's rendered surface
 * is the Preview pane, not Obsidian's Reading view) both come straight from
 * that file, including its exact wording for "Turn off script execution on
 * this device" and "Run scripts when a note opens". VSNote has no
 * equivalent of the Obsidian plugin's `previewPlacement`/`previewWidth`
 * (no separate preview pane placement concept) or scheduled-refresh timer
 * (no scheduler exists yet — see `useMarkiiStore.ts`'s own "no auto/
 * scheduled trigger exists yet" note), so those aren't reproduced; this
 * round's owner brief asks for "per-tier defaults" in their place, which
 * has no upstream analogue and is new here.
 *
 * **R5-9b update — every remaining toggle now has a real reader, or was
 * removed.** R5-9 shipped six rows backed by state with no consumer at all
 * (this file's own honesty rule: a toggle that flips a variable nothing
 * reads is exactly the "dead toggle" `useMarkiiStore.ts`'s `autoRunEnabled`
 * history warns against). R5-9b resolved each one:
 *   - `hideScriptBlocks` and `renderComponentsInPreview` are now real:
 *     `MarkdownPreviewPane.tsx` reads both and threads them into
 *     `render.tsx`'s `renderMarkdown` (`hideScriptBlocks` drops a Markii
 *     script fence from the Preview pane's output entirely;
 *     `renderComponentsInPreview`, via `previewPacksLogic.ts`'s
 *     `packsForPreview`, decides whether that pane is given any enabled-pack
 *     registry at all — see both files' own docs for exactly what changes).
 *   - `fenceSugarEnabled` is now real: `LivePreviewEditor.tsx` threads it
 *     into `markiiCompletion.ts`'s `markiiEditorExtensions`, which gates
 *     ONLY the manual-typing outer-fence-lengthening Enter keymap (R3-12/
 *     DESIGN-SPEC item 117's "host-side sugar" — see that function's own
 *     doc for why the shorthand grammar itself, gated by the master
 *     `Enabled` switch, is a separate thing).
 *   - `revealHintEnabled` is now real: `LivePreviewEditor.tsx` threads it
 *     through to `directiveLezer/decorations.ts`'s
 *     `markiiLivePreviewDecorations`, which gates `maybePushRevealHint`
 *     (the once-per-session "rendered when the cursor leaves" hint).
 *   - `runOnNoteOpen` and `autoTierDefault` were REMOVED (row, store field,
 *     and — for `autoTierDefault` — the `AutoTierDefault` type) rather than
 *     wired: both are the auto/scheduled script trigger this repo already
 *     rejected once (`useMarkiiStore.ts`'s "No `auto`/`scheduled` trigger
 *     exists yet" note, and `docs/ARCHITECTURE.md`'s Known limitations "No
 *     auto or scheduled script trigger" — "A dead toggle was removed rather
 *     than shipped"). Building a scheduler to give either one a reader was
 *     explicitly out of scope for R5-9b; see that Known limitations entry
 *     for the follow-up record. The `migrate` below drops both keys from
 *     any localStorage state an R5-9 build already persisted.
 *
 * **What's actually wired (see each consumer file's own doc for specifics):**
 *   - `enabled` (the master kill switch) and `scriptsDisabledOnDevice`:
 *     `useMarkiiStore.runNote` checks both and refuses to run when either is
 *     off, and `LivePreviewEditor.tsx` skips installing the `.mk.md`
 *     directive grammar/decorations/completion bundle entirely when
 *     `enabled` is off — directive rendering, fence sugar's underlying
 *     shorthand grammar (part of the same `directiveLezer` grammar), and
 *     completion all come from that one bundle, so gating its installation
 *     gates all three at once, matching the Extensions row's documented
 *     behavior.
 *   - `directiveRenderingEnabled`, `completionEnabled`: independent
 *     finer-grained gates `LivePreviewEditor.tsx` reads — the master switch
 *     ORs with these (either off turns the relevant piece off).
 *   - `hideScriptBlocks`, `renderComponentsInPreview`, `fenceSugarEnabled`,
 *     `revealHintEnabled`: see the R5-9b update above.
 *
 * Persisted to localStorage (`persist` middleware, same convention as
 * `useSettingsStore.ts`) rather than the vault — nothing here is document
 * content, and `scriptsDisabledOnDevice` is explicitly device-local by
 * design (mirroring upstream's own vault-synced-vs-local split, collapsed
 * to one persisted store here since VSNote has no separate "vault-synced
 * settings" concept for a single-extension app).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MarkiiExtensionSettingsState {
  /** Extensions-panel row switch: the master kill switch. Off means no
   * directive rendering, no fence sugar, no scripts — see this file's
   * module doc for exactly what reads this. */
  enabled: boolean;

  // Rendering
  directiveRenderingEnabled: boolean;
  hideScriptBlocks: boolean;
  renderComponentsInPreview: boolean;

  // Editor
  completionEnabled: boolean;
  fenceSugarEnabled: boolean;
  revealHintEnabled: boolean;

  // Scripting (device-local)
  scriptsDisabledOnDevice: boolean;

  setEnabled: (v: boolean) => void;
  setDirectiveRenderingEnabled: (v: boolean) => void;
  setHideScriptBlocks: (v: boolean) => void;
  setRenderComponentsInPreview: (v: boolean) => void;
  setCompletionEnabled: (v: boolean) => void;
  setFenceSugarEnabled: (v: boolean) => void;
  setRevealHintEnabled: (v: boolean) => void;
  setScriptsDisabledOnDevice: (v: boolean) => void;
}

export const useMarkiiExtensionSettingsStore = create<MarkiiExtensionSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      directiveRenderingEnabled: true,
      hideScriptBlocks: false,
      renderComponentsInPreview: true,
      completionEnabled: true,
      fenceSugarEnabled: true,
      revealHintEnabled: true,
      scriptsDisabledOnDevice: false,

      setEnabled: (v) => set({ enabled: v }),
      setDirectiveRenderingEnabled: (v) => set({ directiveRenderingEnabled: v }),
      setHideScriptBlocks: (v) => set({ hideScriptBlocks: v }),
      setRenderComponentsInPreview: (v) => set({ renderComponentsInPreview: v }),
      setCompletionEnabled: (v) => set({ completionEnabled: v }),
      setFenceSugarEnabled: (v) => set({ fenceSugarEnabled: v }),
      setRevealHintEnabled: (v) => set({ revealHintEnabled: v }),
      setScriptsDisabledOnDevice: (v) => set({ scriptsDisabledOnDevice: v }),
    }),
    {
      name: "vsnote-markii-extension-settings",
      // R5-9b — `runOnNoteOpen`/`autoTierDefault` shipped in R5-9 with no
      // reader (see this file's module doc's history note) and were
      // removed rather than left dead. Bumping `version` and stripping
      // both keys on `migrate` means a device that already persisted the
      // R5-9 shape doesn't keep carrying either one forward as inert JSON
      // nothing in this file's own type declares anymore — a fresh
      // `create()` default would never have introduced them either.
      version: 1,
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const rest = { ...(persisted as Record<string, unknown>) };
        delete rest.runOnNoteOpen;
        delete rest.autoTierDefault;
        return rest;
      },
    },
  ),
);

/** Selector helper: "does this device actually let Markii run anything
 * right now" — the master switch AND the device-local script switch both
 * have to be on. `useMarkiiStore.runNote` and any future manual-run
 * trigger call this instead of re-deriving the AND themselves. */
export function selectScriptsAllowed(s: MarkiiExtensionSettingsState): boolean {
  return s.enabled && !s.scriptsDisabledOnDevice;
}

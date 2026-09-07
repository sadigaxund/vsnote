/**
 * Visitor-side reading preferences for the public `/share/<slug>` reader
 * (R3-5b). DECIDED (do not redesign): the owner's editor "Rendered view"
 * settings never apply here — rendering must stay deterministic and the
 * visitor is not the owner (`useSettingsStore` is never imported on this
 * route, see `ShareApp.tsx`'s module doc, requirement 1). Instead the
 * reader gets its OWN, much smaller preference set, scoped to the VISITOR's
 * browser via `localStorage` under `vsnote-share-reader-prefs` — a key
 * deliberately distinct from the app's own `vsnote-settings` (`stores/
 * useSettingsStore.ts`) and `vsnote-tabs`/`vsnote-git-sync` keys, so a
 * visitor who is also this app's owner, browsing their own share link,
 * never has one namespace bleed into the other.
 *
 * No zustand here on purpose — this route's whole point is staying free of
 * the app's store graph (module doc requirement 1: "never imports any
 * `stores/use*Store` module"), and three primitive fields don't need a
 * store. Reading/writing `localStorage` is wrapped in try/catch throughout:
 * private-mode Safari (and any browser with storage disabled) throws on
 * `getItem`/`setItem` rather than silently no-opping, and a visitor with a
 * quota exceeded or storage blocked should still get a working reader —
 * just one that resets to defaults every load instead of remembering.
 */
import { useEffect, useState } from "react";

export type ReaderThemePref = "system" | "light" | "dark";
export type ReaderFontSizePref = "s" | "m" | "l";

export interface ReaderPrefs {
  theme: ReaderThemePref;
  fontSize: ReaderFontSizePref;
  /** Word-wrap for the plain code/text file view (`ShareApp.tsx`'s
   * `.share-reader__code-panel` / `CodeBlock`). Markdown prose always
   * wraps — this only affects preformatted code lines, which are the one
   * place "no wrap, scroll" is ever a real reading-comfort choice. */
  codeWrap: boolean;
}

/** No stored preference -> system theme, medium font, wrap on (stated
 * default per the task spec — the same "read comfortably, see everything"
 * choice `CodeBlock`'s app-side Rendered mode defaults to). */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  theme: "system",
  fontSize: "m",
  codeWrap: true,
};

const STORAGE_KEY = "vsnote-share-reader-prefs";

function isThemePref(v: unknown): v is ReaderThemePref {
  return v === "system" || v === "light" || v === "dark";
}
function isFontSizePref(v: unknown): v is ReaderFontSizePref {
  return v === "s" || v === "m" || v === "l";
}

function loadPrefs(): ReaderPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_READER_PREFS;
    const p = parsed as Record<string, unknown>;
    return {
      theme: isThemePref(p.theme) ? p.theme : DEFAULT_READER_PREFS.theme,
      fontSize: isFontSizePref(p.fontSize) ? p.fontSize : DEFAULT_READER_PREFS.fontSize,
      codeWrap: typeof p.codeWrap === "boolean" ? p.codeWrap : DEFAULT_READER_PREFS.codeWrap,
    };
  } catch {
    // Storage unavailable/corrupt (private mode, quota, hand-edited JSON) —
    // read as "no preference yet" rather than throwing.
    return DEFAULT_READER_PREFS;
  }
}

function savePrefs(prefs: ReaderPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / storage blocked: the visitor keeps a working,
    // session-only preference (React state still updates); it just won't
    // survive a reload. No user-visible error either way.
  }
}

/** Read + persist the visitor's reading preferences. Returns the current
 * value and a patch-style setter (only changed fields need to be passed). */
export function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs());

  function update(patch: Partial<ReaderPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }

  return [prefs, update];
}

/** Resolves `"system"` against the visitor's live `prefers-color-scheme`,
 * tracking changes for a visitor who leaves the tab open across a system
 * theme switch. `"light"`/`"dark"` pass through unchanged. */
export function useResolvedReaderTheme(theme: ReaderThemePref): "light" | "dark" {
  const getSystem = () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [system, setSystem] = useState<"light" | "dark">(getSystem);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return theme === "system" ? system : theme;
}

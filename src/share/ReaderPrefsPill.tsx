/**
 * ReaderPrefsPill — the public reader's ONLY chrome (R3-5b): a small
 * floating control set for the visitor-side preferences in
 * `readerPrefs.ts` (theme / font size / code wrap). Deliberately not a
 * dialog or a menu — three always-visible controls in one pill, per the
 * task spec ("nothing else in it: no chrome, no nav, no branding").
 *
 * Built from `my-you-eye`'s own `SegmentedControl` and `Switch` — both
 * genuinely exist in the installed package (v2026.8.3,
 * `node_modules/my-you-eye/dist/index.d.ts`: `SegmentedControl<T>` with
 * `options`/`value`/`onValueChange`, `Switch` with `checked`/
 * `onCheckedChange`, both already used exactly this way in
 * `components/settings/Editor.tsx`). This is NOT the same as
 * `components/local/SegmentedControl.tsx` (a different, older local
 * component built before the library shipped its own — that one exists for
 * per-segment `disabled` support and a `Tooltip`-based icon-only mode,
 * neither of which this pill needs). No missing component here, so no
 * `docs/COMPONENT-BACKLOG.md` entry.
 *
 * Idle-fade behavior: opacity drops after 2.5s of no pointer/keyboard
 * activity anywhere on the page, and `share-reader.css`'s rules in
 * `index.css` force it back to full opacity on `:hover`/`:focus-within`
 * regardless of the idle timer — so a keyboard user who has already
 * Tab-focused a control never has it fade out from under them, and it is
 * never `display:none`/`visibility:hidden` (which would pull it out of
 * the tab order or hide a focused control) — only `opacity`, so Tab always
 * reaches it and nothing here can trap focus.
 */
import { useEffect, useRef, useState } from "react";
import { SegmentedControl, Switch } from "my-you-eye";
import type { ReaderFontSizePref, ReaderPrefs, ReaderThemePref } from "./readerPrefs";

const THEME_OPTIONS: { value: ReaderThemePref; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const FONT_SIZE_OPTIONS: { value: ReaderFontSizePref; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
];

const IDLE_MS = 2500;

export function ReaderPrefsPill({ prefs, onChange }: { prefs: ReaderPrefs; onChange: (patch: Partial<ReaderPrefs>) => void }) {
  const [awake, setAwake] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const wake = () => {
      setAwake(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  return (
    <div className="share-reader-prefs" data-testid="share-reader-prefs" data-awake={awake ? "true" : "false"} role="group" aria-label="Reading preferences">
      <SegmentedControl<ReaderThemePref>
        size="xs"
        options={THEME_OPTIONS}
        value={prefs.theme}
        onValueChange={(v) => onChange({ theme: v })}
        aria-label="Theme"
        data-testid="share-reader-prefs-theme"
      />
      <SegmentedControl<ReaderFontSizePref>
        size="xs"
        options={FONT_SIZE_OPTIONS}
        value={prefs.fontSize}
        onValueChange={(v) => onChange({ fontSize: v })}
        aria-label="Font size"
        data-testid="share-reader-prefs-fontsize"
      />
      <label className="share-reader-prefs__wrap">
        <Switch
          size="sm"
          checked={prefs.codeWrap}
          onCheckedChange={(v) => onChange({ codeWrap: v })}
          aria-label="Wrap long code lines"
          data-testid="share-reader-prefs-wrap"
        />
        <span aria-hidden="true">Wrap</span>
      </label>
    </div>
  );
}

/**
 * Settings dialog — DESIGN-SPEC "Misc / settings": "theme (dark default;
 * the library's themes), accent color, editor font size, tab size, word
 * wrap, 'reading view lock' default mode per file type." Persisted via
 * `useSettingsStore` (already wired to CM6's font-size/word-wrap/tab-size
 * `Compartment`s since Phase 3, and to `<html>`'s `data-theme`/accent via
 * `applyDomSettings` — see that module's doc).
 *
 * Composition over the library's `Dialog`/`FormField`/`Select`/`Slider`/
 * `RadioGroup`/`Switch`/`Button` — no new local primitive needed. The one
 * gap is a color-swatch/picker: the library has no `ColorPicker` (checked
 * `skills/components.json`'s full catalog), so accent uses the platform's
 * native `<input type="color">` rather than a hand-rolled swatch grid —
 * logged in `docs/COMPONENT-BACKLOG.md` as a `planned` gap, not built
 * locally, since a native color picker already fully satisfies "pick an
 * accent color" without inventing UI the library doesn't have an opinion
 * on yet.
 *
 * `React.lazy`-loaded from `App.tsx` (only mounted once Settings is
 * actually opened — gear icon, palette command, or ⌘,) per
 * IMPLEMENTATION-PLAN.md Phase 5's bundle-discipline note.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from "my-you-eye";
import { THEME_OPTIONS, useSettingsStore, type SlateTheme } from "../stores/useSettingsStore";
import { defaultModeFor } from "../filetypes/registry";
import type { EditorMode, FileKind } from "../types";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THEME_LABELS: Record<SlateTheme, string> = {
  dark: "Dark (Slate default)",
  default: "Default",
  neon: "Neon",
  contrast: "Contrast",
  glass: "Glass",
  comic: "Comic",
  brutal: "Brutal",
  stark: "Stark",
  frosted: "Frosted",
  metallic: "Metallic",
};

const TAB_SIZES = [2, 4, 8] as const;

/** File kinds whose registry entry offers both Rendered and Source — the
 * only ones a "default mode" choice is meaningful for (a code file has no
 * Rendered mode to default *to*). */
const DEFAULT_MODE_KINDS: { kind: FileKind; label: string }[] = [
  { kind: "md", label: "Markdown (.md)" },
  { kind: "json", label: "JSON (.json)" },
  { kind: "html", label: "HTML (.html)" },
  { kind: "csv", label: "CSV (.csv)" },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const theme = useSettingsStore((s) => s.theme);
  const accent = useSettingsStore((s) => s.accent);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const tabSize = useSettingsStore((s) => s.tabSize);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const readingViewDefaultMode = useSettingsStore((s) => s.readingViewDefaultMode);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const setTabSize = useSettingsStore((s) => s.setTabSize);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const setReadingViewDefaultMode = useSettingsStore((s) => s.setReadingViewDefaultMode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Editor, theme, and per-file-type defaults — saved automatically.</DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <FormField label="Theme">
                <Select value={theme} onValueChange={(v) => setTheme(v as SlateTheme)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THEME_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {THEME_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <div>
              <FormField label="Accent color">
                <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}>
                  <input
                    type="color"
                    aria-label="Accent color"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    style={{
                      width: 32,
                      height: 32,
                      padding: 0,
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-ui-sm)",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  />
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-muted)" }}>{accent}</span>
                </div>
              </FormField>
            </div>
          </div>

          <FormField label="Editor font size" hint="Applies to Source and Rendered views.">
            <Slider
              min={11}
              max={20}
              step={1}
              value={editorFontSize}
              showValue
              onChange={(e) => setEditorFontSize(Number(e.target.value))}
              aria-label="Editor font size"
            />
          </FormField>

          <FormField label="Tab size">
            <RadioGroup
              value={String(tabSize)}
              onValueChange={(v) => setTabSize(Number(v))}
              style={{ display: "flex", gap: 18 }}
              aria-label="Tab size"
            >
              {TAB_SIZES.map((n) => (
                <label key={n} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <RadioGroupItem value={String(n)} />
                  {n} spaces
                </label>
              ))}
            </RadioGroup>
          </FormField>

          <FormField label="Word wrap" hint="Source and Diff modes — Rendered always wraps.">
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <Switch checked={wordWrap} onCheckedChange={setWordWrap} aria-label="Word wrap" />
              <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Wrap long lines</span>
            </label>
          </FormField>

          <FormField label="Default mode per file type" hint="Which segment a file of this type opens in.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {DEFAULT_MODE_KINDS.map(({ kind, label }) => {
                const value = readingViewDefaultMode[kind] ?? defaultModeFor(kind);
                return (
                  <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--color-fg)" }}>{label}</span>
                    <Select value={value} onValueChange={(v) => setReadingViewDefaultMode(kind, v as EditorMode)}>
                      <SelectTrigger size="sm" style={{ width: 118 }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rendered">Rendered</SelectItem>
                        <SelectItem value="source">Source</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

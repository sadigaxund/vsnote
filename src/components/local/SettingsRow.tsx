/**
 * SettingsRow / SettingsSection — a settings-form layout primitive
 * (docs/PLAN-2026-09-05-refresh.md §2, DESIGN-SPEC round 10). `my-you-eye`
 * has no settings-layout primitive (checked `skills/components.json`: no
 * `SettingsRow`/`SettingsSection`/settings-flavored `FormField` variant) —
 * this gap is already filed upstream as sadigaxund/my-you-eye#34; this
 * local component exists to unblock the Settings split in the meantime,
 * per CLAUDE.md rule 2's "missing component protocol" (do not re-file a
 * duplicate issue).
 *
 * `SettingsRow` replaces the per-row inline `FormField`/manual flex
 * markup every settings category used to hand-roll: label + description on
 * the left, the control on the right, wrapping to a stacked layout on a
 * narrow content column via plain flexbox wrap (no media/container query
 * needed — same "flex-wrap does the work" technique `Stepper.tsx` and
 * `SegmentedControl.tsx` already use for their own responsive behavior).
 * `controlWidth` drives field sizing BY TYPE (plan §2 item 3) from one
 * place instead of a per-call-site inline `style={{ width }}`:
 *   - "narrow" (~12rem) — numbers, short enums (Select/RadioGroup/number
 *     Input).
 *   - "text" (~24rem) — free text (Input, ColorField).
 *   - "full" (100%) — textareas, tables, multi-part panels, anything that
 *     needs the whole row's width.
 *
 * **Every control starts at the same left edge, category-wide** (design
 * review finding, 2026-09-06): the label column is a FIXED width, not a
 * flex-grow that eats whatever space a row's own control doesn't use — a
 * `"narrow"` row and a `"text"` row in the same category previously ended
 * up with their controls starting at two different x positions, because
 * the label column grew to fill the leftover space after each row's own
 * (different) control width. Pinning the label to one width means
 * `controlWidth` only changes how far a control EXTENDS to the right, never
 * where it starts.
 *
 * `SettingsSection` is the thin vertical-rhythm wrapper a settings
 * category's row list sits in — the same `gap: 20` stack every category
 * already used inline, named and centralized so a future spacing change is
 * one edit instead of seven.
 *
 * fix(settings) R5-3: the control column's flex item was missing TWO things
 * that together let a long piece of content inside it (Git & Sync's "Test
 * connection" result text) push the whole column onto its own line under
 * the label instead of wrapping its own text in place:
 *   1. `min-width: 0` — without it, a flex item's browser default
 *      (`min-width: auto`) never shrinks below its content's intrinsic
 *      width during the row's flexible-length resolution.
 *   2. `flex-basis: 0` instead of `auto` — this is the less obvious one.
 *      With `flexWrap: "wrap"` on the row (this component's own outer
 *      container), the browser decides which flex line an item belongs on
 *      using that item's max-content size when its flex-basis is `auto`,
 *      REGARDLESS of `min-width: 0` — `min-width` only bounds how far an
 *      item can shrink once it's already on a line, it does not affect
 *      that upfront "does it fit on this line" check. So `min-width: 0`
 *      alone was not enough: a control column with a long enough child
 *      still got wrapped onto its own line even though it had plenty of
 *      room to shrink into. `flex-basis: 0` (the shorthand's third value)
 *      makes that line-fitting check use 0 instead of max-content, so the
 *      control column always stays beside the label and only its own
 *      content wraps.
 *
 * Styled with the same token vocabulary + inline-style convention as this
 * folder's other local primitives (`Stepper.tsx`) rather than a fork of any
 * library part or a new CSS file.
 */
import type { CSSProperties, ReactNode } from "react";

export type SettingsControlWidth = "narrow" | "text" | "full";

const CONTROL_WIDTH: Record<SettingsControlWidth, string> = {
  narrow: "12rem",
  text: "24rem",
  full: "100%",
};

export interface SettingsRowProps {
  label: string;
  hint?: string;
  /** Field sizing intent (plan §2 item 3) — see this file's module doc.
   * Defaults to "text" (the common case: a single text Input). */
  controlWidth?: SettingsControlWidth;
  children: ReactNode;
  "data-testid"?: string;
  style?: CSSProperties;
}

/** Fixed label-column width — every row in every category shares this, so
 * every control's LEFT edge lines up down the page regardless of that
 * row's own `controlWidth`. */
const LABEL_WIDTH = "16rem";

export function SettingsRow({ label, hint, controlWidth = "text", children, style, ...rest }: SettingsRowProps) {
  const width = CONTROL_WIDTH[controlWidth];
  const full = controlWidth === "full";
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", alignItems: full ? "flex-start" : "center", gap: "8px 24px", ...style }}
      data-testid={rest["data-testid"]}
    >
      <div style={{ flex: `0 0 ${LABEL_WIDTH}`, minWidth: 180 }}>
        <div style={{ fontSize: 13, color: "var(--color-fg)" }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>{hint}</div>
        )}
      </div>
      <div
        style={{
          // fix(settings) R5-3: `flex-basis: auto` (the old value here) uses
          // the item's max-content size to decide whether it fits on the
          // CURRENT flex line when the container has `flexWrap: "wrap"` —
          // `min-width: 0` only bounds how far the item can shrink DURING
          // that line's flexible-length resolution, it does not change that
          // upfront max-content check, so a control column with enough long
          // content (e.g. Git & Sync's "Test connection" result text) still
          // got kicked onto its own line under the label even though there
          // was plenty of room for it to shrink into. `flex-basis: 0` (via
          // the shorthand's third value) makes the line-fitting check use 0
          // instead of max-content, so the control column always stays on
          // the label's line and only its own content wraps.
          flex: full ? "1 1 0%" : `0 0 ${width}`,
          width: full ? undefined : width,
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export interface SettingsSectionProps {
  children: ReactNode;
  "data-testid"?: string;
}

/** Vertical rhythm wrapper for one settings category's row list. */
export function SettingsSection({ children, ...rest }: SettingsSectionProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--settings-row-gap)" }} data-testid={rest["data-testid"]}>
      {children}
    </div>
  );
}

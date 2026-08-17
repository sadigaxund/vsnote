/**
 * SegmentedControl — compact single-choice segmented toggle. Two consumers:
 * `EditorHeader.tsx`'s Rendered/Source/Diff mode switch (icon + label), and
 * — DESIGN-SPEC Amendments item 13 — that same `EditorHeader`'s Diff-mode
 * unified/split layout toggle, rendered `iconOnly` (icon glyph only, each
 * segment's `label` becomes its `Tooltip` content instead of visible text)
 * so it reads as a compact secondary control next to the primary mode
 * switch rather than competing with it for width. "Same visual language"
 * per the spec: both instances share this one component/token set, not a
 * second hand-rolled control.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("SegmentedControl", status
 * `built-locally`, used in `src/components/EditorHeader.tsx`). The
 * library's `Tabs` (`variant="pills"`) is a content-switching nav bound to
 * `TabsContent` panels via Radix `Tabs.Root` — it doesn't support a
 * per-segment `disabled` state (DESIGN-SPEC's mode table disables segments
 * per file type), and using it as a bare value-toggle would be forcing a
 * navigation component to play a form-control role. Built as a real
 * `role="radiogroup"` control using the same tokens as the library's
 * `Button`/`Badge` active states, and — for `iconOnly` — the library's own
 * `Tooltip`.
 */
import type { ReactNode } from "react";
import { Tooltip } from "my-you-eye";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  /** `"xs"` (added Phase 8, DESIGN-SPEC Amendments round 3 item 18) — the
   * slim per-pane `EditorHeader`'s mode/diff-layout toggles, sized to fit
   * the new, visibly-shorter `--app-chrome-paneheader-h` band (20-28px
   * across the three density tiers) rather than `"sm"`'s 26px, which the
   * title bar's OWN mirrored copy of these same controls still uses (its
   * 40-46px band has plenty of room). */
  size?: "xs" | "sm" | "md";
  /** Renders each segment as icon-only (label text hidden, `label` becomes
   * the segment's `Tooltip` content instead) — the Diff layout toggle's
   * "compact icon-only" presentation, DESIGN-SPEC Amendments item 13. */
  iconOnly?: boolean;
  /** Round 7 item 55 — stretch to the container's width, segments sharing
   * it equally (the Publish dialog's delivery picker). Default keeps the
   * intrinsic inline-flex sizing every chrome usage relies on. */
  fullWidth?: boolean;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  iconOnly = false,
  fullWidth = false,
  "aria-label": ariaLabel = "Editor mode",
}: SegmentedControlProps<T>) {
  const height = size === "md" ? 32 : size === "sm" ? 26 : 18;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        alignItems: "stretch",
        gap: 2,
        padding: 2,
        borderRadius: "var(--radius-ui)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const button = (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? opt.label : undefined}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange?.(opt.value)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              flex: fullWidth ? 1 : undefined,
              height,
              width: iconOnly ? height : undefined,
              padding: iconOnly ? 0 : size === "xs" ? "0 7px" : "0 10px",
              fontSize: size === "xs" ? 10.5 : 12,
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              border: "none",
              borderRadius: "var(--radius-ui-sm)",
              cursor: opt.disabled ? "not-allowed" : "pointer",
              opacity: opt.disabled ? 0.4 : 1,
              background: active ? "color-mix(in oklab, var(--color-primary) 16%, transparent)" : "transparent",
              color: active ? "var(--color-primary)" : "var(--color-muted)",
              transition: "background 100ms ease, color 100ms ease",
            }}
          >
            {opt.icon}
            {!iconOnly && opt.label}
          </button>
        );
        return iconOnly ? (
          <Tooltip key={opt.value} content={opt.label} side="bottom">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

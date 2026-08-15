/**
 * SegmentedControl — compact single-choice segmented toggle (used for the
 * Rendered / Source / Diff editor mode switch).
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("SegmentedControl", status
 * `built-locally`, used in `src/components/EditorHeader.tsx`). The
 * library's `Tabs` (`variant="pills"`) is a content-switching nav bound to
 * `TabsContent` panels via Radix `Tabs.Root` — it doesn't support a
 * per-segment `disabled` state (DESIGN-SPEC's mode table disables segments
 * per file type), and using it as a bare value-toggle would be forcing a
 * navigation component to play a form-control role. Built as a real
 * `role="radiogroup"` control using the same tokens as the library's
 * `Button`/`Badge` active states.
 */
import type { ReactNode } from "react";

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
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: SegmentedControlProps<T>) {
  const height = size === "sm" ? 26 : 32;
  return (
    <div
      role="radiogroup"
      aria-label="Editor mode"
      style={{
        display: "inline-flex",
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
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange?.(opt.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height,
              padding: "0 10px",
              fontSize: 12,
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
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

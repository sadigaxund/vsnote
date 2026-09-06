/**
 * Stepper — a minimal step-progress header for a multi-step form (the
 * rebuilt Publish dialog, docs/PLAN-2026-09-05-refresh.md §4). `my-you-eye`
 * has no Stepper/Wizard primitive (checked `skills/components.json`, empty
 * result for both names) — this gap is ALREADY filed upstream as
 * sadigaxund/my-you-eye#35; this local component exists to unblock the
 * dialog rebuild in the meantime, per CLAUDE.md rule 2's "missing component
 * protocol" (do not re-file a duplicate issue).
 *
 * Deliberately thin: numbered dots + labels, a connecting rule, and a
 * "done" checkmark state for a completed step a user can still click back
 * to. No animation, no branching/skip logic — this dialog's steps are a
 * fixed linear sequence (Mode -> Who can open -> Protection -> Link ->
 * Result), which is all this component needs to express. Styled with the
 * same token vocabulary as `SegmentedControl.tsx` (this file's nearest
 * local-component sibling) rather than a fork of any library part.
 */
import { Check } from "lucide-react";

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Index of the current step. */
  current: number;
  /** A step before `current` is always "done" and clickable; a step is
   * additionally reachable (e.g. the Result step, once reached, remains
   * clickable to review) when its id is in this set. */
  onStepClick?: (index: number) => void;
}

export function Stepper({ steps, current, onStepClick }: StepperProps) {
  return (
    <div role="tablist" aria-label="Publish steps" style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 4 }} data-testid="publish-stepper">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        const clickable = state === "done" && !!onStepClick;
        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center", flex: index === steps.length - 1 ? "0 0 auto" : 1 }}>
            <button
              type="button"
              role="tab"
              aria-selected={state === "current"}
              aria-current={state === "current" ? "step" : undefined}
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(index)}
              data-testid={`publish-step-${step.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: clickable ? "pointer" : "default",
                color: state === "upcoming" ? "var(--color-muted)" : "var(--color-fg)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  flexShrink: 0,
                  background:
                    state === "current"
                      ? "var(--color-primary)"
                      : state === "done"
                        ? "color-mix(in oklab, var(--color-primary) 20%, transparent)"
                        : "var(--color-surface)",
                  color: state === "current" ? "var(--color-primary-fg, #05201f)" : state === "done" ? "var(--color-primary)" : "var(--color-muted)",
                  border: state === "upcoming" ? "1px solid var(--color-border)" : "none",
                }}
              >
                {state === "done" ? <Check size={12} /> : index + 1}
              </span>
              <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 8px",
                  background: state === "done" ? "var(--color-primary)" : "var(--color-border)",
                  opacity: state === "done" ? 0.6 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

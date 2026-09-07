/**
 * Stepper — a compact step-progress header for a multi-step form (the
 * Publish dialog, docs/PLAN-2026-09-05-refresh.md §4; Git & Sync's guided
 * card, round 5). `my-you-eye` has no Stepper/Wizard/Progress primitive
 * (checked `skills/components.json`, empty result for all three names) —
 * this gap is filed upstream as sadigaxund/my-you-eye#35 (a comment was
 * added describing this exact segmented-progress variant once it existed,
 * per CLAUDE.md rule 2); this local component exists to unblock both
 * dialogs in the meantime.
 *
 * fix(share) R5 (design-health, owner correction on the fix-1 result): the
 * original design was five numbered circles + connecting rules — at the
 * dialog's fixed 480px width, five steps' worth of circles+labels simply
 * did not fit ("step 5 is cut off, badge digits aren't centered"). Numbered
 * circles fundamentally don't scale down to a narrow fixed-width container
 * once there are more than ~3-4 steps; a segmented progress bar does,
 * because its per-step signal (a colored bar segment) has no minimum
 * content width the way a circle-plus-digit does. Now: ONE line of text
 * ("Step 2 of 5 · Who can open" — muted "Step n of N", then the current
 * step's own label) above a fixed-height multi-segment bar, one segment per
 * step, filled solid up to and including the current step. Each segment is
 * still the same interactive element the old circle was: `role="tab"`,
 * `aria-selected`, done steps clickable back — every existing
 * `data-testid="<prefix>-step-<id>"` / `aria-selected` assertion
 * (`tests/e2e/publish-dialog-steps.spec.ts`) keeps working unchanged, only
 * what's INSIDE that element changed (a bar segment, not a circle+label).
 */
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
  /** Accessible label for the `role="tablist"` — defaults to the Publish
   * dialog's original wording so that call site needs no change. */
  ariaLabel?: string;
  /** `data-testid` prefix — defaults to "publish" (the dialog this
   * component was built for) so every existing `publish-stepper`/
   * `publish-step-<id>` testid (`tests/e2e/publish-dialog-steps.spec.ts`)
   * is unchanged; a second call site (Git & Sync's guided card, round 5)
   * passes `"git-sync"` instead so its own testids don't collide with or
   * masquerade as the Publish dialog's. */
  testidPrefix?: string;
}

const SEGMENT_HEIGHT = 4;
const SEGMENT_GAP = 4;

export function Stepper({ steps, current, onStepClick, ariaLabel = "Publish steps", testidPrefix = "publish" }: StepperProps) {
  const currentStep = steps[current];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }} data-testid={`${testidPrefix}-stepper`}>
      <div style={{ fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--color-muted)" }}>
          Step {current + 1} of {steps.length}
        </span>
        {currentStep && (
          <>
            <span style={{ color: "var(--color-muted)" }}> · </span>
            <span style={{ color: "var(--color-fg)", fontWeight: 600 }}>{currentStep.label}</span>
          </>
        )}
      </div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        style={{ display: "flex", alignItems: "center", gap: SEGMENT_GAP, width: "100%" }}
      >
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "upcoming";
          const clickable = state === "done" && !!onStepClick;
          return (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={state === "current"}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={step.label}
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(index)}
              data-testid={`${testidPrefix}-step-${step.id}`}
              style={{
                flex: 1,
                minWidth: 0,
                height: SEGMENT_HEIGHT,
                padding: 0,
                border: "none",
                borderRadius: SEGMENT_HEIGHT / 2,
                background: state === "upcoming" ? "var(--color-border)" : "var(--color-primary)",
                opacity: state === "done" ? 0.55 : 1,
                cursor: clickable ? "pointer" : "default",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

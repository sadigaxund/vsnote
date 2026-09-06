/**
 * Pure logic for the stepped `PublishDialog` (docs/PLAN-2026-09-05-refresh.md
 * §4), split out of `PublishDialog.tsx` itself so the component file only
 * exports the component — the two remaining ESLint warnings in this repo
 * (`react-refresh/only-export-components`, both from this dialog exporting
 * non-component constants/helpers alongside the component) were cleared by
 * this split, not by suppressing the rule.
 */
import type { AuthMode, GeneralAccess, RenderMode, ShareOut } from "../../share/api";

/** `<input type="date">` value <-> epoch seconds (the backend's
 * `expires_at` unit — see `server/app/schemas.py`'s `ShareCreateIn.
 * expires_at`, consumed as `float` seconds throughout `policy.py`). Midday
 * UTC avoids a date rendered in a timezone west of UTC silently rolling
 * back a day. */
export function dateInputToEpochSeconds(value: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms / 1000;
}

export function epochSecondsToDateInput(epoch: number | null | undefined): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/**
 * The dialog's TWO concrete modes as one closed union: every caller-visible
 * decision switches on this discriminated kind. Derived ONCE from props;
 * `null` means "mounted without a usable target" (a closing-transition
 * frame) and renders an inert shell.
 */
export type PublishMode = { kind: "publish-file"; filePath: string; content: string } | { kind: "edit-file"; share: ShareOut };

export function derivePublishMode(props: { filePath?: string; content?: string; existingShare?: ShareOut }): PublishMode | null {
  const { filePath, content, existingShare } = props;
  if (existingShare) {
    return { kind: "edit-file", share: existingShare };
  }
  if (filePath && content !== undefined) {
    return { kind: "publish-file", filePath, content };
  }
  return null;
}

/** Per-kind chrome, keyed explicitly — a total map the compiler forces to
 * stay exhaustive rather than nested ternaries over two booleans. */
export const MODE_CHROME: Record<PublishMode["kind"], { title: string; verb: string }> = {
  "publish-file": { title: "Publish", verb: "Publish" },
  "edit-file": { title: "Edit share", verb: "Save" },
};

/** One-line "what a visitor gets" copy for step 1 (Mode). */
export const RENDER_MODE_DESCRIPTIONS: Record<RenderMode, string> = {
  rendered: "A clean reading page with the document rendered, no app chrome.",
  raw: "The file's bytes only, no page around them (curl-friendly).",
};

/** One-line copy for step 2 (Who can open). */
export const GENERAL_ACCESS_DESCRIPTIONS: Record<GeneralAccess, string> = {
  link: "Anyone with the link can open it.",
  restricted: "Only the people you list can open it, by signing in.",
};

/**
 * The server's auth matrix, mirrored EXACTLY client-side
 * (`server/app/routers/shares.py::_check_auth_matches_render_mode`): raw
 * shares accept `none`/`token` only (no UI to type a password that would
 * just be rejected); rendered shares accept all three. Step 3 (Protection)
 * filters its options through this so the dialog can never construct a
 * combination the server rejects.
 */
export function authModesFor(renderMode: RenderMode): AuthMode[] {
  return renderMode === "raw" ? ["none", "token"] : ["none", "password", "token"];
}

export const AUTH_MODE_LABELS: Record<AuthMode, string> = {
  none: "No credential",
  password: "Password",
  token: "Share token",
};

/** The five fixed steps, in order — see `Stepper.tsx`'s doc for why this is
 * a linear sequence, not a graph. */
export const STEP_IDS = ["mode", "access", "protection", "link", "result"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_LABELS: Record<StepId, string> = {
  mode: "Mode",
  access: "Who can open",
  protection: "Protection",
  link: "Link",
  result: "Result",
};

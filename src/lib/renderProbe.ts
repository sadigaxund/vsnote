/**
 * Opt-in render-count probe used to investigate/verify DESIGN-SPEC
 * Amendments item 16 (typing-latency bug): "a keystroke must be handled
 * inside CodeMirror without re-rendering the React shell" is a claim a
 * Playwright script can actually prove or disprove by counting how many
 * times a component's function body runs while typing, instead of
 * eyeballing jank.
 *
 * Inert by default (`window.__renderProbeEnabled` is undefined) so it costs
 * one property read + branch in every build, dev or production — a
 * profiling script opts in via `page.addInitScript(() =>
 * (window.__renderProbeEnabled = true))` *before* `page.goto`, so the flag
 * exists before React's first render. Kept permanent (not stripped after
 * this phase) since it's the cheapest possible regression guard against
 * this exact bug recurring — see ARCHITECTURE.md's Deviations entry for the
 * before/after counts this produced.
 */
declare global {
  interface Window {
    __renderProbeEnabled?: boolean;
    __renderCounts?: Record<string, number>;
  }
}

export function probeRender(name: string): void {
  if (typeof window === "undefined" || !window.__renderProbeEnabled) return;
  window.__renderCounts ??= {};
  window.__renderCounts[name] = (window.__renderCounts[name] ?? 0) + 1;
}

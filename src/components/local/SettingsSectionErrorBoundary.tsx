/**
 * SettingsSectionErrorBoundary — per-category render crash isolation for
 * the Settings view (R5-1). Same rationale and shape as `PaneErrorBoundary`
 * (`local/PaneErrorBoundary.tsx`): before this, a throw anywhere inside one
 * category's rows (e.g. Settings > Sharing's "Reader appearance" group)
 * had no boundary above it, so React unwound the ENTIRE tree with nothing
 * left to paint — the whole app going black, not just Settings. Checked
 * `skills/my-you-eye/components.json` first (per CLAUDE.md rule 2): the
 * library ships no error-boundary/error-state component (`Alert` is a
 * static message, not something with `getDerivedStateFromError`/
 * `componentDidCatch` hooks — those exist only on class components, which
 * `my-you-eye` has none of), so this is a genuinely missing piece, built
 * locally in the library's own visual language (`Alert variant="danger"`,
 * token spacing) — entry filed in `docs/COMPONENT-BACKLOG.md`.
 *
 * Class component by necessity — error boundaries have no hook equivalent.
 *
 * Scope: one boundary PER CATEGORY SECTION (`SettingsView.tsx` wraps each
 * `sections.map(...)` entry in one of these, keyed by category id), not one
 * boundary around the whole Settings view — a crash in, say, Sharing's
 * reader-appearance rows shows an inline card in Sharing's own slot while
 * Appearance/Editor/Storage/etc. keep rendering normally above and below
 * it, matching `PaneErrorBoundary`'s "one bad pane never poisons the
 * others" isolation model applied to Settings' own list of sections.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button } from "my-you-eye";

export interface SettingsSectionErrorBoundaryProps {
  /** The category's own display label (e.g. "Sharing") — named in the
   * card so a crash reads as "Sharing hit an error", not a generic blob
   * indistinguishable from any other section. */
  sectionLabel: string;
  children: ReactNode;
}

interface SettingsSectionErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

export class SettingsSectionErrorBoundary extends Component<SettingsSectionErrorBoundaryProps, SettingsSectionErrorBoundaryState> {
  state: SettingsSectionErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<SettingsSectionErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[VSNote] Settings section "${this.props.sectionLabel}" crashed:`, error, info.componentStack);
    // Intentionally no toast: the isolated card IS the visible symptom,
    // same discipline as PaneErrorBoundary.
  }

  private retry = (): void => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, attempt } = this.state;
    if (error) {
      return (
        <div role="alert" data-testid="settings-section-error" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Alert variant="danger" size="sm" title={`${this.props.sectionLabel} hit an error`}>
            This section couldn't render. The rest of Settings is unaffected.
          </Alert>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--color-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {error.message}
          </pre>
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={this.retry} data-testid="settings-section-error-retry">
              Reload settings
            </Button>
          </div>
        </div>
      );
    }
    // display:contents keeps the wrapper layout-neutral (matches
    // PaneErrorBoundary) while the attempt counter forces a genuinely new
    // child subtree on retry rather than reconciling the crashed fibers.
    return (
      <div key={attempt} style={{ display: "contents" }}>
        {this.props.children}
      </div>
    );
  }
}

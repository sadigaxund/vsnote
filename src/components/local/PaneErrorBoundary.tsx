/**
 * PaneErrorBoundary — per-pane render crash isolation (TODO §5.4, from
 * kursku `harder`'s resiliency checklist): a throwing pane shows a compact
 * inline card and every OTHER pane keeps working, instead of one bad render
 * unwinding the whole split grid.
 *
 * Class component by necessity — error boundaries have no hook equivalent.
 *
 * Remount semantics: EditorPane keys this boundary by the active tab path,
 * so switching tabs gives a fresh boundary (a wedge on one malformed file
 * never poisons the next), and "Reload pane" bumps an internal attempt that
 * keys the children wrapper — forcing React to build a genuinely new child
 * subtree rather than reconciling the crashed fibers.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert } from "my-you-eye";

export interface PaneErrorBoundaryProps {
  paneId: string;
  children: ReactNode;
}

interface PaneErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<PaneErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[VSNote] pane ${this.props.paneId} crashed:`, error, info.componentStack);
    // Intentionally no toast: the isolated card IS the visible symptom.
  }

  private reload = (): void => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, attempt } = this.state;
    if (error) {
      return (
        <div role="alert" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", height: "100%" }}>
          <Alert variant="danger" size="sm" data-testid={`pane-error-${this.props.paneId}`}>
            This pane hit an internal error and was isolated.
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
            <button
              type="button"
              onClick={this.reload}
              style={{
                font: "inherit",
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: "var(--radius-ui-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-fg)",
                cursor: "pointer",
              }}
            >
              Reload pane
            </button>
          </div>
        </div>
      );
    }
    // display:contents keeps the wrapper layout-neutral while still giving
    // the attempt counter a place to live as a remount-forcing key.
    return (
      <div key={attempt} style={{ display: "contents" }}>
        {this.props.children}
      </div>
    );
  }
}

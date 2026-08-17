/**
 * Phase 17's app-wide login gate (docs/IMPLEMENTATION-PLAN-V2.md's Phase 17
 * section: "App-wide LOGIN GATE: no session -> login screen (CF Access
 * still works in front). Required because every authenticated client syncs
 * the whole vault."). Rendered by `main.tsx` INSTEAD of `<App/>` when (and
 * only when) `GET /api/app-config` answered from a REACHABLE backend with
 * `login_required: true` and `whoami()` says the caller isn't already
 * authenticated — see that file's `resolveGate` for the exact contract,
 * including why an unreachable backend never reaches this component at all
 * (CLAUDE.md rule 3).
 *
 * Composition only, same "no new local primitive needed" reasoning
 * `SettingsView.tsx`'s own header doc gives — `Card`/`FormField`/`Input`/
 * `Button`/`Alert` from `my-you-eye`, restyled only via the existing theme
 * tokens every other surface in this app already uses. Authenticates
 * through the EXISTING `useShareStore.login()` (the same action Settings ->
 * Sharing's "Sign in" row already calls) — there is no second auth
 * implementation here, just a different screen that happens to call it.
 */
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, CardHeader, FormField, Input } from "my-you-eye";
import { Layout, Loader2 } from "lucide-react";
import { useShareStore, LOGIN_UNREACHABLE_MESSAGE } from "../share/useShareStore";

export interface LoginGateProps {
  /** Called the instant a login attempt succeeds — `main.tsx` swaps
   * straight into the shell with no reload (per the phase brief: "A
   * successful login flips straight into the shell with no reload"). */
  onAuthenticated: () => void;
}

/** The wordmark glyph — the exact gradient treatment `components/TitleBar.
 * tsx` uses for the title bar's own app-identity glyph, just bigger, so the
 * gate reads as unmistakably the same product as the shell it's standing in
 * front of. */
function Wordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 28 }}>
      <span
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 11,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, #7c6cf0))",
          color: "var(--color-primary-fg)",
        }}
      >
        <Layout size={24} strokeWidth={2.5} />
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: "var(--color-fg)", letterSpacing: "-0.01em" }}>
        VSNote
      </span>
    </div>
  );
}

export function LoginGate({ onAuthenticated }: LoginGateProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loggingIn = useShareStore((s) => s.loggingIn);
  const loginError = useShareStore((s) => s.loginError);
  const login = useShareStore((s) => s.login);

  // Round 6's own convention (SettingsView.tsx's "Backend connection" row):
  // `login()`'s catch branch sets this exact literal when the failure was a
  // network error rather than a real credential rejection, so this screen
  // can show a distinct "working offline" state with the same underlying
  // mechanism, no extra store field.
  const isUnreachable = loginError === LOGIN_UNREACHABLE_MESSAGE;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!username.trim() || !password || loggingIn) return;
    const ok = await login(username.trim(), password);
    if (ok) onAuthenticated();
  }

  return (
    <div
      data-testid="login-gate"
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-chrome-bg)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Round 7 item 49 — optical centering: the wordmark adds ~100px above
          the card, so plain flex centering parks the FORM 50px below true
          center and it reads as pushed down. The bottom margin lifts the
          whole group until the card (the visual anchor) sits at the eye
          line, slightly above true center; `min()` keeps short viewports
          from pushing the wordmark off the top. */}
      <div style={{ width: 340, marginBottom: "min(calc(6vh + 100px), 18vh)" }}>
        <Wordmark />
        <Card>
          <CardHeader>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg)" }}>Sign in</div>
            <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>This vault requires a session to sync.</div>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <FormField label="Username">
                <Input
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-label="Username"
                  data-testid="login-username"
                  autoComplete="username"
                />
              </FormField>
              <FormField label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="Password"
                  data-testid="login-password"
                  autoComplete="current-password"
                />
              </FormField>
              {loginError && (
                <Alert
                  variant={isUnreachable ? "warning" : "danger"}
                  title={isUnreachable ? "Working offline" : undefined}
                  size="sm"
                  data-testid="login-error"
                >
                  {isUnreachable ? "Can't reach the backend right now. Try again once it's back." : loginError}
                </Alert>
              )}
              <Button type="submit" disabled={loggingIn || !username.trim() || !password} data-testid="login-submit">
                {loggingIn ? <Loader2 size={13} className="animate-spin" /> : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

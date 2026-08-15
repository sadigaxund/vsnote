/**
 * ShareApp — the standalone `/share/<slug>` route (rendered-mode shares).
 * Mounted directly by `main.tsx` INSTEAD of `App.tsx` when
 * `window.location.pathname` starts with `/share/` — see that file's
 * routing doc for why this is a second, separate render root rather than a
 * branch inside the normal shell.
 *
 * Hard requirements this file exists to satisfy (`docs/IMPLEMENTATION-PLAN-V2.md`
 * Phase 10 + `docs/ROADMAP-SHARING-AUTH.md` §1's security posture):
 *
 * 1. **No shell chrome** — no activity bar, sidebar, tab bar, status bar.
 *    Just the rendered content, fullscreen.
 * 2. **No vault access whatsoever.** This file imports NOTHING from `fs/`,
 *    `git/`, `stores/useFsStore`, `stores/useBufferStore`,
 *    `stores/useTabsStore`, `stores/useGitStore`, OR EVEN
 *    `stores/useSettingsStore` — grep confirms it, and that's the actual
 *    guarantee (not a comment promising one). It only ever calls
 *    `share/api.ts`'s `getShareContentSameOrigin`/`postShareAuth`, both
 *    RELATIVE-url `fetch()` calls with no `baseUrl` parameter at all (see
 *    `api.ts`'s doc for why — a real cookie-scoping bug, not a style
 *    choice) — nothing here touches `localStorage` or IndexedDB.
 *    `main.tsx`'s routing split means the modules that DO touch IndexedDB
 *    (`fs/seed.ts`'s `ensureSeeded`, every zustand store under
 *    `stores/use{Fs,Buffer,Tabs,Git}Store.ts`) are never even imported on
 *    this code path — not just unused, structurally absent from this
 *    route's JS chunk (confirmed in this phase's manual verification: see
 *    the final report's network-tab check).
 * 3. **The no-existence-oracle contract** (`server/README.md`'s "Every deny
 *    reason is the SAME 404" section — read that before touching this
 *    file): every 404 from `GET /share/{id}` (JSON), for ANY reason
 *    (malformed slug, revoked, expired, restricted, password-required-but-
 *    no-session, wrong role), renders the exact same generic state. This
 *    component NEVER inspects `err.message`/any response body detail to
 *    decide what to show — only `err.status === 404` vs. anything else
 *    (a genuine network/reachability failure, a different class of problem
 *    with no oracle risk, gets its own distinct "can't reach the server"
 *    state — see `load()` below).
 * 4. **Rendered-mode sandbox** (roadmap §1's security bullet, Phase 10's to
 *    build): HTML content renders ONLY inside `renderers/HtmlPreview.tsx`'s
 *    existing `sandbox=""` `srcDoc` iframe (already built in Phase 4 for
 *    the local `.html` Rendered mode — reused verbatim here, not
 *    reimplemented). Markdown content renders through
 *    `editor/LivePreviewEditor.tsx`, the app's REAL markdown pipeline,
 *    read-only — see that component's module doc + `editor/livepreview/
 *    widgets.ts` for why raw HTML embedded in markdown source can never
 *    become live DOM there (no `HTMLBlock`/`HTMLTag` widget exists; CM6
 *    only ever creates plain-text-content `<input>`/`<span>` widgets for
 *    checkboxes and links). A `render_mode: "raw"` share reached here
 *    (shouldn't normally happen — raw links point at the backend's own
 *    origin, never through this app, see `share/shareLinks.ts`) falls back
 *    to an inert `<pre>` text block rather than guessing at markdown/HTML
 *    intent.
 *
 * CLAUDE.md rule 1 compliance: the password field/submit control and the
 * two error-state treatments are `my-you-eye`'s `Input`/`Button`/`Alert`/
 * `EmptyState`, styled purely by variant props + the app's root theme
 * tokens (rule 12 of `skills/SKILL.md` — "trust the theme," no hardcoded
 * colors on these), same composition pattern as `PublishDialog.tsx`/
 * `SharedPanel.tsx`. `ShareShell` (the full-viewport centered layout
 * wrapper below) stays a local, hand-rolled `<div>` — it's page-level
 * layout scaffolding (height/width/flex-centering/padding), not a
 * button/input/select/table/tree/menu/dialog the catalog has an
 * equivalent for (no "PageShell"/bare-heading primitive fits a chrome-free
 * centered auth screen; `PageShell` is for a titled page with actions,
 * over-elaborate here). Its `background: "#0e1015"` is a literal hex
 * rather than a `--color-*` token, matching the app's default ("dark")
 * theme value at the time of writing — a deliberate, narrow exception
 * (not itself a catalog-component violation) so this page's base canvas
 * doesn't shift if a *different* browser tab's Settings dialog changes the
 * persisted theme (`main.tsx`'s `applyDomSettings` runs unconditionally
 * before the route split, so it does reach `<html>` here too); the
 * foreground `my-you-eye` components layered on top still follow theme
 * tokens normally.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
// `my-you-eye` UI primitives (CLAUDE.md rule 1) — pure React/Tailwind, no
// app-state imports, so pulling these in doesn't touch this route's
// isolation guarantee (see this file's module doc, point 2): confirmed by
// grepping the built `/share/` chunk for `useFsStore`/`useBufferStore`/
// `useTabsStore`/`useGitStore`/`seed.ts` after this change (still absent).
import { Alert, Button, EmptyState, Input } from "my-you-eye";
import { HtmlPreview } from "../renderers/HtmlPreview";
import { LivePreviewEditor } from "../editor/LivePreviewEditor";
import { getShareContentSameOrigin, postShareAuth, ShareApiError, type ShareContentOut } from "./api";

export interface ShareAppProps {
  /** The `<slug>` (or custom alias) segment of `/share/<slug>` — parsed by
   * `main.tsx` from `window.location.pathname`, never trusted beyond being
   * passed straight through to `getShareContentSameOrigin`/`postShareAuth`
   * (both `encodeURIComponent` it before building a URL — see `api.ts`). */
  identifier: string;
}

type LoadState = "loading" | "content" | "unavailable" | "unreachable";

function fileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function ShareApp({ identifier }: ShareAppProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [content, setContent] = useState<ShareContentOut | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await getShareContentSameOrigin(identifier);
      setContent(data);
      setState("content");
    } catch (err) {
      // The ONLY branch this component is allowed to take on the error —
      // "was it a 404" vs. "did the request not even complete" — never
      // anything more specific than that. See this file's module doc.
      if (err instanceof ShareApiError && err.status === 404) {
        setState("unavailable");
      } else {
        setState("unreachable");
      }
    }
  }, [identifier]);

  // This IS the textbook case `useEffect` exists for — fetch on mount /
  // prop change, exactly per the React docs' own "Fetching data" example.
  // `react-hooks/set-state-in-effect` flags it anyway because `load`'s
  // FIRST statement is a synchronous `setState("loading")` (deliberate: the
  // loading state must appear immediately, not only after the `fetch`
  // microtask resolves) — the lint rule's static analysis sees through the
  // `useCallback` wrapper and treats that as "setState synchronously within
  // an effect." `SettingsView.tsx`'s persistence-status check dodges the
  // same rule with a `useMemo` "run once" trick, but that only works
  // because ITS setState call is inside a real `.then()` continuation
  // (async, not synchronous at call time) — `load`'s immediate
  // `setState("loading")` runs synchronously the instant it's called, so
  // the same trick just moves the violation into `useMemo` instead (tried;
  // still flagged, for the correct reason this time). Suppressed with a
  // justification rather than restructured further: deferring the
  // "loading" state behind a microtask purely to satisfy this lint rule
  // would be a worse tradeoff (a needless extra render before "Loading..."
  // even appears, for zero user-visible benefit).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: the synchronous `setState("loading")` is intentional, not a leaked side effect.
    void load();
  }, [load]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await postShareAuth(identifier, password);
      if (ok) {
        setPassword("");
        await load();
      } else {
        // Wrong password, non-password share, dead share, or nonexistent
        // slug — all indistinguishable, all the SAME generic state. Never
        // a "wrong password" message (see server/README.md).
        setState("unavailable");
      }
    } catch {
      setState("unreachable");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <ShareShell>
        <p style={{ color: "var(--color-muted, #8a8f98)" }}>Loading…</p>
      </ShareShell>
    );
  }

  if (state === "unreachable") {
    return (
      <ShareShell>
        <Alert variant="warning" size="lg" title="Can't reach the server" icon={<AlertTriangle size={20} aria-hidden />} style={{ maxWidth: 420 }}>
          The sharing backend didn't respond. Try again in a moment.
        </Alert>
      </ShareShell>
    );
  }

  if (state === "unavailable" || !content) {
    return (
      <ShareShell>
        {/* No `description`/`action` prop here — `data-testid` lands on
            EmptyState's root, and the password form is rendered as a
            SIBLING below rather than passed through `action`, so this
            testid's `textContent()` is exactly the title string (icon is
            an aria-hidden SVG, contributes none) and stays stable whether
            or not the form below is mid-submit — the e2e assertion in
            `tests/e2e/share-password.spec.ts` diffs this exact text across
            a wrong-password resubmit and requires it to be byte-identical
            (server/README.md's "same 404" contract). */}
        <EmptyState icon={<Lock size={28} aria-hidden />} title="This link is unavailable, or it requires a password." data-testid="share-unavailable-title" />
        <form onSubmit={(e) => void handlePasswordSubmit(e)} style={{ display: "flex", gap: 8 }} data-testid="share-password-form">
          <Input
            type="password"
            size="sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Share password"
            data-testid="share-password-input"
          />
          <Button type="submit" size="sm" loading={submitting} disabled={password.length === 0} data-testid="share-password-submit">
            Continue
          </Button>
        </form>
      </ShareShell>
    );
  }

  const ext = fileExtension(content.source_path);
  const isHtml = ext === "html" || ext === "htm";

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "#ffffff" }}>
      {content.render_mode !== "rendered" ? (
        // Defensive fallback only — raw-mode links point at the backend's
        // own origin and should never actually reach this component. Inert
        // plain text (React-escaped, no dangerouslySetInnerHTML) either way.
        <pre style={{ flex: 1, margin: 0, padding: 24, overflow: "auto", fontFamily: "monospace", fontSize: 13, color: "#111", whiteSpace: "pre-wrap" }}>
          {content.content_encoding === "base64" ? "(binary content)" : content.content}
        </pre>
      ) : isHtml ? (
        <HtmlPreview content={content.content_encoding === "base64" ? "" : content.content} />
      ) : (
        <LivePreviewEditor paneId="share" path={content.source_path} content={content.content_encoding === "base64" ? "" : content.content} readOnly />
      )}
    </div>
  );
}

function ShareShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        background: "#0e1015",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

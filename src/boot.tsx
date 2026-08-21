/**
 * Phase 17's app-wide login gate + the app route's own boot sequence,
 * split out of `main.tsx` so this file — and everything it pulls in
 * (`LoginGate.tsx`, `share/api.ts`'s `getAppConfig`/`whoami`, and `App.tsx`
 * itself behind its own further dynamic import) — is reached ONLY via the
 * ONE dynamic `import("./boot")` in `main.tsx`'s non-share branch. The
 * `/share/<slug>` route never downloads this file or anything it imports,
 * exactly like `App.tsx` was already excluded from it before this phase —
 * see `main.tsx`'s own header doc for why that separation is what makes
 * `share/ShareApp.tsx`'s "never touches vault storage" guarantee real.
 *
 * Gate semantics (BINDING — the deliberate resolution of the local-first
 * vs. login tension; see docs/IMPLEMENTATION-PLAN-V2.md's Phase 17 section
 * and `server/app/routers/app_config.py`'s doc for the server side):
 *
 *  - `login_required: true` from a REACHABLE backend AND no session
 *    (`whoami().authenticated === false`) -> render `<LoginGate/>` INSTEAD
 *    of the shell.
 *  - Backend unreachable (`getAppConfig()`/`whoami()` resolve `null` — see
 *    `share/api.ts`'s doc for exactly how, including the offline-safe
 *    service-worker fallback `vite.config.ts` installs specifically for
 *    this request) -> NEVER gate. This is CLAUDE.md rule 3, and
 *    `tests/e2e/probes.spec.ts`'s offline-cold-start probe depends on it.
 *  - `login_required: false` -> never gate.
 *  - A successful login flips straight into the shell with no reload —
 *    `onAuthenticated` below is a plain `setState`, not a
 *    `location.reload()`.
 *  - Cloudflare Access in front: `whoami()` already resolves authenticated
 *    before this ever runs (the CF-Access-authenticated request already
 *    carries a session by the time it reaches the browser), so the gate
 *    never appears — there is no CF-specific client code anywhere in this
 *    file, deliberately.
 *
 * Vault-seeding choice: the vault does NOT seed behind the gate. `App.tsx`'s
 * own boot effect (`ensureSeeded()` + the fs/git store refresh) only ever
 * runs once `<App/>` itself mounts, and `<App/>` only mounts once `Boot`
 * below has already decided the shell may render — a gated visitor who
 * never signs in triggers zero vault seeding/IndexedDB writes. This is
 * deliberate, not incidental: the gate exists because "every authenticated
 * client can sync the whole vault" is about SERVER access (the phase
 * brief's own framing), not about the LOCAL clone, but there is no reason
 * to spend local IndexedDB writes on a session that has not cleared the
 * gate yet — and it keeps `App.tsx` itself completely unaware this phase
 * exists (it needed zero changes here: same boot effect, same seed call,
 * whether or not a gate happened to run first).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Spinner, TooltipProvider, Toaster } from "my-you-eye";
import { getAppConfig, whoami } from "./share/api";
import { LoginGate } from "./components/LoginGate";

// `React.lazy`'s factory is called once and its promise cached internally —
// starting the import here (module-eval time, the instant `boot.tsx` itself
// is downloaded/evaluated) means the App chunk's network fetch overlaps
// with the gate's own `/api/app-config`(+`/api/auth/whoami`) round trip
// below, rather than waiting for the gate to resolve first. On the
// overwhelmingly common ungated path this costs nothing extra; on a gated
// path the fetch is simply wasted bandwidth for a visitor who may never
// pass the gate, which is an acceptable trade for not adding latency to
// the common case (see this module's "must not delay first paint" note in
// the phase brief).
const LazyApp = lazy(() => import("./App"));

/** Resolves whether the shell must be gated behind `<LoginGate/>` — see
 * this module's header doc for the full contract. `whoami()` (a second
 * round trip) is only called when `login_required` is actually `true`, so
 * the overwhelmingly common path — no login required, or the backend is
 * unreachable — costs exactly ONE request, keeping the gate's added
 * latency on the normal path to a minimum. */
async function resolveGate(): Promise<boolean> {
  const config = await getAppConfig();
  if (!config || !config.login_required) return false;
  const who = await whoami();
  return !(who?.authenticated ?? false);
}

/** Renders while the gate check is in flight — same near-black
 * `--app-chrome-bg` surface `App.tsx`'s own `!booted` overlay uses, so
 * there is no flash of a different background between this and whichever
 * of `<LoginGate/>`/the shell renders next. Deliberately the ONLY thing on
 * screen until `resolveGate()` settles: the shell must never flash before
 * the gate decision is in. */
function BootSplash() {
  return (
    <div
      aria-hidden
      style={{
        height: "100dvh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-chrome-bg)",
      }}
    >
      <Spinner size="lg" />
    </div>
  );
}

export function Boot() {
  // `null` = still checking (renders `<BootSplash/>`); `true`/`false` is
  // the resolved answer for this session. A successful login flips this
  // straight to `false` via `onAuthenticated` — no reload, no re-probe.
  const [gated, setGated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveGate().then((result) => {
      if (!cancelled) setGated(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gated === null) return <BootSplash />;
  if (gated) return <LoginGate onAuthenticated={() => setGated(false)} />;

  return (
    <TooltipProvider>
      {/* `Toaster` IS the toast context provider (`ToastContext.Provider`,
          confirmed in node_modules/my-you-eye/dist/index.js) as well as the
          viewport that renders active toasts — it must WRAP whatever calls
          `useToast()`, not sit as a sibling (Phase 5a's `App.tsx` is the
          first real `useToast` consumer; this wiring predates this file and
          simply moved here verbatim from `main.tsx`). */}
      <Toaster>
        <Suspense fallback={<BootSplash />}>
          <LazyApp />
        </Suspense>
      </Toaster>
    </TooltipProvider>
  );
}

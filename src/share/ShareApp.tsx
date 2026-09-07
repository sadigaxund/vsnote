/**
 * ShareApp — the `/share/<slug>` public reader (docs/PLAN-2026-09-05-
 * refresh.md §4.3 + the client half of §5), rebuilt CHROME-LESS: no
 * TitleBar, no tabs, no tree, no Rendered/Source toggle, no role badge, no
 * activity/status bar. A visitor gets the document and nothing else — this
 * route is a static reading page, not a shrunken copy of the app shell.
 *
 * Read-only by definition (docs/ROADMAP-SHARING-AUTH.md §1 / §4.3: "Editor
 * role (write-back) is dropped from the public reader"). The server still
 * implements `PUT /share/{id}` and resolves an "editor" role for the
 * owner's own future sync tooling (see docs/ARCHITECTURE.md's "Sharing
 * (Phase 10)" section, "Editor-role write-back" paragraph) — this file
 * simply never calls it and never renders anything that would let a
 * visitor type into the document.
 *
 * Hard requirements carried over, still binding:
 *
 * 1. **No VAULT access.** This route's chunk never imports `fs/`, `git/`,
 *    or any `stores/use*Store` module — nothing that opens the vault's
 *    IndexedDB or reads the visitor's local app settings. `main.tsx`'s
 *    boot-time route split (dynamic `import()`, share branch vs. app
 *    branch) is the actual mechanism behind this guarantee, not a promise
 *    kept by convention — see that file's doc.
 * 2. **The no-existence-oracle contract** (`server/README.md`): every deny
 *    is the same generic state, keyed ONLY off `err.status === 404` — never
 *    off a response detail. Unreachable (non-404) gets its own distinct
 *    state. The password field POSTs unconditionally; nothing here ever
 *    branches on response body/message content.
 * 3. **Rendered-mode sandbox**: HTML renders only inside
 *    `renderers/HtmlPreview.tsx`'s `sandbox=""` iframe; markdown through
 *    `markdown/render.tsx`'s static pipeline (raw HTML dropped, URLs
 *    sanitized — no live-preview CodeMirror instance on this route at all).
 * 4. **Its own light/dark**, independent of the app's `useSettingsStore`
 *    (never imported here): the `.share-reader` class in `src/theme.css`
 *    maps the markii `--mk-*`/`--color-*` tokens directly off
 *    `prefers-color-scheme`, ignoring `data-theme`/`.dark` entirely — see
 *    that file's "Public share reader" block.
 *
 * §5 additions: the content response's `links` map (vault-relative link
 * target -> target share's URL) is forwarded straight to `renderMarkdown`,
 * which rewrites resolvable links and degrades unresolved relative `.md`
 * links to muted "Not shared" text; `back_link`, when resolved, renders as
 * one plain text line above the document; `document.title` is set from the
 * document's first H1 after a successful load (client-side only — the
 * server's own `show_title` meta injection is a separate, narrower
 * mechanism, untouched by this file).
 *
 * R3-5 additions:
 * 5. **Selectable reading text.** `index.css`'s global chrome rule (`body {
 *    user-select: none }`, meant for the tree/tabs/bars/menus) was reaching
 *    this route too since `.share-reader` never opted back in the way
 *    `.cm-editor`/`[data-selectable-content]` do — visitors could not
 *    select or copy the document. `index.css`'s "Visitor reading
 *    preferences" block now sets `.share-reader { user-select: text }`;
 *    `CodeBlock`'s line-number gutter (`.mk-static-codeblock__lineno`)
 *    already carried its own `user-select: none` in `theme.css` before this
 *    change, so a code-copy selection still excludes the numbers.
 * 6. **Visitor reading preferences** (`readerPrefs.ts`,
 *    `ReaderPrefsPill.tsx`): theme / font size / code-wrap, persisted to
 *    the VISITOR's own `localStorage` (never the server, never the app's
 *    `vsnote-settings`) and applied only to this rendered document via
 *    `data-reader-theme`/`data-reader-fontsize`/`data-code-wrap` on
 *    `.share-reader`, set by `ReaderPage` below. Explicitly NOT the owner's
 *    editor "Rendered view" settings — those are per-owner and this route
 *    never reads `useSettingsStore` (requirement 1 above still holds).
 */
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, Button, EmptyState, Input } from "my-you-eye";
// `@markii/react/doc.css` — the 19 `--mk-*` tokens `.mk-doc` and its
// children (headings/paragraph/table/callout typography) are all styled
// from (see `src/theme.css`'s "Public share reader" block and
// `renderers/MarkiiPreview.tsx`'s doc comment: every real markii consumer,
// this route included, imports this stylesheet itself the first time it
// actually renders, rather than it living in `markdown/render.tsx` or the
// app's cold-boot bundle).
import "@markii/react/doc.css";
import { Logo } from "../components/local/Logo";
import { fetchOAuthProviders, oauthStartUrl } from "../share/oauth";
import { HtmlPreview } from "../renderers/HtmlPreview";
import { renderMarkdown } from "../markdown/render";
import { CodeBlock } from "../markdown/codeBlock";
import { inferFileKind } from "../lib/fileTree";
import { getShareContentSameOrigin, postShareAuth, ShareApiError, type ShareContentOut } from "./api";
import { ReaderPrefsPill } from "./ReaderPrefsPill";
import { useReaderPrefs, useResolvedReaderTheme } from "./readerPrefs";

export interface ShareAppProps {
  /** The `<slug>` (or custom alias) segment of `/share/<slug>` — parsed by
   * `main.tsx`, never trusted beyond being passed to the (encoding) api
   * helpers. */
  identifier: string;
}

type LoadState = "loading" | "content" | "unavailable" | "unreachable";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** First H1 of `markdown`, matching `server/app/linkmap.py::title_for`'s
 * rule verbatim (so a document's client-set `document.title` and its
 * server-computed back-link label agree). `null` when there is none. */
const H1_RE = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m;
function firstH1(markdown: string): string | null {
  const m = H1_RE.exec(markdown);
  return m ? m[1]!.trim() : null;
}

export function ShareApp({ identifier }: ShareAppProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState<ShareContentOut | null>(null);
  // OAuth capability probe (TODO §8.2): the button only renders when the
  // backend has Google credentials configured.
  const [oauthGoogle, setOauthGoogle] = useState(false);
  useEffect(() => {
    void fetchOAuthProviders().then((p) => setOauthGoogle(p.google));
  }, []);

  async function load() {
    setState("loading");
    try {
      const data = await getShareContentSameOrigin(identifier);
      setContent(data);
      setState("content");
      window.history.replaceState(null, "", `/share/${encodeURIComponent(identifier)}`);
    } catch (err) {
      // The ONLY branch allowed on error: 404 vs. didn't-complete. See the
      // module doc (no-existence-oracle contract).
      if (err instanceof ShareApiError && err.status === 404) {
        setState("unavailable");
      } else {
        setState("unreachable");
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the synchronous setState("loading") inside load() is intentional (immediate loading state).
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot-time fetch: `load`'s only meaningful dependency is `identifier`.
  }, [identifier]);

  // §5 item 6 — client-side `document.title` from the first H1, for EVERY
  // rendered share once content loads (not gated on the server's
  // `show_title` opt-in, which is a separate, narrower mechanism guarding
  // the SPA-shell meta injection on a cold navigation — this is purely the
  // already-loaded tab's own title, carries no posture change).
  useEffect(() => {
    if (!content) return;
    const name = baseName(content.source_path);
    const kind = inferFileKind(name);
    const isMarkdown = kind === "md" || kind === "mkmd";
    const heading = isMarkdown && content.content_encoding === "utf-8" ? firstH1(content.content) : null;
    document.title = heading ?? name;
  }, [content]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await postShareAuth(identifier, password);
      if (ok) {
        setPassword("");
        await load();
      } else {
        // Wrong password, dead share, nonexistent slug — indistinguishable
        // by design; the SAME generic state, never a "wrong password".
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
      <ReaderShell>
        <p style={{ color: "var(--color-muted)" }}>Loading…</p>
      </ReaderShell>
    );
  }

  if (state === "unreachable") {
    return (
      <ReaderShell>
        <Alert variant="warning" size="lg" title="Can't reach the server" icon={<AlertTriangle size={20} aria-hidden />} style={{ maxWidth: 420 }}>
          The sharing backend didn't respond. Try again in a moment.
        </Alert>
      </ReaderShell>
    );
  }

  if (state === "unavailable" || !content) {
    return (
      <ReaderShell>
        <div className="share-reader__card">
          <span className="share-reader__logo-chip">
            <Logo size={28} title="VSNote" />
          </span>
          {/* The password form is a SIBLING of the EmptyState (not its
              `action`) so this testid's textContent is exactly the title
              string — `share-password.spec.ts` requires it byte-identical
              across a wrong-password resubmit (server/README.md's "same
              404" contract). */}
          <EmptyState title="This link is unavailable, or it requires a password." data-testid="share-unavailable-title" />
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
          {oauthGoogle && (
            <a href={oauthStartUrl(location.pathname)} className="share-reader__oauth" data-testid="share-oauth-google">
              Continue with Google
            </a>
          )}
        </div>
      </ReaderShell>
    );
  }

  return <ReaderPage content={content} />;
}

/** The loaded document — dispatched by kind, no chrome, no editor.
 *
 * R3-5b: renders the one floating `ReaderPrefsPill` (theme / font size /
 * code wrap, `readerPrefs.ts`) and stamps its resolved values as
 * `data-reader-theme`/`data-reader-fontsize`/`data-code-wrap` on this root
 * `.share-reader` element — `index.css`'s "Visitor reading preferences"
 * block reads those attributes to override `.mk-doc`/`.mk-static-
 * codeblock` typography and (for an explicit light/dark choice) the
 * `.share-reader` palette `theme.css` otherwise derives purely from
 * `prefers-color-scheme`. `theme === "system"` intentionally omits
 * `data-reader-theme` so that CSS keeps doing the media-query-driven
 * default rather than this file duplicating it. Binary/HTML views ignore
 * these (a sandboxed iframe has no typography to resize; a "binary file"
 * empty state has no code to wrap), but the pill still renders for them —
 * it's a constant per-route affordance, not conditional on content kind. */
function ReaderPage({ content }: { content: ShareContentOut }) {
  const name = baseName(content.source_path);
  const kind = inferFileKind(name);
  const isMarkdown = kind === "md" || kind === "mkmd";
  const isBinary = content.content_encoding === "base64";
  const isHtml = !isBinary && kind === "html";
  const isCode = !isBinary && !isHtml && !isMarkdown;
  const wide = isHtml; // the sandboxed iframe fills the viewport; everything else reads in a column.
  const pageClassName = wide
    ? "share-reader__page share-reader__page--wide"
    : isCode
      ? "share-reader__page share-reader__page--code"
      : "share-reader__page";

  const [prefs, updatePrefs] = useReaderPrefs();
  const resolvedTheme = useResolvedReaderTheme(prefs.theme);

  return (
    <div
      className="share-reader"
      data-reader-theme={prefs.theme === "system" ? undefined : resolvedTheme}
      data-reader-fontsize={prefs.fontSize}
      data-code-wrap={prefs.codeWrap ? "on" : "off"}
    >
      <main id="share-main" className={pageClassName}>
        {content.back_link && (
          <a href={content.back_link.href} className="share-reader__backlink" data-testid="share-back-link">
            ← {content.back_link.label}
          </a>
        )}
        {isBinary ? (
          <EmptyState title="Binary file" description="This file has no text view." />
        ) : isHtml ? (
          <HtmlPreview content={content.content} />
        ) : isMarkdown ? (
          <div data-testid="share-content">{renderMarkdown(content.content, { links: content.links, codeWrap: prefs.codeWrap })}</div>
        ) : (
          <div className="share-reader__code-panel" data-testid="share-content">
            <CodeBlock code={content.content} kind={kind} path={name} filename={name} wrap={prefs.codeWrap} onWrapChange={(codeWrap) => updatePrefs({ codeWrap })} />
          </div>
        )}
      </main>
      <ReaderPrefsPill prefs={prefs} onChange={updatePrefs} />
    </div>
  );
}

/** Shared wrapper for every pre-content state (loading/unreachable/
 * password) — same `.share-reader` scoping class as the loaded page, so
 * these states get the same independent light/dark and Logo-carrying
 * centered layout instead of a bare unstyled screen. */
function ReaderShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="share-reader">
      <div className="share-reader__center">{children}</div>
    </div>
  );
}

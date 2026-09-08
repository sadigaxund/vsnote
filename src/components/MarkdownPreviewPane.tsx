/**
 * R3-11's side-by-side "Preview" pane — a second, READ-ONLY view of the
 * active `.md`/`.mk.md` tab, rendered by the SAME static pipeline the
 * public share reader and print/export already use (`src/markdown/
 * render.tsx`'s `renderMarkdown`), sitting to the right of the live source
 * editor. Exists because in-editor Rendered mode's Obsidian rule (raw
 * syntax revealed only around the caret, `directiveLezer/decorations.ts`)
 * means a directive you're actively typing never shows you what it will
 * look like until you move the caret away — this pane always shows the
 * fully-rendered document, with the caret's own position irrelevant to it.
 *
 * Per-tab, not a new file mode: `useTabsStore`'s `OpenTab.previewOpen`
 * (`EditorPane.tsx` renders this component only when that flag is set on
 * the active tab, and only for `md`/`mkmd` in Source/Rendered mode —
 * `filetypes/registry.ts` is untouched). "Closes when the source tab
 * closes" falls out of the flag living ON the tab (see that field's own
 * doc) — nothing here needs to react to a close event.
 *
 * ---- Debounce (~150ms) ----
 * `content` arrives on every keystroke (`EditorPane`'s existing
 * `activeBuffer?.content`); re-parsing + re-rendering the WHOLE document
 * through `renderMarkdown` on every single keystroke would be wasted work
 * for a pane whose entire point is "what does the finished document look
 * like," not "live per-character feedback" (that's Rendered mode's job).
 * `src/lib/debounce.ts`'s trailing-edge `debounce()` — plain
 * `setTimeout`/`clearTimeout`, no dependency — coalesces bursts of typing
 * into one re-render ~150ms after the user stops.
 *
 * ---- Scroll sync (proportional position) ----
 * "Scroll-synced by proportional position" (task brief) — NOT line/pixel
 * mapping, which has no meaning between raw source text and a rendered
 * `.mk-doc` tree with a totally different DOM shape. `src/markdown/
 * previewScrollSync.ts`'s `scrollFraction`/`scrollTopForFraction` do the
 * pure math; this component's job is just finding the two real scrollable
 * elements and wiring a bidirectional listener between them.
 *
 * The source side's actual scrollable element is CM6's own `.cm-scroller`,
 * generated deep inside `editor/CodeMirrorEditor.tsx` /
 * `editor/LivePreviewEditor.tsx` — both files are OFF LIMITS for this
 * change (a concurrent worker owns them), and neither exposes a scroll
 * ref/callback prop today. Rather than fork or wrap-override either editor
 * (CLAUDE.md rule 1's spirit, and the task's own "compose at the pane
 * level instead"), this component is handed a plain `sourceContainerRef` —
 * the DOM node `EditorPane.tsx` (which DOES own its own render tree) wraps
 * around whichever editor is mounted — and finds `.cm-scroller` inside it
 * with a short `requestAnimationFrame` poll (CM6 mounts lazily via
 * `React.lazy`/`Suspense`, so the scroller may not exist yet on this
 * component's first paint). A `syncingRef` guard prevents the mirrored
 * `scrollTop` write on either side from re-triggering the other side's own
 * scroll listener and ping-ponging forever.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import "@markii/react/doc.css";
import { renderMarkdown } from "../markdown/render";
import { debounce } from "../lib/debounce";
import { scrollFraction, scrollTopForFraction } from "../markdown/previewScrollSync";
import { packsForPreview } from "../markdown/previewPacksLogic";
import { useMarkiiStore, selectEnabledPacks } from "../stores/useMarkiiStore";
import { useMarkiiExtensionSettingsStore } from "../stores/useMarkiiExtensionSettingsStore";

/** ~150ms per the task brief — fast enough to feel live, slow enough that a
 * fast typist's keystrokes never each pay for a full re-parse/re-render. */
const PREVIEW_DEBOUNCE_MS = 150;

/** How long to keep polling for `.cm-scroller` to appear inside
 * `sourceContainerRef` before giving up — generous for a lazily-mounted,
 * `Suspense`-gated editor on a slow device; scroll sync simply doesn't
 * activate if it never appears (the preview pane itself still renders and
 * scrolls fine on its own either way). */
const SCROLLER_POLL_ATTEMPTS = 60; // ~1s at one attempt per animation frame.

export interface MarkdownPreviewPaneProps {
  path: string;
  name: string;
  content: string;
  /** The element `EditorPane.tsx` wraps around the live source editor for
   * this same tab — see this file's module doc for why a ref, not a direct
   * scroll-position prop. */
  sourceContainerRef: RefObject<HTMLElement | null>;
}

function findScroller(container: HTMLElement | null): HTMLElement | null {
  if (!container) return null;
  return container.querySelector<HTMLElement>(".cm-scroller");
}

export function MarkdownPreviewPane({ path, name, content, sourceContainerRef }: MarkdownPreviewPaneProps) {
  // `EditorPane.tsx` mounts this component with `key={activeTab.path}` —
  // switching tabs is a full remount, so this initializer alone (not an
  // effect keyed on `path`) is what makes a newly-switched-to tab show its
  // OWN content immediately rather than the previous tab's stale text
  // waiting out a debounce window.
  const [debouncedContent, setDebouncedContent] = useState(content);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);
  const enabledPacks = useMarkiiStore(useShallow(selectEnabledPacks));
  // R5-9b — "Hide script blocks" / "Render components in the Preview pane"
  // (Extensions page, Rendering section). See `render.tsx`'s
  // `hideScriptBlocks` doc and `previewPacksLogic.ts`'s `packsForPreview`
  // doc for exactly what each one changes.
  const hideScriptBlocks = useMarkiiExtensionSettingsStore((s) => s.hideScriptBlocks);
  const renderComponentsInPreview = useMarkiiExtensionSettingsStore((s) => s.renderComponentsInPreview);

  // Re-created only when the debounce DELAY changes (never, today) — a
  // stable function across re-renders so a pending timer from the previous
  // render is the one `cancel()` below actually reaches.
  const scheduleContentUpdate = useMemo(() => debounce((value: string) => setDebouncedContent(value), PREVIEW_DEBOUNCE_MS), []);

  useEffect(() => {
    scheduleContentUpdate(content);
    return () => scheduleContentUpdate.cancel();
  }, [content, scheduleContentUpdate]);

  useEffect(() => {
    let rafId: number | undefined;
    let attempts = 0;
    let scroller: HTMLElement | null = null;
    let previewEl: HTMLElement | null = null;

    const onSourceScroll = () => {
      if (syncingRef.current || !scroller || !previewEl) return;
      syncingRef.current = true;
      const fraction = scrollFraction({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
      previewEl.scrollTop = scrollTopForFraction(fraction, {
        scrollHeight: previewEl.scrollHeight,
        clientHeight: previewEl.clientHeight,
      });
      syncingRef.current = false;
    };

    const onPreviewScroll = () => {
      if (syncingRef.current || !scroller || !previewEl) return;
      syncingRef.current = true;
      const fraction = scrollFraction({
        scrollTop: previewEl.scrollTop,
        scrollHeight: previewEl.scrollHeight,
        clientHeight: previewEl.clientHeight,
      });
      scroller.scrollTop = scrollTopForFraction(fraction, {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
      syncingRef.current = false;
    };

    const tryAttach = () => {
      scroller = findScroller(sourceContainerRef.current);
      previewEl = previewScrollRef.current;
      if (!scroller || !previewEl) {
        attempts += 1;
        if (attempts < SCROLLER_POLL_ATTEMPTS) rafId = requestAnimationFrame(tryAttach);
        return;
      }
      scroller.addEventListener("scroll", onSourceScroll, { passive: true });
      previewEl.addEventListener("scroll", onPreviewScroll, { passive: true });
    };
    tryAttach();

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      scroller?.removeEventListener("scroll", onSourceScroll);
      previewEl?.removeEventListener("scroll", onPreviewScroll);
    };
  }, [path, sourceContainerRef]);

  return (
    <div
      data-testid="markdown-preview-pane"
      style={{
        flex: "0 0 45%",
        minWidth: 240,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderLeft: "1px solid var(--app-chrome-border)",
        background: "var(--app-editor-bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: "var(--app-chrome-paneheader-h)",
          padding: "0 12px",
          borderBottom: "1px solid var(--app-chrome-border)",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--color-muted)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "var(--color-fg)" }}>Preview</span>
        <span>·</span>
        <span>{name}</span>
      </div>
      <div
        ref={previewScrollRef}
        data-testid="markdown-preview-scroll"
        style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px" }}
      >
        {renderMarkdown(debouncedContent, {
          degradeUnresolvedRelativeLinks: false,
          enabledPacks: packsForPreview(renderComponentsInPreview, enabledPacks),
          hideScriptBlocks,
        })}
      </div>
    </div>
  );
}

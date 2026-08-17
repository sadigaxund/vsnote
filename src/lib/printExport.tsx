/**
 * DESIGN-SPEC item 38's "Export as PDF": renders a `.md` file's Rendered
 * view into a print-clean layout (no app chrome, sensible margins, light
 * background, syntax-highlighted code) and invokes the browser's own print
 * dialog — browser print-to-PDF is the engine, no server call, no new npm
 * dependency.
 *
 * Deliberately does NOT reuse `editor/LivePreviewEditor.tsx` (the app's real
 * CM6 Rendered view) for the print DOM: that view is a virtualized, scrolled
 * CM6 viewport built for on-screen EDITING, not print pagination — printing
 * its live scroller risks exactly the "one giant scrollable page, or clipped
 * content" failure item 38's exit bar explicitly warns about. Instead this
 * renders a SEPARATE, static React tree (a second `createRoot`, mounted into
 * its own plain `<div>` appended to `document.body`, outside the app's own
 * root) via `printDocument.tsx`'s `PrintDocument` — split into its own file
 * purely so THIS module's only export (`exportMarkdownAsPdf`, a plain
 * function) doesn't trip `react-refresh/only-export-components` by sharing a
 * file with component declarations. See `printDocument.tsx`'s own doc for
 * the block-parser/library-primitive reasoning.
 *
 * Pagination is a CSS property, not a JS one: nothing here constrains the
 * print root's height or sets `overflow`, so the browser's own print engine
 * paginates it exactly like a plain flowing document — the `break-inside:
 * avoid` rules on code blocks/tables/blockquotes below are pagination HINTS
 * (skip a bad mid-block page cut when the block fits on one page) not hard
 * clips; a block taller than one page still prints in full, just split
 * across pages, so nothing is ever silently cut off.
 */
import { createRoot, type Root } from "react-dom/client";
import { PrintDocument } from "./printDocument";

const PRINT_ROOT_ID = "vsnote-print-root";
const PRINT_STYLE_ID = "vsnote-print-style";

/** Light-theme token overrides, scoped to the print root only (never
 * touching `document.documentElement`) — item 38 requires a light print
 * background regardless of the app's current theme, and every
 * `my-you-eye`/local component used by `printDocument.tsx` reads color
 * through these CSS custom properties (Tailwind's `bg-bg`/`text-fg`/
 * `text-code-fg`/`.hl-*` classes all resolve `var(--color-*)`), so
 * overriding them here is a real "restyle via CSS variables at the root"
 * (CLAUDE.md rule 1) — just rooted at this print container instead of
 * `:root`, since the whole point is to diverge from whatever theme is
 * currently active on screen. */
const PRINT_TOKEN_OVERRIDES: Record<string, string> = {
  "--color-bg": "#ffffff",
  "--color-fg": "#18181b",
  "--color-muted": "#5b6472",
  "--color-border": "#d8dbe0",
  "--color-code-bg": "#f4f5f7",
  "--color-code-fg": "#18181b",
  "--color-code-muted": "#8a8f98",
  "--color-primary": "#0f6f7a",
  "--color-secondary": "#eef0f3",
  "--color-secondary-fg": "#18181b",
  "--color-success": "#1a7f4b",
  "--color-warning": "#8a5a00",
  "--color-danger": "#a3242f",
};

function ensurePrintStyle(): void {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
#${PRINT_ROOT_ID} { display: none; }
@media print {
  #root { display: none !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; }
  @page { margin: 0.75in; }
}
#${PRINT_ROOT_ID} .print-doc { font-family: var(--font-sans, sans-serif); max-width: 7.5in; margin: 0 auto; line-height: 1.55; }
#${PRINT_ROOT_ID} .print-doc-title { font-size: 1.6em; margin: 0 0 0.6em; }
#${PRINT_ROOT_ID} h1, #${PRINT_ROOT_ID} h2, #${PRINT_ROOT_ID} h3,
#${PRINT_ROOT_ID} h4, #${PRINT_ROOT_ID} h5, #${PRINT_ROOT_ID} h6 { break-after: avoid-page; margin: 1.1em 0 0.4em; font-weight: 600; line-height: 1.25; }
/* Tailwind's preflight resets every heading to \`font-size: inherit\`, so
   without these the exported PDF renders h1 through h6 at body size and the
   document loses its entire visual hierarchy (caught in print-output review:
   an h1 and an h6 were indistinguishable). Sizes are ems so they track the
   print root's own font size rather than the app's. */
#${PRINT_ROOT_ID} .print-doc h1 { font-size: 1.75em; }
#${PRINT_ROOT_ID} .print-doc h2 { font-size: 1.4em; }
#${PRINT_ROOT_ID} .print-doc h3 { font-size: 1.2em; }
#${PRINT_ROOT_ID} .print-doc h4 { font-size: 1.05em; }
#${PRINT_ROOT_ID} .print-doc h5 { font-size: 0.95em; }
#${PRINT_ROOT_ID} .print-doc h6 { font-size: 0.9em; opacity: 0.85; }
#${PRINT_ROOT_ID} p { margin: 0.6em 0; }
#${PRINT_ROOT_ID} pre, #${PRINT_ROOT_ID} table, #${PRINT_ROOT_ID} blockquote { break-inside: avoid-page; }
#${PRINT_ROOT_ID} .print-ul, #${PRINT_ROOT_ID} .print-ol { margin: 0.4em 0; padding-left: 1.4em; }
#${PRINT_ROOT_ID} .print-ul { list-style: disc outside; }
#${PRINT_ROOT_ID} .print-ol { list-style: decimal outside; }
#${PRINT_ROOT_ID} .print-ul .print-ul, #${PRINT_ROOT_ID} .print-ol .print-ul { list-style-type: circle; }
#${PRINT_ROOT_ID} li { display: list-item; margin: 0.15em 0; }
#${PRINT_ROOT_ID} .print-task { list-style: none; margin-left: -1.4em; display: flex; gap: 0.4em; align-items: baseline; }
#${PRINT_ROOT_ID} blockquote { border-left: 3px solid var(--color-border); padding: 0.1em 0 0.1em 0.8em; color: var(--color-muted); margin: 0.5em 0; }
#${PRINT_ROOT_ID} hr { border: none; border-top: 1px solid var(--color-border); margin: 1.2em 0; }
#${PRINT_ROOT_ID} .print-image-note { font-style: italic; color: var(--color-muted); }
#${PRINT_ROOT_ID} table { width: 100%; border-collapse: collapse; }
`;
  document.head.appendChild(style);
}

let activePrintRoot: { container: HTMLElement; root: Root; previousTitle: string } | null = null;

function teardownPrintRoot(): void {
  if (!activePrintRoot) return;
  const { container, root, previousTitle } = activePrintRoot;
  activePrintRoot = null;
  root.unmount();
  container.remove();
  document.title = previousTitle;
  window.removeEventListener("afterprint", teardownPrintRoot);
}

/** Renders `content` (a `.md` file's raw text) into a hidden print-only DOM
 * tree and opens the browser's print dialog. Synchronous except for one
 * `requestAnimationFrame` before `window.print()`, so the freshly mounted
 * tree has a committed layout before the browser paginates it. */
export function exportMarkdownAsPdf(fileName: string, content: string): void {
  teardownPrintRoot(); // a stray previous export never got its 'afterprint' (e.g. dev hot-reload) — start clean
  ensurePrintStyle();
  const container = document.createElement("div");
  container.id = PRINT_ROOT_ID;
  Object.entries(PRINT_TOKEN_OVERRIDES).forEach(([k, v]) => container.style.setProperty(k, v));
  container.style.background = "#ffffff";
  container.style.color = "#18181b";
  document.body.appendChild(container);
  const root = createRoot(container);
  const previousTitle = document.title;
  // Most browsers seed the print dialog's "save as" filename from
  // `document.title` — setting it to the note's own name for the duration
  // of the print means "Save as PDF" defaults to `notes.pdf`, not `VSNote.pdf`.
  document.title = fileName;
  activePrintRoot = { container, root, previousTitle };
  root.render(<PrintDocument title={fileName} content={content} />);
  window.addEventListener("afterprint", teardownPrintRoot);
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

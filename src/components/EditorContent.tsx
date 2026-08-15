/**
 * Static rendered-markdown placeholder for `architecture.md`, matching
 * app-preview.png's typography (DESIGN-SPEC "Rendered markdown typography").
 *
 * This is deliberately NOT routed through the library's `Markdown` display
 * component: `Markdown` has no accent-colored H2 (every heading level
 * renders `text-fg`, hardcoded per level with no token/variant hook), no
 * blockquote block type at all (a `>` line falls through to a plain
 * paragraph), and its inline `<code>` renders a `bg-secondary` chip with a
 * border rather than the bare colored-mono-text treatment app-preview.png
 * actually uses (no chip, no border, fenced blocks flush on the page
 * background) — gaps in the component itself, not something a theme
 * override can reach. It's also explicitly
 * throwaway: IMPLEMENTATION-PLAN.md Phase 1 calls this content "a static
 * placeholder... Phase 4 replaces it with the live-preview editor" (a CM6
 * decoration plugin, not a second markdown-to-HTML renderer), so building
 * a reusable component around today's fixed content wouldn't inform that
 * real architecture. This is content typography, not a UI control — see
 * CLAUDE.md rule 1's scope (buttons/inputs/selects/tables/trees/menus).
 */
import { ScrollArea } from "my-you-eye";

export function EditorContent() {
  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      <div
        style={{
          maxWidth: "54ch",
          margin: "0 auto",
          padding: "56px 32px 120px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--color-fg)",
            margin: "0 0 20px",
            letterSpacing: "-0.01em",
          }}
        >
          Indexing architecture
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", margin: "0 0 24px" }}>
          The vault indexer walks the file graph and emits a sparse adjacency list. See{" "}
          <a href="#indexer.ts" style={{ color: "var(--color-primary)", textDecoration: "underline" }}>
            indexer.ts
          </a>{" "}
          for the walker.
        </p>

        <h2
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: "var(--color-primary)",
            margin: "0 0 14px",
          }}
        >
          Constraints
        </h2>

        <ul style={{ margin: "0 0 24px", padding: 0, listStyle: "none" }}>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", marginBottom: 4 }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>
              Cold index of 50k notes under{" "}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 15,
                  color: "var(--markdown-code-color)",
                }}
              >
                900ms
              </code>
            </span>
          </li>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)", marginBottom: 4 }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>
              Incremental updates are <strong style={{ color: "var(--color-fg)", fontWeight: 700 }}>append-only</strong>
            </span>
          </li>
          <li style={{ display: "flex", gap: 8, fontSize: 17, lineHeight: 1.8, color: "var(--markdown-body)" }}>
            <span aria-hidden style={{ color: "var(--color-primary)" }}>•</span>
            <span>No blocking work on the render thread</span>
          </li>
        </ul>

        <blockquote
          style={{
            margin: "0 0 24px",
            padding: "2px 0 2px 16px",
            borderLeft: "3px solid var(--color-primary)",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--color-muted)",
          }}
        >
          Treat the index as a cache. Never as truth.
        </blockquote>

        <h2
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: "var(--color-primary)",
            margin: "0 0 14px",
          }}
        >
          Pipeline
        </h2>

        <pre
          style={{
            margin: 0,
            padding: "16px 0",
            background: "var(--app-editor-bg)",
            overflowX: "auto",
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              color: "var(--markdown-code-color)",
              whiteSpace: "pre",
            }}
          >
            walk(root) → parse() → link() → commit()
          </code>
        </pre>
      </div>
    </ScrollArea>
  );
}

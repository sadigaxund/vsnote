/**
 * Search activity view (the magnifier in the activity rail) — DESIGN-SPEC
 * "Misc / settings": "full-text across vault with result list → opens at
 * line". Composition over the library's `Input`/`ScrollArea`/`EmptyState`
 * plus the local `FileIcon`/`SidebarContainer`; the actual search walk is
 * `lib/vaultSearch.ts`.
 *
 * Renders inside the shared `local/SidebarContainer` region shell — the
 * SAME persisted width/collapsed state `Sidebar.tsx`'s Explorer panel uses
 * (DESIGN-SPEC Amendments round 3 item 20's course-correction: this used to
 * hardcode its own frozen `width: 288` with no resize/collapse affordance
 * at all, so switching from a resized Explorer to Search visibly snapped
 * the layout back to 288px — now it's genuinely the same region, just
 * showing different content). `React.lazy`-loaded from `App.tsx` (only
 * mounted once the Search rail icon is actually clicked) — keeps the
 * vault-walk/highlight logic out of the cold-boot bundle per
 * IMPLEMENTATION-PLAN.md Phase 5's bundle discipline note.
 */
import { useEffect, useState } from "react";
import { EmptyState, Input, ScrollArea, Spinner } from "my-you-eye";
import { Search as SearchIcon } from "lucide-react";
import { FileIcon } from "./local/FileIcon";
import { SidebarContainer } from "./local/SidebarContainer";
import { searchVault, type SearchFileResult } from "../lib/vaultSearch";

export interface SearchPanelProps {
  onOpenResult: (path: string, line: number) => void;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

const DEBOUNCE_MS = 200;

export function SearchPanel({ onOpenResult, width, onWidthChange, collapsed, onCollapsedChange }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [loading, setLoading] = useState(false);

  const trimmedQuery = query.trim();

  // `loading` flips true here, in the input's own change handler (an event
  // handler, not an effect) — not synchronously inside the debounce effect
  // below, which the `react-hooks/set-state-in-effect` rule flags even for
  // an unconditional call at the top of the body ("calling setState
  // directly within an effect" — effects should synchronize with external
  // systems or setState from a callback, not run state transitions of
  // their own). The effect's only synchronous-body work is scheduling/
  // cancelling the debounce timer; both `setResults`/`setLoading(false)`
  // happen inside the async `.then()` callback, which the rule allows.
  function handleQueryChange(value: string): void {
    setQuery(value);
    setLoading(!!value.trim());
  }

  useEffect(() => {
    if (!trimmedQuery) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchVault(trimmedQuery).then((found) => {
        if (!cancelled) {
          setResults(found);
          setLoading(false);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <SidebarContainer
      testId="search-panel"
      label="SEARCH"
      width={width}
      onWidthChange={onWidthChange}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
    >
      <div style={{ padding: "0 10px 8px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <SearchIcon
            size={13}
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-muted)",
              pointerEvents: "none",
            }}
          />
          <Input
            size="sm"
            placeholder="Search across vault"
            aria-label="Search across vault"
            value={query}
            autoFocus
            onChange={(e) => handleQueryChange(e.target.value)}
            style={{ paddingLeft: 26, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>
        {trimmedQuery && !loading && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>
            {totalMatches} result{totalMatches === 1 ? "" : "s"} in {results.length} file{results.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1" style={{ minHeight: 0 }}>
        {/* `loading` can only be true while `trimmedQuery` is non-empty (the
            effect above never sets it otherwise), but gate on both anyway —
            clearing the box while a debounced search is still in flight
            cancels that search without a chance to reset `loading` itself
            (its cleanup only flips a local `cancelled` flag), so relying on
            `loading` alone could otherwise strand a spinner over what
            should immediately read as the empty "Search your vault" state. */}
        {loading && trimmedQuery ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spinner size="sm" />
          </div>
        ) : !trimmedQuery ? (
          <div style={{ padding: "24px 16px" }}>
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="Search your vault"
              description="Full-text search across every note and file. Results are grouped by file — click a line to jump to it."
            />
          </div>
        ) : results.length === 0 ? (
          <div style={{ padding: "24px 16px" }}>
            <EmptyState icon={<SearchIcon size={22} />} title="No results" description={`Nothing matches "${trimmedQuery}".`} />
          </div>
        ) : (
          <div style={{ paddingBottom: 12 }}>
            {results.map((result) => (
              <FileResultGroup key={result.path} result={result} query={trimmedQuery} onOpenResult={onOpenResult} />
            ))}
          </div>
        )}
      </ScrollArea>
    </SidebarContainer>
  );
}

function FileResultGroup({
  result,
  query,
  onOpenResult,
}: {
  result: SearchFileResult;
  query: string;
  onOpenResult: (path: string, line: number) => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px 2px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <FileIcon kind={result.kind} name={result.name} size={13} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--color-fg)",
          }}
          title={result.path}
        >
          {result.name}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>
          {result.matches.length}
        </span>
      </div>
      {result.matches.map((match) => (
        <button
          key={`${result.path}:${match.line}:${match.column}`}
          type="button"
          onClick={() => onOpenResult(result.path, match.line)}
          title={`${result.path}:${match.line}`}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            width: "100%",
            minHeight: 22,
            padding: "2px 10px 2px 28px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <span style={{ flexShrink: 0, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--color-muted)", minWidth: 22, textAlign: "right" }}>
            {match.line}
          </span>
          <HighlightedLine text={match.text} query={query} />
        </button>
      ))}
    </div>
  );
}

function HighlightedLine({ text, query }: { text: string; query: string }) {
  const trimmed = text.trim();
  const idx = trimmed.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return (
      <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {trimmed}
      </span>
    );
  }
  const before = trimmed.slice(0, idx);
  const hit = trimmed.slice(idx, idx + query.length);
  const after = trimmed.slice(idx + query.length);
  return (
    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {before}
      <mark
        style={{
          background: "color-mix(in oklab, var(--color-primary) 35%, transparent)",
          color: "var(--color-fg)",
          borderRadius: 2,
        }}
      >
        {hit}
      </mark>
      {after}
    </span>
  );
}

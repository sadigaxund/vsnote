/**
 * `.csv` Rendered mode — DESIGN-SPEC Modes table: "DataTable" with a header
 * row. Uses the library's `DataTable` (never a hand-rolled `<table>`, per
 * CLAUDE.md rule 1) — this module only wires `csvLogic.ts`'s pure parsing/
 * capping into the component; see that file for the parsing approach, the
 * column-type-inference rules, and the item 33 big-file-safety numbers.
 */
import { useMemo, useState } from "react";
import { Button, DataTable, EmptyState, ScrollArea, type DataTableColumn } from "my-you-eye";
import { Table2 } from "lucide-react";
import { capRows, inferColumnType, INITIAL_ROW_LIMIT, parseCsv, ROW_LOAD_CHUNK } from "./csvLogic";

export interface CsvTableProps {
  content: string;
}

export function CsvTable({ content }: CsvTableProps) {
  const [visibleRowLimit, setVisibleRowLimit] = useState(INITIAL_ROW_LIMIT);
  const { columns, rows } = useMemo(() => {
    const parsed = parseCsv(content);
    if (parsed.length === 0) return { columns: [] as DataTableColumn[], rows: [] as Record<string, unknown>[] };
    const [header, ...dataRows] = parsed;
    const columns: DataTableColumn[] = header.map((name, i) => {
      const { type, align } = inferColumnType(dataRows.map((r) => r[i] ?? ""));
      return { key: `c${i}`, header: name, type, align };
    });
    const rows = dataRows.map((r) => {
      const record: Record<string, unknown> = {};
      header.forEach((_, i) => {
        const raw = r[i] ?? "";
        const col = columns[i];
        record[col.key] = col.type === "number" && raw !== "" ? Number(raw) : raw;
      });
      return record;
    });
    return { columns, rows };
  }, [content]);

  if (columns.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
        <EmptyState icon={<Table2 size={28} />} title="Empty CSV" description="This file has no rows to display." />
      </div>
    );
  }

  // Item 33: cap what actually reaches `DataTable` — see `csvLogic.ts`'s
  // header note for the measured numbers this is based on.
  const { visible: visibleRows, shownCount, hasMore } = capRows(rows, visibleRowLimit);

  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      {/* DESIGN-SPEC Amendments item 12: rendered content stays selectable
          even though the app-wide default is `user-select: none` — see
          `index.css`'s `[data-selectable-content]` rule. */}
      <div data-selectable-content style={{ padding: 20 }}>
        {/* `layout="auto"` (Phase 6.5c, DESIGN-SPEC Amendments item 15):
            the representative `metrics.csv` fixture mixes short numeric/date
            columns with a long free-text `notes` column — "fixed" (the
            default) would clip the long column at an equal-share width;
            "auto" sizes each column to its content and enables horizontal
            scroll, which is the actual truncation/scrolling behavior this
            fixture exists to exercise. */}
        <DataTable columns={columns} rows={visibleRows} stickyHeader layout="auto" rowKey={(_, i) => i} />
        {hasMore && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px 0", fontSize: 12, color: "var(--color-muted)" }}>
            <span>
              Showing {shownCount} of {rows.length} rows
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setVisibleRowLimit((n) => Math.min(n + ROW_LOAD_CHUNK, rows.length))}
            >
              Load {Math.min(ROW_LOAD_CHUNK, rows.length - shownCount)} more
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

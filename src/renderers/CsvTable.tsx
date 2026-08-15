/**
 * `.csv` Rendered mode — DESIGN-SPEC Modes table: "DataTable" with a header
 * row. Uses the library's `DataTable` (never a hand-rolled `<table>`, per
 * CLAUDE.md rule 1) — this module only does the CSV→`{columns, rows}`
 * parsing `DataTable` itself doesn't do.
 *
 * The parser is intentionally small: split on commas/newlines with just
 * enough quoted-field handling (`"a, b"`, doubled `""` for a literal quote)
 * to be correct for real CSV, not a byte-for-byte RFC 4180 implementation —
 * this app's demo data (`metrics.csv`, Phase 6.5c's 13-column/40+-row
 * representative fixture, DESIGN-SPEC Amendments item 15) and any
 * hand-authored vault CSV are ordinary tables, not spreadsheet exports with
 * embedded newlines.
 *
 * Column type inference (Phase 6.5c) goes beyond plain numeric-vs-text:
 * a column where every value matches an ISO `YYYY-MM-DD` date or an
 * `http(s)://` URL gets `DataTableColumn`'s `"date-human"`/`"url"` `CellType`
 * treatment instead of falling back to `"text"` — real coverage for the
 * "mixed types (dates, URLs, floats, long text cells)" fixture requirement,
 * not just numbers. `layout="auto"` (below, at the `DataTable` call site)
 * sizes columns to content and enables horizontal scroll, since a table with
 * both a `notes` column (long text) and short numeric columns is exactly
 * the "divergent content widths" case that prop's own doc names.
 */
import { useMemo } from "react";
import { DataTable, EmptyState, ScrollArea, type DataTableColumn } from "my-you-eye";
import { Table2 } from "lucide-react";

export interface CsvTableProps {
  content: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function isNumeric(value: string): boolean {
  return value.trim() !== "" && !Number.isNaN(Number(value));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\//i;

/** Every non-empty value in a column must agree on a type for that column
 * to get anything other than plain `"text"` — a single stray value that
 * doesn't fit (e.g. one blank cell) just falls the whole column back to
 * text rather than guessing per-cell, which would make a column's own
 * alignment/formatting inconsistent row to row. */
function inferColumnType(values: string[]): { type: DataTableColumn["type"]; align: "left" | "right" } {
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return { type: "text", align: "left" };
  // "date-system" (an absolute `Intl.DateTimeFormat`-formatted date, e.g.
  // "Jan 05, 2026"), not "date-human" (a relative "6 months ago" string,
  // library's `DateHumanDisplay`) — a metrics table's historical rows read
  // far better as absolute dates than as a moving-target relative time.
  if (nonEmpty.every((v) => ISO_DATE_RE.test(v))) return { type: "date-system", align: "left" };
  if (nonEmpty.every((v) => URL_RE.test(v))) return { type: "url", align: "left" };
  if (nonEmpty.every(isNumeric)) return { type: "number", align: "right" };
  return { type: "text", align: "left" };
}

export function CsvTable({ content }: CsvTableProps) {
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
        <DataTable columns={columns} rows={rows} stickyHeader layout="auto" rowKey={(_, i) => i} />
      </div>
    </ScrollArea>
  );
}

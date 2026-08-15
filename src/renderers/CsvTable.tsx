/**
 * `.csv` Rendered mode — DESIGN-SPEC Modes table: "DataTable" with a header
 * row. Uses the library's `DataTable` (never a hand-rolled `<table>`, per
 * CLAUDE.md rule 1) — this module only does the CSV→`{columns, rows}`
 * parsing `DataTable` itself doesn't do.
 *
 * The parser is intentionally small: split on commas/newlines with just
 * enough quoted-field handling (`"a, b"`, doubled `""` for a literal quote)
 * to be correct for real CSV, not a byte-for-byte RFC 4180 implementation —
 * this app's demo data (`metrics.csv`) and any hand-authored vault CSV are
 * simple `key,value`-shaped tables, not spreadsheet exports with embedded
 * newlines.
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

export function CsvTable({ content }: CsvTableProps) {
  const { columns, rows } = useMemo(() => {
    const parsed = parseCsv(content);
    if (parsed.length === 0) return { columns: [] as DataTableColumn[], rows: [] as Record<string, unknown>[] };
    const [header, ...dataRows] = parsed;
    const columns: DataTableColumn[] = header.map((name, i) => {
      const numeric = dataRows.length > 0 && dataRows.every((r) => isNumeric(r[i] ?? ""));
      return {
        key: `c${i}`,
        header: name,
        type: numeric ? "number" : "text",
        align: numeric ? "right" : "left",
      };
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
      <div style={{ padding: 20 }}>
        <DataTable columns={columns} rows={rows} stickyHeader rowKey={(_, i) => i} />
      </div>
    </ScrollArea>
  );
}

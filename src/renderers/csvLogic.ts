/**
 * Pure CSV parsing / column-inference / row-capping logic for
 * `CsvTable.tsx`'s Rendered mode — split out so the component file only
 * exports the component (matches this repo's convention: pure logic lives
 * beside the component it serves, not exported out of it — see
 * `src/git/syncStatus.ts`, `src/git/mergeLogic.ts`, `src/git/commitTemplate.ts`,
 * `src/share/sharePolicy.ts`, `src/share/shareLinks.ts`,
 * `src/share/shareIndicators.ts`). Unit-tested directly by
 * `tests/unit/rendererBigFileCaps.test.ts`.
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
 * not just numbers. `layout="auto"` (at `CsvTable.tsx`'s `DataTable` call
 * site) sizes columns to content and enables horizontal scroll, since a
 * table with both a `notes` column (long text) and short numeric columns is
 * exactly the "divergent content widths" case that prop's own doc names.
 *
 * DESIGN-SPEC Amendments item 33: big-file safety. Measured baseline (SSR
 * render via `react-dom/server`, see `tests/unit/rendererBigFileCaps.test.ts`)
 * — a 50,000-row/7-column CSV built ~1.85M DOM nodes and took ~67s to
 * render, unusable in a real tab. `DataTable` has no virtualization prop
 * (checked `skills/components.json`), so `CsvTable.tsx` caps how many
 * parsed rows it ever hands to `DataTable`: `INITIAL_ROW_LIMIT` rows render
 * up front, a one-row "Showing N of M rows" indicator plus a "Load more"
 * `Button` (library component) reveals `ROW_LOAD_CHUNK` more at a time.
 * Files at or under the cap show no indicator at all — identical to the
 * pre-item-33 behavior.
 */
import type { DataTableColumn } from "my-you-eye";

export const INITIAL_ROW_LIMIT = 500;
export const ROW_LOAD_CHUNK = 500;

/** Pure row-capping logic, pulled out of the component for its own test
 * (`tests/unit/rendererBigFileCaps.test.ts`): `limit` rows are shown
 * regardless of `rows.length`, i.e. the DOM `DataTable` receives is bounded
 * no matter how large the parsed CSV is. */
export function capRows<T>(rows: T[], limit: number): { visible: T[]; shownCount: number; hasMore: boolean } {
  const shownCount = Math.min(limit, rows.length);
  const visible = shownCount === rows.length ? rows : rows.slice(0, shownCount);
  return { visible, shownCount, hasMore: shownCount < rows.length };
}

export function parseCsv(text: string): string[][] {
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
export function inferColumnType(values: string[]): { type: DataTableColumn["type"]; align: "left" | "right" } {
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

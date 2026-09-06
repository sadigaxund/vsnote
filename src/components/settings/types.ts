/**
 * Shared row/category shape for the split Settings surface
 * (docs/PLAN-2026-09-05-refresh.md §2 item 4). Each `settings/<Category>.tsx`
 * module exports a `use<Category>Rows()` hook returning `SettingRow[]`; the
 * shell (`../SettingsView.tsx`) owns nothing about a category's content
 * beyond this shape — it renders rows, groups them for search, and filters
 * by `label`/`keywords`.
 */
import type { ReactNode } from "react";

export interface SettingRow {
  id: string;
  label: string;
  keywords?: string;
  content: ReactNode;
}

export interface SettingsCategory {
  id: string;
  label: string;
  icon: ReactNode;
  rows: SettingRow[];
}

export function rowMatches(row: SettingRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.label.toLowerCase().includes(q) || (row.keywords ?? "").toLowerCase().includes(q);
}

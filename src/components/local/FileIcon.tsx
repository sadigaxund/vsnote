/**
 * FileIcon — per-file-type colored icon glyph.
 *
 * Logged in docs/COMPONENT-BACKLOG.md ("FileIcon", group `display`): the
 * library has no file-type icon registry, and DESIGN-SPEC §3 requires a
 * specific color per extension (md=teal, ts=blue, tsx=green, json=amber,
 * css=violet, csv=green, image=neutral) that a single generic icon can't
 * express. Colors are hardcoded per glyph (not `currentColor`) so the icon
 * keeps its file-type identity even inside a container that sets its own
 * text color (e.g. TreeView's muted icon slot, a red strikethrough label).
 */
import {
  Braces,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Table2,
  Hash,
} from "lucide-react";
import type { FileKind } from "../../types";

const FILE_ICON_COLOR: Record<FileKind, string> = {
  md: "var(--color-primary)",
  ts: "#56baef",
  tsx: "var(--git-added)",
  json: "var(--git-modified)",
  css: "var(--git-untracked)",
  csv: "var(--git-added)",
  image: "var(--color-muted)",
  folder: "var(--color-primary)",
  unknown: "var(--color-muted)",
};

export interface FileIconProps {
  kind: FileKind;
  /** Folder open/expanded state — only meaningful for kind="folder". */
  open?: boolean;
  size?: number;
  className?: string;
}

export function FileIcon({ kind, open, size = 14, className }: FileIconProps) {
  // A collapsed folder reads as inert — app-preview.png renders it in the
  // same muted tone as its label, reserving the teal accent for the
  // expanded state (open folders + all file glyphs).
  const color = kind === "folder" && !open ? "var(--color-muted)" : FILE_ICON_COLOR[kind];
  const common = { size, color, className, strokeWidth: 1.75 as const };

  switch (kind) {
    case "folder":
      return open ? <FolderOpen {...common} /> : <Folder {...common} />;
    case "md":
      return <FileText {...common} />;
    case "ts":
      return <FileCode2 {...common} />;
    case "tsx":
      return <Braces {...common} />;
    case "json":
      return <FileJson2 {...common} />;
    case "css":
      return <Hash {...common} />;
    case "csv":
      return <Table2 {...common} />;
    case "image":
      return <ImageIcon {...common} />;
    default:
      return <FileText {...common} />;
  }
}

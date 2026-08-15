/**
 * `.json` Rendered mode — DESIGN-SPEC Modes table: "tree/pretty view". Uses
 * the library's `TreeView`, whose `TreeNode` shape (`kind: "object" |
 * "array"`, typed leaf `value: TreeNodeValue`) exists specifically for this
 * case — no hand-rolled collapsible tree, per CLAUDE.md rule 1.
 */
import { useMemo } from "react";
import { EmptyState, ScrollArea, TreeView, type TreeNode } from "my-you-eye";
import { Braces } from "lucide-react";

export interface JsonViewProps {
  content: string;
}

function cellTypeFor(value: unknown): "text" | "number" | "boolean" | "null" {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "text";
  }
}

/** `id` is the node's dotted path from the document root (e.g.
 * `root.defaultMode.md`) — deterministic from the JSON structure itself
 * rather than a module-level mutable counter (which `react-hooks/globals`
 * correctly flags: reassigning shared state during render is a purity
 * violation), and stable across re-renders for free, which a controlled
 * `TreeView` would need anyway. */
function toNodes(value: unknown, label: string, id: string): TreeNode {
  if (Array.isArray(value)) {
    return { id, label, kind: "array", children: value.map((v, i) => toNodes(v, String(i), `${id}.${i}`)) };
  }
  if (value !== null && typeof value === "object") {
    return {
      id,
      label,
      kind: "object",
      children: Object.entries(value as Record<string, unknown>).map(([k, v]) => toNodes(v, k, `${id}.${k}`)),
    };
  }
  return { id, label, value: { type: cellTypeFor(value), value } };
}

export function JsonView({ content }: JsonViewProps) {
  const { data, error } = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return { data: parsed.map((v, i) => toNodes(v, String(i), `root.${i}`)), error: null as string | null };
      }
      if (parsed !== null && typeof parsed === "object") {
        return {
          data: Object.entries(parsed as Record<string, unknown>).map(([k, v]) => toNodes(v, k, `root.${k}`)),
          error: null,
        };
      }
      return { data: [toNodes(parsed, "value", "root")], error: null };
    } catch (err) {
      return { data: [] as TreeNode[], error: err instanceof Error ? err.message : "Invalid JSON" };
    }
  }, [content]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
        <EmptyState icon={<Braces size={28} />} title="Can't parse JSON" description={error} />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      <div style={{ padding: 20, fontFamily: "var(--font-mono)", fontSize: 13 }}>
        <TreeView data={data} defaultExpandedDepth={3} indent="md" />
      </div>
    </ScrollArea>
  );
}

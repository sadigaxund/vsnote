/**
 * `.json` Rendered mode — DESIGN-SPEC Modes table: "tree/pretty view". Uses
 * the library's `TreeView`, whose `TreeNode` shape (`kind: "object" |
 * "array"`, typed leaf `value: TreeNodeValue`) exists specifically for this
 * case — no hand-rolled collapsible tree, per CLAUDE.md rule 1. This module
 * only wires `jsonLogic.ts`'s pure, lazily-built tree into the component;
 * see that file for the item 33 big-file-safety design and numbers.
 *
 * DESIGN-SPEC Amendments round 17 item 128: `TreeItem` (my-you-eye internal,
 * not exported — `node_modules/my-you-eye/dist/index.js`) renders a leaf row
 * as two flex siblings: the key gets `flex-1 min-w-0` (a Tailwind `flex-1` =
 * `flex: 1 1 0%` — zero *basis*), the `value` wrapper gets only `shrink
 * min-w-0` (`flex: 0 1 auto` — its basis is its own intrinsic content
 * width). For a long unbroken string, that basis can run to thousands of
 * pixels; since the key's basis is 0 it absorbs none of the resulting
 * negative free space, so the value's flex-shrink alone claims the entire
 * row and the key renders at ~0 width — invisible, not overlapping-looking
 * so much as GONE, confirmed with a screenshot
 * (`.design/r7/r5-5-jsonview-before.png`) before this fix. `TreeView`
 * exposes no prop to change that internal split (checked every `TreeView`/
 * `TreeViewProps` field in `components.json` and `index.d.ts`), so this
 * isn't a CSS-token restyle away — see `withInlineValues` below for the
 * sanctioned fix and why it isn't a CLAUDE.md rule-2 "missing component"
 * case either.
 */
import { useCallback, useMemo, useState } from "react";
import { CellType, EmptyState, ScrollArea, TreeView, type TreeNode, type TreeNodeValue } from "my-you-eye";
import { Braces } from "lucide-react";
import { buildInitialOpenIds, buildTree, parseJsonRoots } from "./jsonLogic";

export interface JsonViewProps {
  content: string;
}

/**
 * Composes a leaf's key and `CellType`-rendered value into a single
 * `label` (a documented extension point — `TreeNode.label` has been
 * `ReactNode` since the library's #11, specifically so "external state can
 * render into the row without the tree knowing about it") instead of
 * handing the value to `TreeItem`'s own broken `value` slot (see the module
 * comment above). This is a supported customization surface, not a fork or
 * a force-style: `TreeItem`'s row chrome (chevron, indent guides, a11y,
 * keyboard nav, selection) is untouched, and `CellType` — the library's own
 * typed-value display primitive, including its overflow-aware
 * `TruncatedCellValue` — is reused as-is.
 *
 * The row itself is a flex `<span>` (nesting inside `TreeItem`'s own label
 * `<span>`, so it must stay inline-safe — no `<div>`): the key is
 * `flexShrink: 0` with a `maxWidth` cap (ellipsizing on its own if some
 * future key is itself absurdly long) so it always keeps its width, and the
 * value is `flex: 1 1 0%, minWidth: 0` so it — and only it — absorbs
 * negative free space. That hands `CellType`'s `TruncatedCellValue` a
 * properly bounded box, which is what lets its own `scrollWidth >
 * clientWidth` truncation check (and click-to-expand popover) work at all;
 * against `TreeItem`'s original unbounded box it always measured "not
 * truncated" because nothing was overflowing ITS OWN auto-sized wrapper.
 *
 * Ellipsis, not wrap: a JSON tree reads as a scannable table of short
 * rows — DESIGN-SPEC's existing `--spacing-tree-row` is a fixed,
 * grid-unit-multiple row height specifically so rows never grow to fit
 * content. Letting a value wrap would fight that (a 300-character string
 * turning one row into a paragraph mid-tree) and make the tree harder to
 * scan, not easier; `CellType`'s built-in ellipsis + click-to-expand
 * popover already gives access to the full value on demand.
 */
function withInlineValues(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    const children = node.children ? withInlineValues(node.children) : node.children;
    if (!node.value) return children === node.children ? node : { ...node, children };
    const cell = node.value;
    const key = typeof node.label === "string" ? node.label : undefined;
    return {
      ...node,
      children,
      value: undefined,
      label: key ? <LeafRow label={key} cell={cell} /> : <CellType {...cell} />,
    };
  });
}

function LeafRow({ label, cell }: { label: string; cell: TreeNodeValue }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", minWidth: 0 }}>
      <span
        style={{
          flexShrink: 0,
          maxWidth: "50%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ flex: "1 1 0%", minWidth: 0, textAlign: "right" }}>
        <CellType {...cell} />
      </span>
    </span>
  );
}

export function JsonView({ content }: JsonViewProps) {
  const { roots, error } = useMemo(() => parseJsonRoots(content), [content]);

  const [openIds, setOpenIds] = useState<Set<string>>(() => buildInitialOpenIds(roots));

  const onToggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const data = useMemo(() => withInlineValues(buildTree(roots, openIds)), [roots, openIds]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
        <EmptyState icon={<Braces size={28} />} title="Can't parse JSON" description={error} />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" style={{ minHeight: 0, background: "var(--app-editor-bg)" }}>
      {/* DESIGN-SPEC Amendments item 12: rendered content stays selectable
          even though the app-wide default is `user-select: none` — see
          `index.css`'s `[data-selectable-content]` rule. */}
      <div data-selectable-content style={{ padding: 20, fontFamily: "var(--font-mono)", fontSize: 13 }}>
        <TreeView data={data} expandedKeys={openIds} onToggle={onToggle} indent="md" />
      </div>
    </ScrollArea>
  );
}

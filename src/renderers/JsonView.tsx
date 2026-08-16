/**
 * `.json` Rendered mode — DESIGN-SPEC Modes table: "tree/pretty view". Uses
 * the library's `TreeView`, whose `TreeNode` shape (`kind: "object" |
 * "array"`, typed leaf `value: TreeNodeValue`) exists specifically for this
 * case — no hand-rolled collapsible tree, per CLAUDE.md rule 1. This module
 * only wires `jsonLogic.ts`'s pure, lazily-built tree into the component;
 * see that file for the item 33 big-file-safety design and numbers.
 */
import { useCallback, useMemo, useState } from "react";
import { EmptyState, ScrollArea, TreeView } from "my-you-eye";
import { Braces } from "lucide-react";
import { buildInitialOpenIds, buildTree, parseJsonRoots } from "./jsonLogic";

export interface JsonViewProps {
  content: string;
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

  const data = useMemo(() => buildTree(roots, openIds), [roots, openIds]);

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

/**
 * The registry component for the synthetic `vsnote-code` directive
 * (`vsnoteCodeTable.ts`'s header has the full design). Split into its own
 * file so it is the ONLY export here (`react-refresh/only-export-components`
 * — the shared context/name/type live in `vsnoteCodeTable.ts` instead).
 */
import { useContext } from "react";
import type { MarkComponentProps } from "@markii/react";
import { CodeBlock } from "./codeBlock";
import { CodeTableContext, langToFileKind } from "./vsnoteCodeTable";

export function VSNoteCodeBlock({ attributes }: MarkComponentProps) {
  const table = useContext(CodeTableContext);
  const idx = Number(attributes.idx);
  const entry = Number.isInteger(idx) ? table[idx] : undefined;
  // Malformed/missing index (e.g. this component somehow reached without
  // `render.tsx`'s provider, or a hostile/hand-built registry override) —
  // degrade to nothing rather than throw, matching Architecture rule 3's
  // never-throw spirit the rest of this pipeline already follows.
  if (!entry) return null;
  return <CodeBlock code={entry.code} kind={langToFileKind(entry.lang)} />;
}

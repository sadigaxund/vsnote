/**
 * Vendored from markii-org/markii (MIT license), pinned to v0.13.0:
 * packages/markii-host/src/complete/types.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/complete/types.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. Copied verbatim.
 */

/** What a completion item inserts and where it came from. */
export type CompletionItemKind = "component" | "attribute" | "value";

/** Structured documentation for a component or attribute, so a host can render it its own way. */
export interface ComponentDocumentation {
  readonly summary: string;
  readonly attributes: readonly string[];
  readonly example: string;
}

export interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionItemKind;
  readonly detail: string;
  readonly documentation?: ComponentDocumentation;
  readonly insertText: string;
  readonly insertCursorOffset: number;
  readonly group?: "standard" | "layout" | "pack";
  readonly packName?: string;
}

export type CompletionContextKind = "none" | "directive-name" | "attribute-name" | "attribute-value";

export interface CompletionContext {
  readonly kind: CompletionContextKind;
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly items: readonly CompletionItem[];
}

export interface HoverInfo {
  readonly directiveName: string;
  readonly documentation: ComponentDocumentation;
  readonly start: number;
  readonly end: number;
}

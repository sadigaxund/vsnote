/**
 * Barrel for the vendored `@markii/host` pure functions (see each sibling
 * file's own header for provenance/trimming notes; `@markii/host` itself
 * is `private: true` upstream and never published to npm). Consumed by
 * `src/editor/markiiCompletion.ts` — the CM6 autocompletion/hover/insert
 * wiring (docs/PLAN-2026-09-05-refresh.md §6 Phase M1).
 */
export { completionAt, hoverAt, componentDocumentation, formatComponentDocumentation } from "./completion";
export type { CompletionContext, CompletionContextKind, CompletionItem, CompletionItemKind, ComponentDocumentation, HoverInfo } from "./types";
export { buildComponentCatalog, LAYOUT_WRAPPER_NAMES } from "./componentCatalog";
export type { DiscoveredPack, InsertableComponent } from "./componentCatalog";
export { componentSkeleton, offsetToLineColumn } from "./componentSkeleton";
export type { ComponentSkeleton, LineColumn } from "./componentSkeleton";
export { enclosingContainerFences, insertedContainerColonCount, fenceExtensionEdits } from "./containerFences";
export type { EnclosingContainerFence, FenceLineEdit } from "./containerFences";

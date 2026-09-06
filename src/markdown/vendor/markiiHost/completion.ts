/**
 * Vendored and TRIMMED from markii-org/markii (MIT license), pinned to
 * v0.13.0: packages/markii-host/src/complete/completion.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/complete/completion.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. TRIMMED: every
 * pack-attribute code path (`packAttributesFor`, `schemaForPackAttribute`,
 * and the `component.source === "pack"` branches) is dropped — see
 * `componentCatalog.ts`'s header for why VSNote has no pack support yet;
 * every catalog entry here is `source: "standard"`, so attribute metadata
 * always comes from `@markii/stdlib`'s `getContract`. Re-vendor the full
 * file (and add `@markii/pack`) when Phase M3 lands.
 *
 * Original file header:
 * Directive autocompletion (GitHub issue #27, slice 1): `completionAt` and
 * `hoverAt`, the two entry points a host calls. Pure and host-neutral: no
 * editor API, no knowledge of `vscode` or `obsidian`.
 */
import type { AttributeSchema, ComponentKind } from "@markii/stdlib";
import { LAYOUT_ATTRIBUTES, LAYOUT_ATTRIBUTE_KEYS, getContract, layoutWrapperAxis, otherLayoutAxis } from "@markii/stdlib";
import type { LayoutAxis } from "@markii/stdlib";
import { componentSkeleton } from "./componentSkeleton";
import type { ComponentSkeleton } from "./componentSkeleton";
import type { InsertableComponent } from "./componentCatalog";
import { firstSentence } from "./firstSentence";
import { clampColumn, findDirectiveNameTokenAt, parseCompletionContext } from "./directiveContext";
import type { AttributeNameParseResult, AttributeValueParseResult, DirectiveForm, DirectiveNameParseResult } from "./directiveContext";
import { componentDocumentation } from "./documentation";
import type { CompletionContext, CompletionItem, HoverInfo } from "./types";

export type { CompletionContext, CompletionContextKind, CompletionItem, CompletionItemKind, ComponentDocumentation, HoverInfo } from "./types";
export { componentDocumentation, formatComponentDocumentation } from "./documentation";

const EMPTY_CONTEXT_AT = (column: number): CompletionContext => ({
  kind: "none",
  replaceStart: column,
  replaceEnd: column,
  items: [],
});

/** Whether `component` is offered when the author is typing directive `form`. */
function componentOffersForm(component: InsertableComponent, form: DirectiveForm): boolean {
  if (!component.kindDeclared) return true;
  return component.kind === form;
}

/**
 * Adjusts a container skeleton's opening/closing fence to use exactly the
 * colon run the user typed.
 */
function adjustContainerFence(skeleton: ComponentSkeleton, colonRun: string): ComponentSkeleton {
  if (colonRun.length === 3) return skeleton;
  const shift = colonRun.length - 3;
  const text = colonRun + skeleton.text.slice(3, skeleton.text.length - 3) + colonRun;
  return { text, cursorOffset: skeleton.cursorOffset + shift };
}

function buildSkeleton(
  directiveName: string,
  kind: ComponentKind,
  requiredAttributes: readonly string[],
  colonRun: string,
): ComponentSkeleton {
  const skeleton = componentSkeleton(directiveName, kind, requiredAttributes);
  return kind === "container" ? adjustContainerFence(skeleton, colonRun) : skeleton;
}

function directiveNameItem(component: InsertableComponent, ctx: DirectiveNameParseResult, isRestEmpty: boolean): CompletionItem {
  let insertText: string;
  let insertCursorOffset: number;

  if (isRestEmpty) {
    const kind = component.kindDeclared ? component.kind : ctx.form;
    const skeleton = buildSkeleton(component.directiveName, kind, component.requiredAttributes, ctx.colonRun);
    insertText = skeleton.text;
    insertCursorOffset = skeleton.cursorOffset;
  } else {
    insertText = component.directiveName;
    insertCursorOffset = component.directiveName.length;
  }

  return {
    label: component.directiveName,
    kind: "component",
    detail: component.description ?? "",
    documentation: componentDocumentation(component),
    insertText,
    insertCursorOffset,
    group: component.group,
    ...(component.packName !== undefined ? { packName: component.packName } : {}),
  };
}

function directiveNameCompletionContext(
  ctx: DirectiveNameParseResult,
  catalog: readonly InsertableComponent[],
  line: string,
): CompletionContext {
  const restOfLine = line.slice(ctx.replaceEnd);
  const isRestEmpty = /^\s*$/.test(restOfLine);
  const replaceStart = isRestEmpty ? ctx.replaceStart : ctx.replaceStart + ctx.colonRun.length;

  const items = catalog
    .filter((component) => componentOffersForm(component, ctx.form))
    .map((component) => directiveNameItem(component, ctx, isRestEmpty));

  return {
    kind: "directive-name",
    replaceStart,
    replaceEnd: ctx.replaceEnd,
    items,
  };
}

/** The catalog entry for `directiveName`, matched case-insensitively the same way `hoverAt` matches. */
function findCatalogEntry(catalog: readonly InsertableComponent[], directiveName: string): InsertableComponent | undefined {
  const lowered = directiveName.toLowerCase();
  return catalog.find((component) => component.directiveName.toLowerCase() === lowered);
}

function attributeNameItem(name: string, schema: AttributeSchema): CompletionItem {
  const insertText = `${name}=""`;
  const insertCursorOffset = name.length + 2;
  const requiredPrefix = schema.required === true ? "required. " : "";
  const detail = `${requiredPrefix}${firstSentence(schema.description)}`.trim();

  return {
    label: name,
    kind: "attribute",
    detail,
    documentation: { summary: schema.description, attributes: [], example: "" },
    insertText,
    insertCursorOffset,
  };
}

const LAYOUT_ATTRIBUTE_NAMES = LAYOUT_ATTRIBUTE_KEYS;
const LAYOUT_ATTRIBUTE_NAME_SET: ReadonlySet<string> = new Set(LAYOUT_ATTRIBUTE_NAMES);
void LAYOUT_ATTRIBUTE_NAME_SET; // kept for parity with upstream; used if a future pack path is re-added

/**
 * Which reserved layout attributes to offer on `directiveName`, written in
 * directive `form`.
 */
function layoutAttributesFor(directiveName: string, form: DirectiveForm): readonly LayoutAxis[] {
  if (form === "inline") return [];
  const ownAxis = layoutWrapperAxis(directiveName);
  return ownAxis === undefined ? LAYOUT_ATTRIBUTE_NAMES : [otherLayoutAxis(ownAxis)];
}

function attributeNameCompletionContext(ctx: AttributeNameParseResult): CompletionContext {
  const contract = getContract(ctx.directiveName);
  const items: CompletionItem[] = [];
  const offered = new Set<string>();

  if (contract !== undefined) {
    for (const [name, schema] of Object.entries(contract.attributes)) {
      if (ctx.presentNames.has(name.toLowerCase())) continue;
      items.push(attributeNameItem(name, schema));
      offered.add(name.toLowerCase());
    }
  }
  // TRIMMED: upstream's `else` branch offers a pack component's declared
  // attributes here — VSNote has no packs yet, so a non-standard directive
  // name simply offers only the layout attributes below.

  for (const name of layoutAttributesFor(ctx.directiveName, ctx.form)) {
    if (ctx.presentNames.has(name) || offered.has(name)) continue;
    items.push(attributeNameItem(name, LAYOUT_ATTRIBUTES[name]));
  }

  return {
    kind: "attribute-name",
    replaceStart: ctx.replaceStart,
    replaceEnd: ctx.replaceEnd,
    items,
  };
}

function resolveValueEnum(ctx: AttributeValueParseResult): readonly string[] | undefined {
  if (
    (ctx.attributeName === "width" || ctx.attributeName === "align") &&
    layoutAttributesFor(ctx.directiveName, ctx.form).includes(ctx.attributeName)
  ) {
    return LAYOUT_ATTRIBUTES[ctx.attributeName].enum;
  }
  const contract = getContract(ctx.directiveName);
  if (contract === undefined) {
    // TRIMMED: upstream falls back to a pack component's declared `values`
    // here — no packs in VSNote yet, so an unknown directive has no values.
    return undefined;
  }
  if (!Object.hasOwn(contract.attributes, ctx.attributeName)) return undefined;
  return contract.attributes[ctx.attributeName]?.enum;
}

function attributeValueItem(value: string, ctx: AttributeValueParseResult): CompletionItem {
  let insertText: string;
  if (ctx.quoteChar === undefined) {
    insertText = value;
  } else if (ctx.hasClosingQuote) {
    insertText = value;
  } else {
    insertText = `${value}${ctx.quoteChar}`;
  }

  return {
    label: value,
    kind: "value",
    detail: "",
    insertText,
    insertCursorOffset: insertText.length,
  };
}

function attributeValueCompletionContext(ctx: AttributeValueParseResult): CompletionContext {
  const enumValues = resolveValueEnum(ctx);
  if (enumValues === undefined || enumValues.length === 0) {
    return EMPTY_CONTEXT_AT(ctx.replaceEnd);
  }

  return {
    kind: "attribute-value",
    replaceStart: ctx.replaceStart,
    replaceEnd: ctx.replaceEnd,
    items: enumValues.map((value) => attributeValueItem(value, ctx)),
  };
}

/**
 * The one entry point a host calls: the current line's text, the zero-based
 * cursor column, and the insert catalog. Never throws; returns a `'none'`
 * context when nothing completes here.
 */
export function completionAt(line: string, column: number, catalog: readonly InsertableComponent[]): CompletionContext {
  try {
    const safeLine = typeof line === "string" ? line : "";
    const safeCatalog = Array.isArray(catalog) ? catalog : [];
    const clampedColumn = clampColumn(safeLine, column);
    const ctx = parseCompletionContext(safeLine, clampedColumn);

    switch (ctx.kind) {
      case "attribute-value":
        return attributeValueCompletionContext(ctx);
      case "attribute-name":
        return attributeNameCompletionContext(ctx);
      case "directive-name":
        return directiveNameCompletionContext(ctx, safeCatalog, safeLine);
      default:
        return EMPTY_CONTEXT_AT(clampedColumn);
    }
  } catch {
    return EMPTY_CONTEXT_AT(clampColumn(line, column));
  }
}

/**
 * The directive under the cursor, for a hover popup. `undefined` when the
 * cursor is not on a known component's directive name.
 */
export function hoverAt(line: string, column: number, catalog: readonly InsertableComponent[]): HoverInfo | undefined {
  try {
    const safeLine = typeof line === "string" ? line : "";
    const safeCatalog = Array.isArray(catalog) ? catalog : [];
    const token = findDirectiveNameTokenAt(safeLine, column);
    if (token === undefined) return undefined;

    const entry = findCatalogEntry(safeCatalog, token.name);
    if (entry === undefined) return undefined;

    return {
      directiveName: entry.directiveName,
      documentation: componentDocumentation(entry),
      start: token.start,
      end: token.end,
    };
  } catch {
    return undefined;
  }
}

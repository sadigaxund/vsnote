/**
 * Vendored and TRIMMED from markii-org/markii (MIT license), pinned to
 * v0.13.0: packages/markii-host/src/complete/documentation.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/complete/documentation.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. TRIMMED: the upstream
 * `packAttributeDocLine` (pack-declared attribute docs) is dropped — see
 * `componentCatalog.ts`'s header for why VSNote has no pack support yet.
 * Every `InsertableComponent` here is `source: "standard"`, so the
 * `component.source === "pack"` branch never runs and is removed.
 *
 * Original file header:
 * Directive autocompletion (GitHub issue #27, slice 1): builds
 * `ComponentDocumentation` for a catalog entry, and renders it as plain
 * text for a host with no rich-text popup.
 */
import type { AttributeSchema } from "@markii/stdlib";
import { getContract } from "@markii/stdlib";
import { componentSkeleton } from "./componentSkeleton";
import type { InsertableComponent } from "./componentCatalog";
import type { ComponentDocumentation } from "./types";

/** `name`, `name (required)`, `name: a | b`, or `name (required): a | b`. */
function attributeDocLine(name: string, schema: AttributeSchema): string {
  const requiredPart = schema.required === true ? " (required)" : "";
  const enumPart = schema.enum !== undefined ? `: ${schema.enum.join(" | ")}` : "";
  return `${name}${requiredPart}${enumPart}`;
}

/**
 * The one-line usage example built from `componentSkeleton`. For a
 * container, only the opening fence line is shown.
 */
function exampleFor(component: InsertableComponent): string {
  const skeleton = componentSkeleton(component.directiveName, component.kind, component.requiredAttributes);
  if (component.kind !== "container") return skeleton.text;
  const newline = skeleton.text.indexOf("\n");
  return newline === -1 ? skeleton.text : skeleton.text.slice(0, newline);
}

/**
 * Builds the structured documentation for one catalog entry: a standard
 * component's contract description and attribute list.
 */
export function componentDocumentation(component: InsertableComponent): ComponentDocumentation {
  const example = exampleFor(component);
  const contract = getContract(component.directiveName);
  if (contract === undefined) {
    return { summary: component.description ?? "", attributes: [], example };
  }
  return {
    summary: contract.description,
    attributes: Object.entries(contract.attributes).map(([name, schema]) => attributeDocLine(name, schema)),
    example,
  };
}

/**
 * Renders `ComponentDocumentation` as plain text for a host with no
 * rich-text popup. Any section with nothing to show is omitted entirely.
 */
export function formatComponentDocumentation(doc: ComponentDocumentation): string {
  const sections: string[] = [];

  if (doc.summary.length > 0) sections.push(doc.summary);

  if (doc.attributes.length > 0) {
    sections.push(["Attributes:", ...doc.attributes.map((line) => `- ${line}`)].join("\n"));
  }

  if (doc.example.length > 0) sections.push(`Example: ${doc.example}`);

  return sections.join("\n\n");
}

/**
 * Vendored and TRIMMED from markii-org/markii (MIT license), pinned to
 * v0.13.0: packages/markii-host/src/insert/component-catalog.ts
 * https://github.com/markii-org/markii/blob/main/packages/markii-host/src/insert/component-catalog.ts
 *
 * `@markii/host` is `private: true` upstream and never published to npm —
 * see docs/PLAN-2026-09-05-refresh.md §6 Phase M1. TRIMMED: the upstream
 * file also builds catalog entries for installed PACKS (`@markii/pack`'s
 * `composeDirectiveName`/`packComponents`) — VSNote has no pack system yet
 * (that is Phase M3, per `docs/temp-plan-add-extension.md`), so
 * `@markii/pack` is not installed and that half of the file is dropped
 * here along with `DiscoveredPack`/`packCatalogEntries`. Every
 * `InsertableComponent` this trimmed catalog produces is always
 * `source: "standard"`. Re-vendor the full file (and add `@markii/pack`)
 * when Phase M3 lands.
 *
 * Original file header:
 * "Insert Component" (GitHub issue #17, slice 1): the flat list of
 * components a picker offers — every `@markii/stdlib` standard component.
 * Host-neutral and pure: no `vscode`, no `obsidian`, no filesystem access.
 */
import type { ComponentKind } from "@markii/stdlib";
import { STANDARD_COMPONENTS } from "@markii/stdlib";
import { firstSentence } from "./firstSentence";

/**
 * The seven layout-wrapper container directive names (docs/format.md):
 * alignment (`center`, `left`, `right`) and width presets (`fit`, `narrow`,
 * `wide`, `full`).
 */
export const LAYOUT_WRAPPER_NAMES: readonly string[] = ["center", "left", "right", "wide", "narrow", "full", "fit"];

/** One component a picker can offer to insert. */
export interface InsertableComponent {
  /** The directive name the author types, e.g. `callout`. */
  readonly directiveName: string;
  readonly kind: ComponentKind;
  readonly source: "standard" | "pack";
  readonly group: "standard" | "layout" | "pack";
  readonly packName?: string;
  readonly description?: string;
  readonly requiredAttributes: readonly string[];
  /** Always absent in this trimmed (no-pack) vendor — kept for shape parity with upstream's `InsertableComponent`. */
  readonly attributes?: readonly never[];
  readonly kindDeclared: boolean;
}

/** Required attribute names off a contract's `attributes` map, in the map's own key order. */
function requiredAttributeNames(attributes: Record<string, { required?: boolean }>): string[] {
  return Object.keys(attributes).filter((name) => attributes[name]?.required === true);
}

const LAYOUT_WRAPPER_NAME_SET: ReadonlySet<string> = new Set(LAYOUT_WRAPPER_NAMES);

function standardCatalogEntries(): InsertableComponent[] {
  return Object.entries(STANDARD_COMPONENTS).map(([name, contract]) => ({
    directiveName: name,
    kind: contract.kind,
    source: "standard",
    group: LAYOUT_WRAPPER_NAME_SET.has(name) ? "layout" : "standard",
    description: firstSentence(contract.description),
    requiredAttributes: requiredAttributeNames(contract.attributes),
    kindDeclared: true,
  }));
}

/**
 * Builds the insert catalog: every standard, non-layout component first
 * (declaration order), then the layout wrappers (declaration order).
 * TRIMMED: upstream also appends each discovered pack's components; VSNote
 * has none, so this always returns just the standard set.
 */
export function buildComponentCatalog(): readonly InsertableComponent[] {
  const standardAll = standardCatalogEntries();
  const standard = standardAll.filter((entry) => entry.group === "standard");
  const layout = standardAll.filter((entry) => entry.group === "layout");
  return [...standard, ...layout];
}
